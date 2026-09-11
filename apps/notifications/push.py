"""
Getting a notification onto a phone that isn't looking at MyWork.

Web Push, with VAPID. The browser gives out an endpoint on its own push
service — Google's for Chrome, Apple's for Safari, Mozilla's for Firefox —
and a pair of keys. MyWork encrypts the payload to those keys and signs the
request with its own, so the push service can carry the message without being
able to read it and cannot be used by anyone else to impersonate this site.

Everything in here is optional and everything in here is quiet. If no VAPID
keys are configured, `configured()` is False and sending is a no-op — the
notification is still recorded, the bell still counts it, and the app runs on
a laptop with nothing set up. If a send fails, it is logged and swallowed:
somebody posting to the board must not see a 500 because a push service was
having a bad afternoon.

Sends happen inline, in the request that caused them. For a board this size
that is a few hundred milliseconds on a POST that already redirects; if it
ever stops being, the fan-out moves to a management command and a scheduled
task, not to a queue this project would otherwise have no reason to run.
"""

import json
import logging

from django.conf import settings
from django.urls import reverse
from django.utils import timezone

log = logging.getLogger(__name__)

# How long to wait on one push service before giving up on that device. Short
# on purpose: a person is waiting on the redirect behind this.
TIMEOUT = 5

# The push service is told how long to hold a message for a device that is
# off. A day — after that the notification has been overtaken by the app
# itself, which shows the same thing in the inbox.
TTL = 86400


def configured():
    """Whether this deployment can send at all."""
    return bool(
        getattr(settings, "VAPID_PRIVATE_KEY", "")
        and getattr(settings, "VAPID_PUBLIC_KEY", "")
    )


def public_key():
    """The key a browser needs to subscribe, or "" when push is off."""
    return getattr(settings, "VAPID_PUBLIC_KEY", "") if configured() else ""


def _claims():
    """
    Who is sending. The push service wants a way to reach the operator of a
    site that starts behaving badly; `mailto:` is the only scheme any of them
    accept.
    """
    contact = getattr(settings, "VAPID_CONTACT_EMAIL", "") or "admin@example.com"
    return {"sub": f"mailto:{contact}"}


def send_to_user(user, payload):
    """
    Push `payload` to every device `user` has subscribed.

    Returns how many were reached. Dead subscriptions are deleted on the way
    through, so the table cleans itself up as it is used.
    """
    from .models import PushSubscription

    if not configured():
        return 0

    subscriptions = list(PushSubscription.objects.filter(user=user))
    return sum(send(subscription, payload) for subscription in subscriptions)


def send(subscription, payload):
    """
    Push to one device. True if the push service took it.

    Every failure is handled the same way — logged, not raised — but they are
    told apart first, because a 410 means something different from a timeout:
    one is a device that is gone and should stop being tried, the other is a
    device that is fine and was unreachable this second.
    """
    if not configured():
        return False

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log.warning("pywebpush is not installed — notifications recorded but not pushed")
        return False

    try:
        webpush(
            subscription_info=subscription.as_info(),
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims=dict(_claims()),
            ttl=TTL,
            timeout=TIMEOUT,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        # 404: the endpoint never existed. 410 Gone: the browser has dropped
        # this subscription — reinstalled, cleared, or permission revoked.
        # Either way it will never work again, so the row goes.
        if status in (404, 410):
            subscription.delete()
            log.info("dropped dead push subscription for %s", subscription.user)
        else:
            log.warning("push to %s failed (%s)", subscription.user, status or exc)
        return False
    except Exception as exc:  # network down, DNS, a proxy in the way
        log.warning("push to %s could not be sent: %s", subscription.user, exc)
        return False

    subscription.last_sent_at = timezone.now()
    subscription.save(update_fields=["last_sent_at"])
    return True


def payload_for(notification, unread):
    """
    What the service worker is handed, and the whole of what it gets.

    Deliberately small and already written: the worker does no formatting and
    asks the server no questions, because it runs with the app closed and a
    fetch from it is a fetch that can fail with nothing on screen to say so.

    The URL is the notification's own go-link rather than the board it points
    at, so that tapping the banner is what marks it read — the count on the
    icon goes down because it was dealt with, not because the app happened to
    be opened later.

    `tag` is what lets a second notification about the same notice replace the
    first on the lock screen instead of stacking under it. `badge` is the
    number the home-screen icon wears, so the count on the icon and the count
    on the bell are the same number from the same place.
    """
    return {
        "title": notification.title,
        "body": notification.body,
        "url": reverse("notifications:go", args=[notification.pk]),
        "tag": notification.dedupe_key or f"n{notification.pk}",
        "badge": unread,
    }
