"""Who is here.

The notice board shows a dot on the face of anybody using MyWork right now, and
this is what feeds it: every page a signed-in person asks for records that they
asked for it.

Presence is measured from requests on purpose. It answers "was this person
moving around the app just now?" rather than "is a tab open somewhere?" — a
phone in a pocket with the board still on screen is not somebody you can get
hold of, and a dot that says otherwise is worse than no dot.

The write is throttled to once a minute per person (Profile.touch), so a busy
session is one UPDATE a minute rather than one per page.
"""

from apps.accounts.models import Profile


class PresenceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)

        if user is not None and user.is_authenticated:
            # Never on the way in: a page nobody is waiting for should not be
            # held up by a write, and a request that turns out to be a 404 or
            # a redirect still means the person is here.
            response = self.get_response(request)
            profile = Profile.of(user)
            if profile is not None:
                profile.touch()
            return response

        return self.get_response(request)
