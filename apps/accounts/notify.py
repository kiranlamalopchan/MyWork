"""
What friendship tells people about.

Two events, and both are ones a person would want a nudge for: somebody
asked to be your friend, and somebody you asked said yes. Declining and
unfriending stay quiet — the same reason a reaction taken back doesn't ring
anyone, see `apps/noticeboard/notify.py`: an ordinary "no" is not news.
"""

from django.urls import reverse

from apps.notifications.models import Kind
from apps.notifications.notify import notify


def _name(user):
    profile = getattr(user, "profile", None)
    return getattr(profile, "name", None) or user.get_username()


def friend_requested(request):
    """Somebody asked to be friends."""
    notify(
        request.to_user,
        Kind.FRIEND_REQUEST,
        f"{_name(request.from_user)} wants to be friends",
        url=reverse("accounts:friends"),
        actor=request.from_user,
        dedupe_key=f"friend-request:{request.from_user_id}:{request.to_user_id}",
    )


def friend_accepted(accepter, other):
    """`accepter` said yes to `other`'s request — tell `other`."""
    notify(
        other,
        Kind.FRIEND_ACCEPTED,
        f"{_name(accepter)} accepted your friend request",
        url=reverse("accounts:friends"),
        actor=accepter,
    )
