"""
What every page needs to know about notifications: how many are waiting, and
the key a browser needs in order to subscribe.

Both are read here rather than by each view, because the bell lives in
base.html and base.html renders on every page in MyWork.
"""

from .models import MAX_BADGE, Notification
from .push import public_key


def notifications(request):
    user = getattr(request, "user", None)
    count = Notification.unread_count(user)

    return {
        "unread_notifications": count,
        # "99+" past the point where the exact number stops meaning anything.
        "unread_badge": f"{MAX_BADGE}+" if count > MAX_BADGE else count,
        # Empty when push is not configured, which is how the page knows not
        # to offer a switch that could not do anything.
        "vapid_public_key": public_key(),
    }
