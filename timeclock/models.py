"""
Time tracking: workplaces, shifts, and the breaks inside them.

Durations are never stored. Everything (shift length, break time, net worked
hours) is derived from the raw clock_in / clock_out / break_start / break_end
timestamps, so correcting a time on the edit page automatically corrects every
total that was built from it — there are no stale cached numbers to go stale.
"""

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone


def _monday_of_this_week():
    """Default fortnight anchor: the Monday of the current week."""
    today = timezone.localdate()
    return today - timedelta(days=today.weekday())


def week_start(day):
    """Monday of the week `day` falls in."""
    return day - timedelta(days=day.weekday())


def fortnight_start(day, anchor):
    """
    Start of the 14-day block `day` falls in, counting from `anchor`.

    Floor division keeps this correct for dates before the anchor too
    (-1 // 14 == -1), so a shift back-dated past the anchor lands in the
    fortnight that actually contains it rather than the anchor's own.
    """
    return anchor + timedelta(days=((day - anchor).days // 14) * 14)


class Workplace(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workplaces"
    )
    name = models.CharField(max_length=120)
    address = models.CharField(max_length=255, blank=True)
    hourly_rate = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True,
        help_text="Optional. Used to estimate pay alongside your hours.",
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
    def estimated_pay(self):
        if not self.workplace or self.workplace.hourly_rate is None:
            return None
        hours = self.worked_duration.total_seconds() / 3600
        return round(float(self.workplace.hourly_rate) * hours, 2)

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
        if self.clock_out and self.clock_out <= self.clock_in:
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
    """Per-user settings for the hours cap shown on the timesheet."""

    class Period(models.TextChoices):
        WEEK = "WEEK", "Per week"
        FORTNIGHT = "FORTNIGHT", "Per fortnight"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_pref"
    )
    # Null means "no cap" — the limit card simply doesn't appear.
    hours_limit = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    limit_period = models.CharField(
        max_length=9, choices=Period.choices, default=Period.FORTNIGHT
    )
    # Which Monday the fortnight cycle counts from, so "this fortnight" means
    # the same 14 days for the user every time.
    fortnight_anchor = models.DateField(default=_monday_of_this_week)

    # The phone's own IANA zone (e.g. "Australia/Sydney"), reported by the
    # browser and refreshed on every clock action. Times are rendered in this
    # rather than the server's TIME_ZONE, so what the app shows matches what
    # the phone's lock screen shows. Blank until a browser has told us.
    timezone_name = models.CharField(max_length=64, blank=True)

    def __str__(self):
        return f"Time preferences for {self.user}"

    @classmethod
    def for_user(cls, user):
        pref, _ = cls.objects.get_or_create(user=user)
        return pref
