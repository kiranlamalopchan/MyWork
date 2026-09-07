"""
Time tracking: workplaces, shifts, and the breaks inside them.

Durations are never stored. Everything (shift length, break time, net worked
hours) is derived from the raw clock_in / clock_out / break_start / break_end
timestamps, so correcting a time on the edit page automatically corrects every
total that was built from it — there are no stale cached numbers to go stale.
"""

from datetime import timedelta
from typing import NamedTuple

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone


class Weekday(models.IntegerChoices):
    """
    The days, numbered the way `date.weekday()` numbers them.

    Storing Python's own numbering means the week-start arithmetic below is a
    single subtraction, with no translation table to get wrong.
    """

    MONDAY = 0, "Monday"
    TUESDAY = 1, "Tuesday"
    WEDNESDAY = 2, "Wednesday"
    THURSDAY = 3, "Thursday"
    FRIDAY = 4, "Friday"
    SATURDAY = 5, "Saturday"
    SUNDAY = 6, "Sunday"


# Sunday to Saturday is the week most rosters and pay slips are written in, so
# it is what a new workplace and a new account start on. Anyone whose week runs
# Monday to Sunday changes it in one place and every total follows.
DEFAULT_WEEK_START = Weekday.SUNDAY

# Pay fortnights here run Thursday to Wednesday, so that is the day a new
# cycle anchors on. A fortnight repeats every 14 days, which means whichever
# weekday the anchor lands on is the weekday every cycle starts on from then
# on — picking the day is the whole of choosing the cycle.
DEFAULT_FORTNIGHT_START = Weekday.THURSDAY

# A monthly cycle can start on any day the payroll does, but only the first 28
# exist in every month — the 30th would have no February.
MAX_MONTH_START_DAY = 28


def week_start(day, starts_on=DEFAULT_WEEK_START):
    """
    Start of the week `day` falls in, given the day the week starts on.

    The modulo keeps this right whichever way round the two days sit: a
    Wednesday in a Sunday-start week goes back 3 days, a Sunday goes back 0.
    """
    return day - timedelta(days=(day.weekday() - int(starts_on)) % 7)


