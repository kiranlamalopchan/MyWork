"""
What TimeSheet tells people about.

Everything the board notifies about is somebody else doing something. Nothing
here is: these are the two things the app notices on its own, about you, when
you are not looking at it.

Both are *reminders*, which is a different promise from the board's. A
reminder that arrives twice is worse than one that arrives late, so each
carries a dedupe key naming the thing it is about — this shift, this period
at this workplace — and the scheduled task behind it can run every twenty
minutes without anybody's phone buzzing twice about the same forgotten
clock-out. What it does instead is rewrite the line it already sent, so the
hours in it stay current.

Reading the figures, rather than working them out again: `_limit_for` is the
same function the TimeSheet dashboard draws its bar from, and `hm_words` the
same words it prints. A reminder that disagreed with the screen it is telling
you to go and look at would be worse than no reminder.
"""

import zoneinfo
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from apps.notifications.models import Kind
from apps.notifications.notify import notify

from .models import PayCycle, Shift, Workplace, pay_total
from .views import _limit_for, hm_words

# Not before this hour of the person's own morning: a summary of the pay
# period is something to read over breakfast, not to be woken by at midnight
# on the stroke of payday.
PAYDAY_HOUR = 8
PAYDAY_ONCE = timedelta(days=3)

# How long a shift has to have been running before being still clocked in
# looks like a forgotten clock-out rather than a long day. Well past a normal
# shift, so this only ever fires for something that has gone wrong.
LONG_SHIFT = timedelta(hours=10)

# How often either reminder is allowed to interrupt about the same thing.
# The row is rewritten on every sweep so the hours in it stay current, but the
# phone only buzzes again once this much quiet has passed — a forgotten
# clock-out, or a cap you are still over, is worth a second nudge, not a
# tenth. Being over a cap is a state rather than an event: without a window it
# would be news again on every sweep for as long as it stayed true.
REMIND_AGAIN = timedelta(hours=4)


def open_shift_reminders(now=None):
    """
    Nudge anyone who has been clocked in a very long time.

    Returns the notifications raised, for the command to report.
    """
    now = now or timezone.now()
    made = []

    shifts = (
        Shift.objects.filter(status__in=Shift.OPEN_STATUSES)
        .select_related("user", "user__profile", "workplace")
        .prefetch_related("breaks")
    )

    for shift in shifts:
        worked = shift.worked_duration
        if worked < LONG_SHIFT:
            continue

        where = shift.workplace.name if shift.workplace else "work"
        notification = notify(
            shift.user,
            Kind.TIMESHEET,
            "You're still clocked in",
            body=f"{hm_words(worked)} at {where}. Clock out if the shift has ended.",
            url=reverse("timeclock:dashboard"),
            dedupe_key=f"timesheet:open:{shift.pk}",
            renotify_after=REMIND_AGAIN,
        )
        if notification is not None:
            made.append(notification)

    return made


def limit_reminders(today=None):
    """
    Nudge anyone close to, or past, a cap they set themselves.

    Only workplaces with a limit are looked at, and only the ones `_limit_for`
    calls "close" or "over" — the same amber and red the dashboard's bar uses,
    so a notification and the page it points at always agree.

    One per workplace per period, keyed on the period's start date. A cap
    crossed on Tuesday and still crossed on Friday is one fact, and the row is
    rewritten rather than repeated, so the number in it is current whenever
    it is read — and `REMIND_AGAIN` is what keeps that one fact from ringing
    a phone every twenty minutes until the fortnight turns over.
    """
    today = today or timezone.localdate()
    made = []

    workplaces = (
        Workplace.objects.filter(hours_limit__isnull=False)
        .select_related("user", "user__profile")
        .prefetch_related("payments")
    )

    for workplace in workplaces:
        limit = _limit_for(workplace.user, workplace, today)
        if limit is None or limit["state"] == "ok":
            continue

        used, cap = hm_words(limit["used"]), hm_words(limit["cap"])
        period = limit["period_label"]

        if limit["state"] == "over":
            title = f"Over your {period}ly hours at {workplace.name}"
            body = f"{used} of {cap} — {hm_words(limit['over'])} over."
        else:
            title = f"Close to your {period}ly hours at {workplace.name}"
            body = f"{used} of {cap} — {hm_words(limit['remaining'])} left."

        notification = notify(
            workplace.user,
            Kind.TIMESHEET,
            title,
            body=body,
            url=reverse("timeclock:dashboard"),
            dedupe_key=f"timesheet:limit:{workplace.pk}:{limit['period_start']}:{limit['state']}",
            renotify_after=REMIND_AGAIN,
        )
        if notification is not None:
            made.append(notification)

    return made


