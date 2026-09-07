"""
Render every page in the phone's timezone rather than the server's.

The browser reports its IANA zone on each clock action (see app.js); this
activates it for the rest of the request, so template `|date` / `|time`
filters, `{% now %}` and localdate() all agree with the clock on the phone
in the user's hand. Without it, everything renders in settings.TIME_ZONE,
which is wherever the server happens to think it is.
"""

import zoneinfo

from django.utils import timezone


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