def fortnight_start(day, anchor):
    """
    Start of the 14-day block `day` falls in, counting from `anchor`.

    Floor division keeps this correct for dates before the anchor too
    (-1 // 14 == -1), so a shift back-dated past the anchor lands in the
    fortnight that actually contains it rather than the anchor's own.
    """
    return anchor + timedelta(days=((day - anchor).days // 14) * 14)


def month_start(day, starts_on=1):
    """
    Start of the monthly cycle `day` falls in, given the day it starts on.

    A cycle starting on the 26th means the 25th still belongs to the cycle
    that opened last month, which is how a pay period that straddles the
    calendar month is counted.
    """
    starts_on = min(max(int(starts_on), 1), MAX_MONTH_START_DAY)
    if day.day >= starts_on:
        return day.replace(day=starts_on)
    # Step into the previous month via its last day, so month lengths and
    # year boundaries take care of themselves.
    return (day.replace(day=1) - timedelta(days=1)).replace(day=starts_on)


def next_month_start(day, starts_on=1):
    """The start of the cycle after the one `day` falls in."""
    start = month_start(day, starts_on)
    # Day 28 at the latest, so adding 4 days can never skip a whole month.
    return (start.replace(day=1) + timedelta(days=32)).replace(day=start.day)


class Pay(NamedTuple):
    """
    What some hours are worth: what was earned, what is withheld, and what
    actually lands in the bank.

    The three travel together because they are only ever read together — a
    take-home figure with no gross beside it is a number you cannot check
    against a payslip.
    """

    gross: float
    tax: float
    net: float


class LimitPeriod(models.TextChoices):
    WEEK = "WEEK", "Per week"
    FORTNIGHT = "FORTNIGHT", "Per fortnight"
    MONTH = "MONTH", "Per month"


def _current_week_start():
    """The start of the week we're in."""
    return week_start(timezone.localdate())


def _recent_fortnight_start():
    """Default fortnight anchor: the most recent Thursday."""
    return week_start(timezone.localdate(), DEFAULT_FORTNIGHT_START)


def fortnight_runs(anchor):
    """
    "Thursday → Wednesday": the days a fortnight anchored here runs between.

    Reads the weekday off the anchor rather than being told it, so the label
    can never disagree with the date the totals are actually counted from.
    """
    if anchor is None:
        return ""
    start = Weekday(anchor.weekday())
    return f"{start.label} → {Weekday((anchor.weekday() + 13) % 7).label}"


# Historical migrations name these as field defaults and are loaded on every
# fresh `migrate`, so they stay importable. Nothing in the models uses them.
_monday_of_this_week = _current_week_start


class Workplace(models.Model):
    # Each workplace carries its own cap. Two jobs are two separate agreements
    # — a 30-hour visa cap at one and a 20-hour roster limit at the other are
    # counted, warned about and blown through independently.
    Period = LimitPeriod

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workplaces"
    )
    name = models.CharField(max_length=120)
    address = models.CharField(max_length=255, blank=True)
    hourly_rate = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True,
        help_text="Optional. Used to estimate pay alongside your hours.",
    )
    # The share of pay this employer withholds. It sits here rather than on
    # the account because withholding is per employer: someone claiming the
    # tax-free threshold at one job and not at the other is withheld at two
    # different rates, and averaging them would be wrong at both.
    #
    # A percentage rather than a tax table: the real PAYG scales are
    # progressive, change every year and differ by what you claimed on your
    # TFN declaration, so a figure read straight off your own payslip is both
    # simpler and closer to the truth than a table this app tried to keep up
    # to date. It is an estimate either way, and it is labelled as one.
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Optional. Take it off a payslip: tax withheld ÷ gross × 100.",
    )
    # Null means "no cap here" — the limit card simply doesn't appear for this
    # workplace, while any other workplace's cap carries on unaffected.
    hours_limit = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    limit_period = models.CharField(
        max_length=9, choices=LimitPeriod.choices, default=LimitPeriod.FORTNIGHT
    )
    # Where this workplace's cycle starts — one setting per period, so the cap
    # is measured over the same days the job's own roster or pay slip uses.
    # Jobs rarely share a cycle, which is why these sit beside the cap they
    # measure rather than on the user.
    week_starts_on = models.IntegerField(choices=Weekday.choices, default=DEFAULT_WEEK_START)
    fortnight_anchor = models.DateField(default=_recent_fortnight_start)
    month_starts_on = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(MAX_MONTH_START_DAY)],
    )
    is_default = models.BooleanField(default=False)
    # Deleting a workplace that has shifts against it archives it instead, so
    # the timesheet keeps showing the name each shift was actually worked
    # under. Archived workplaces drop out of the pickers and the list.
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            # Archived names are excluded so re-adding a workplace you once
            # removed isn't blocked by its own history.
            models.UniqueConstraint(
                fields=["user", "name"],
                condition=Q(is_archived=False),
                name="uniq_active_workplace_name_per_user",
            )
        ]

    def __str__(self):
        return self.name

    # ---- hours cap -----------------------------------------------------

    @property
    def has_limit(self):
        return self.hours_limit is not None

    # ---- pay -----------------------------------------------------------

    @property
    def withholds(self):
        """Whether this job's tax is known, as opposed to simply not set."""
        return self.tax_rate is not None

    def pay_for(self, hours):
        """
        What `hours` here comes to. None when there is no rate to price it
        with — a job with no rate has no pay to show, which is not the same
        as a job that paid nothing.
        """
        if self.hourly_rate is None:
            return None
        gross = round(float(self.hourly_rate) * hours, 2)
        tax = round(gross * float(self.tax_rate or 0) / 100, 2)
        return Pay(gross, tax, round(gross - tax, 2))

    def limit_window(self, day=None):
        """
        The [start, end) dates the cap is measured over for `day`.

        Every period reads its start from this workplace, so each job counts
        against its own cycle: a week from the weekday it starts on, a
        fortnight from its anchor date, a month from the day of the month its
        pay period opens.
        """
        day = day or timezone.localdate()

        if self.limit_period == LimitPeriod.WEEK:
            start = week_start(day, self.week_starts_on)
            return start, start + timedelta(days=7)

        if self.limit_period == LimitPeriod.MONTH:
            return month_start(day, self.month_starts_on), next_month_start(day, self.month_starts_on)

        start = fortnight_start(day, self.fortnight_anchor)
        return start, start + timedelta(days=14)

    @property
    def fortnight_runs(self):
        return fortnight_runs(self.fortnight_anchor)

    @property
    def period_label(self):
        return {
            LimitPeriod.WEEK: "week",
            LimitPeriod.MONTH: "month",
        }.get(self.limit_period, "fortnight")

    @transaction.atomic
    def make_default(self):
        """Make this the user's default workplace, demoting any other."""
        Workplace.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(
            is_default=False
        )
        if not self.is_default:
            self.is_default = True
            self.save(update_fields=["is_default"])

    @transaction.atomic
    def delete_or_archive(self):
        """
        Remove the workplace, keeping any timesheet history intact.

        Returns "deleted" when it was genuinely removed (nothing referenced
        it) or "archived" when it had shifts and was hidden instead.
        """
        if self.shifts.exists():
            self.is_archived = True
            self.is_default = False
            self.save(update_fields=["is_archived", "is_default"])
            return "archived"
        self.delete()
        return "deleted"


