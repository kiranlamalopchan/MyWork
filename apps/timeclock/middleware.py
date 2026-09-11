"""
Two things TimeSheet does to every request.

The first renders the page in the phone's timezone rather than the server's.
The browser reports its IANA zone on each clock action (see app.js); this
activates it for the rest of the request, so template `|date` / `|time`
filters, `{% now %}` and localdate() all agree with the clock on the phone in
the user's hand. Without it, everything renders in settings.TIME_ZONE, which
is wherever the server happens to think it is.

The second is the closest thing this project has to a cron. With no worker
and no usable scheduler on a free host, the timesheet reminders ride on
ordinary web traffic instead — see `ReminderSweepMiddleware` at the foot of
the file.
"""

import logging
import zoneinfo
from datetime import timedelta

from django.utils import timezone

log = logging.getLogger(__name__)


class UserTimezoneMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # The cookie is written by app.js on every page load, so it's the
        # freshest word on where the phone is and it costs no query. The
        # stored preference is the fallback for the first visit, and for a
        # browser that has cleared its cookies.
        name = (request.COOKIES.get("plu_tz") or "").strip()[:64]

        if not name:
            user = getattr(request, "user", None)
            if user is not None and user.is_authenticated:
                pref = getattr(user, "time_pref", None)
                name = getattr(pref, "timezone_name", "") or ""

        if name:
            try:
                timezone.activate(zoneinfo.ZoneInfo(name))
            except Exception:
                # A stale or bogus zone falls back to the server default
                # rather than 500-ing every page the user opens.
                timezone.deactivate()
        else:
            timezone.deactivate()

        try:
            return self.get_response(request)
        finally:
            # Threads are reused between requests; leaving a zone active
            # would leak it into the next user's rendering.
            timezone.deactivate()


class ReminderSweepMiddleware:
    """
    Run the timesheet reminders off the back of ordinary page loads.

    There is no cron here to run them properly. A free PythonAnywhere account
    gets one scheduled task, once a day, which would mean hearing about a
    clock-out you forgot at four in the afternoon at nine in the evening —
    late enough to be an accusation rather than a reminder. So the sweep rides
    on traffic instead: every request asks whether it is due, and roughly four
    times an hour one of them finds that it is and runs it.

    What that buys and what it costs are both worth being clear about. It
    costs one indexed UPDATE per request — the same bargain
    PresenceMiddleware already makes to put a dot on somebody's face, and the
    reason the check is a single statement rather than a read followed by a
    write. What it buys is a reminder within about fifteen minutes for as long
    as anybody is using MyWork, which on a shared board is most of a working
    day. What it cannot do is fire at three in the morning with nobody
    around — the daily scheduled task is still worth pointing at this same
    command as a backstop for exactly that.

    It runs after the response, never before it: nobody should wait on a push
    to a phone that is not theirs to see a page they asked for.
    """

    # How often the sweep is allowed to run. Short enough that a forgotten
    # clock-out is caught while it still reads as a reminder, long enough that
    # the overwhelming majority of requests do nothing but the one UPDATE.
    EVERY = timedelta(minutes=15)

    # The only paths not worth asking on. Everything else — a redirect, a 404,
    # somebody's first sight of the login page — is a real request from a real
    # person and is as good a moment as any.
    SKIP_PREFIXES = ("/static/", "/media/", "/sw.js")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if not request.path.startswith(self.SKIP_PREFIXES):
            self._sweep()

        return response

    def _sweep(self):
        """
        Run the reminders if they are due. Never raises.

        Wrapped because this hangs off every page in MyWork: a reminder that
        cannot be worked out, or a push service that is down, must not turn
        somebody's timesheet into an error page.
        """
        from apps.notifications.models import Sweep

        try:
            if Sweep.claim("timesheet-reminders", self.EVERY):
                from .notify import run_all

                run_all()
        except Exception:
            log.exception("the timesheet reminder sweep failed")
