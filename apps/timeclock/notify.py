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

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from apps.notifications.models import Kind
from apps.notifications.notify import notify

from .models import Shift, Workplace
from .views import _limit_for, hm_words

# How long a shift has to have been running before being still clocked in
# looks like a forgotten clock-out rather than a long day. Well past a normal
# shift, so this only ever fires for something that has gone wrong.
LONG_SHIFT = timedelta(hours=10)

# How often to say it again about the same shift. The row is rewritten with
# the current hours, but the phone is only allowed to buzz about it again
# after this — a forgotten clock-out is worth a second nudge, not a tenth.
REMIND_AGAIN = timedelta(hours=3)


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
    it is read.
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
        )
        if notification is not None:
            made.append(notification)

    return made


def run_all(now=None):
    """Both reminders, which is what the scheduled task runs."""
    now = now or timezone.now()
    return open_shift_reminders(now) + limit_reminders(timezone.localdate())