class Shift(models.Model):
    class Status(models.TextChoices):
        WORKING = "WORKING", "Working"
        ON_BREAK = "ON_BREAK", "On break"
        COMPLETED = "COMPLETED", "Completed"

    OPEN_STATUSES = (Status.WORKING, Status.ON_BREAK)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shifts"
    )
    # SET_NULL rather than PROTECT: a workplace removed straight from the
    # admin shouldn't take the shift history down with it.
    workplace = models.ForeignKey(
        Workplace, on_delete=models.SET_NULL, null=True, blank=True, related_name="shifts"
    )
    clock_in = models.DateTimeField()
    clock_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.WORKING)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-clock_in"]
        indexes = [models.Index(fields=["user", "-clock_in"])]

    def __str__(self):
        return f"{self.user} @ {self.workplace or '—'} on {timezone.localtime(self.clock_in):%d %b}"

    # ---- state ---------------------------------------------------------

    @property
    def is_open(self):
        return self.status in self.OPEN_STATUSES

    @property
    def running_break(self):
        """The break currently in progress, or None."""
        for b in self.breaks.all():
            if b.break_end is None:
                return b
        return None

    @classmethod
    def open_for(cls, user):
        """The user's in-progress shift, if they have one."""
        return (
            cls.objects.filter(user=user, status__in=cls.OPEN_STATUSES)
            .select_related("workplace")
            .prefetch_related("breaks")
            .first()
        )

    # ---- derived totals ------------------------------------------------
    # All three walk the timestamps rather than reading a stored number, so
    # they stay correct after an edit and tick upward live while a shift runs.

    def _end_reference(self, now=None):
        return self.clock_out or (now or timezone.now())

    @property
    def total_duration(self):
        span = self._end_reference() - self.clock_in
        return max(span, timedelta())

    @property
    def total_break(self):
        now = timezone.now()
        total = timedelta()
        for b in self.breaks.all():
            # An unfinished break stops at clock-out if the shift somehow
            # closed with it still open, otherwise it's still running.
            end = b.break_end or self.clock_out or now
            if end > b.break_start:
                total += end - b.break_start
        return total

    @property
    def worked_duration(self):
        return max(self.total_duration - self.total_break, timedelta())

    @property
    def pay(self):
        """This shift's gross, tax and take-home, or None if it has no rate."""
        if not self.workplace:
            return None
        return self.workplace.pay_for(self.worked_duration.total_seconds() / 3600)

    @property
    def estimated_pay(self):
        """Gross for this shift. Kept as the name the rest of the app knows."""
        pay = self.pay
        return pay.gross if pay else None

    # ---- transitions ---------------------------------------------------
    # Each one refuses the moves that don't make sense from where it is, so
    # an impatient double-tap can't open two shifts or two breaks.

    @classmethod
    @transaction.atomic
    def clock_in_now(cls, user, workplace, when=None):
        if cls.open_for(user):
            raise ValidationError("You're already clocked in. Clock out before starting another shift.")
        if workplace is None:
            raise ValidationError("Pick a workplace before clocking in.")
        if workplace.user_id != user.pk:
            raise ValidationError("That workplace isn't yours.")
        return cls.objects.create(
            user=user, workplace=workplace, clock_in=when or timezone.now(),
            status=cls.Status.WORKING,
        )

    @transaction.atomic
    def start_break(self, when=None):
        if self.status == self.Status.ON_BREAK:
            raise ValidationError("You're already on a break.")
        if self.status != self.Status.WORKING:
            raise ValidationError("You can only start a break while working.")

        when = when or timezone.now()
        if when < self.clock_in:
            raise ValidationError("A break can't start before you clocked in.")

        Break.objects.create(shift=self, break_start=when)
        self.status = self.Status.ON_BREAK
        self.save(update_fields=["status", "updated_at"])

    @transaction.atomic
    def end_break(self, when=None):
        if self.status != self.Status.ON_BREAK:
            raise ValidationError("No break is running.")

        running = self.breaks.filter(break_end__isnull=True).order_by("-break_start").first()
        if running is None:
            # Status and rows disagree; put the status back rather than
            # leaving the shift stuck on a break it can never end.
            self.status = self.Status.WORKING
            self.save(update_fields=["status", "updated_at"])
            raise ValidationError("No break is running.")

        when = when or timezone.now()
        if when <= running.break_start:
            raise ValidationError("A break can't end before it started.")

        running.break_end = when
        running.save(update_fields=["break_end"])
        self.status = self.Status.WORKING
        self.save(update_fields=["status", "updated_at"])

    @transaction.atomic
    def clock_out_now(self, when=None):
        if not self.is_open:
            raise ValidationError("This shift is already finished.")
        if self.status == self.Status.ON_BREAK:
            raise ValidationError("End your break before clocking out.")

        when = when or timezone.now()
        if when <= self.clock_in:
            raise ValidationError("Clock-out has to be after clock-in.")

        self.clock_out = when
        self.status = self.Status.COMPLETED
        self.save(update_fields=["clock_out", "status", "updated_at"])

    def clean(self):
        # clock_in can still be unset here: a form whose clock_in failed its
        # own validation leaves it off the instance, and this runs anyway.
        if self.clock_in and self.clock_out and self.clock_out <= self.clock_in:
            raise ValidationError({"clock_out": "Clock-out has to be after clock-in."})