def _their_now(user, now):
    """`now` on the clock of whoever is being told, where the app knows it."""
    name = getattr(getattr(user, "time_pref", None), "timezone_name", "") or ""
    try:
        return now.astimezone(zoneinfo.ZoneInfo(name)) if name else timezone.localtime(now)
    except Exception:
        return timezone.localtime(now)


def payday_summaries(now=None):
    """
    After a period closes, what it came to: hours, what should land, and how it
    compares with the period before.

    Only jobs that pay on a cycle have a payday to speak of, and only a
    period with hours in it is worth a line. Once per job per period — the
    key is the period's end — so however many sweeps pass over payday, it is
    said once. The figures are `pay_total`'s, the same ones the Pay page
    shows, so the line and the page it opens agree to the cent.
    """
    now = now or timezone.now()
    made = []

    workplaces = (
        Workplace.objects.exclude(pay_cycle=PayCycle.IRREGULAR)
        .select_related("user", "user__profile", "user__time_pref")
        .prefetch_related("payments")
    )

    for workplace in workplaces:
        if not workplace.pays_on_a_cycle:
            continue
        theirs = _their_now(workplace.user, now)
        if theirs.hour < PAYDAY_HOUR:
            continue
        # The dates are the person's own: activate their zone for the sums.
        with timezone.override(theirs.tzinfo):
            today = theirs.date()
            # Wait until the following morning: sending at 8am on the last
            # day would omit everybody working later that same day.
            start, end = workplace.pay_window(today - timedelta(days=1))
            if end != today:
                continue
            shifts = [s for s in workplace.shifts_between(start, end) if not s.is_open]
            worked = sum((s.worked_duration for s in shifts), timedelta())
            if not worked:
                continue
            before = sum(
                (s.worked_duration for s in workplace.shifts_between(*workplace.pay_window(start - timedelta(days=1))) if not s.is_open),
                timedelta(),
            )
            total = pay_total(shifts)

        parts = [f"{hm_words(worked)} this {workplace.pay_cycle_label}"]
        if total is not None:
            parts.append(f"about ${total.net:,.2f} to come" if total.tax else f"${total.gross:,.2f} to come")
        if before:
            gap = worked - before
            if abs(gap) >= timedelta(minutes=15):
                parts.append(f"{hm_words(abs(gap))} {'more' if gap > timedelta() else 'less'} than last {workplace.pay_cycle_label}")
            else:
                parts.append(f"the same as last {workplace.pay_cycle_label}")

        notification = notify(
            workplace.user,
            Kind.TIMESHEET,
            f"Payday at {workplace.name}",
            body=" · ".join(parts) + ".",
            url=reverse("timeclock:payments"),
            dedupe_key=f"timesheet:payday:{workplace.pk}:{end}",
            # One line, said once: the sweep passes over payday dozens of
            # times, and a window longer than the day keeps every pass after
            # the first to a quiet rewrite, read or not.
            renotify_after=PAYDAY_ONCE,
        )
        if notification is not None:
            made.append(notification)

    return made


def run_all(now=None):
    """Every reminder, which is what the scheduled task runs."""
    now = now or timezone.now()
    return open_shift_reminders(now) + limit_reminders(timezone.localdate(now)) + payday_summaries(now)