class Break(models.Model):
    """
    One break inside a shift. A shift can hold as many as the day needs; the
    totals above sum whatever is here.
    """

    shift = models.ForeignKey(Shift, on_delete=models.CASCADE, related_name="breaks")
    break_start = models.DateTimeField()
    break_end = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["break_start"]

    def __str__(self):
        return f"Break on {timezone.localtime(self.break_start):%d %b %H:%M}"

    @property
    def is_running(self):
        return self.break_end is None

    @property
    def duration(self):
        end = self.break_end or timezone.now()
        return max(end - self.break_start, timedelta())

    def clean(self):
        if self.break_end and self.break_end <= self.break_start:
            raise ValidationError({"break_end": "A break can't end before it started."})

        # Breaks belong inside their shift, otherwise the totals go negative.
        if self.shift_id:
            shift = self.shift
            if self.break_start < shift.clock_in:
                raise ValidationError({"break_start": "A break can't start before the shift did."})
            if shift.clock_out:
                if self.break_start > shift.clock_out:
                    raise ValidationError({"break_start": "A break can't start after the shift ended."})
                if self.break_end and self.break_end > shift.clock_out:
                    raise ValidationError({"break_end": "A break can't end after the shift did."})


class TimePreference(models.Model):
    """
    Per-user settings that aren't tied to any one workplace.

    The hours cap is *not* here — it lives on each Workplace, so every job is
    counted against its own limit. What's left is where your own week,
    fortnight and month begin (used for the combined "all workplaces" figures
    and the calendar grid), and the phone's timezone.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_pref"
    )
    # Your cycles, for the figures that span every workplace. A workplace's own
    # cap uses that workplace's settings instead.
    week_starts_on = models.IntegerField(choices=Weekday.choices, default=DEFAULT_WEEK_START)
    fortnight_anchor = models.DateField(default=_recent_fortnight_start)
    month_starts_on = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(MAX_MONTH_START_DAY)],
    )

    # The phone's own IANA zone (e.g. "Australia/Sydney"), reported by the
    # browser and refreshed on every clock action. Times are rendered in this
    # rather than the server's TIME_ZONE, so what the app shows matches what
    # the phone's lock screen shows. Blank until a browser has told us.
    timezone_name = models.CharField(max_length=64, blank=True)

    def __str__(self):
        return f"Time preferences for {self.user}"

    @property
    def fortnight_runs(self):
        return fortnight_runs(self.fortnight_anchor)

    @classmethod
    def for_user(cls, user):
        pref, _ = cls.objects.get_or_create(user=user)
        return pref
