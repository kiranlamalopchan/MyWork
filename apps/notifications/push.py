"""
Getting a notification onto a phone that isn't looking at MyWork.

Two ways there. Web Push, with VAPID, for the site on a phone's browser or
Home Screen: the browser gives out an endpoint on its own push service —
Google's for Chrome, Apple's for Safari, Mozilla's for Firefox — and a pair
of keys. MyWork encrypts the payload to those keys and signs the request
with its own, so the push service can carry the message without being able
to read it and cannot be used by anyone else to impersonate this site. And
Expo's push service, for the native app (mobile/): the app hands over a
token, and Expo carries the message on to Apple or Google.

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

try:
    import requests
except ImportError:  # pragma: no cover — pywebpush brings it; belt and braces
    requests = None

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
    Push `payload` to every device `user` has subscribed — browsers by Web
    Push, phones with the app by Expo.

    Returns how many were reached. Dead subscriptions and gone phones are
    deleted on the way through, so the tables clean themselves up as they
    are used.
    """
    from .models import Device, PushSubscription

    reached = 0
    if configured():
        subscriptions = list(PushSubscription.objects.filter(user=user))
        reached += sum(send(subscription, payload) for subscription in subscriptions)
    devices = list(Device.objects.filter(user=user))
    if devices:
        reached += send_expo(devices, payload)
    return reached


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


# Expo's push service: one request carries a message per phone, and answers
# with a ticket per message in the same order.
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_expo(devices, payload):
    """
    Push to phones running the app. How many Expo took it for.

    The same payload the service worker gets, rearranged the way Expo wants
    it: the title and body to show, and the rest under `data` for the app to
    act on when the banner is tapped. A phone that has deleted the app comes
    back as DeviceNotRegistered, and its row goes; anything else is logged
    and let go, as with Web Push.
    """
    if requests is None:
        log.warning("requests is not installed — notifications recorded but not pushed to phones")
        return 0

    messages = [
        {
            "to": device.expo_token,
            "title": payload["title"],
            "body": payload["body"],
            "data": {"url": payload["url"], "tag": payload["tag"]},
            "badge": payload["badge"],
            "sound": "default",
            "priority": "high",
        }
        for device in devices
    ]
    try:
        response = requests.post(
            EXPO_PUSH_URL, json=messages, timeout=TIMEOUT,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        tickets = response.json().get("data", [])
    except Exception as exc:  # network down, DNS, Expo having a bad afternoon
        log.warning("push to %s's phones could not be sent: %s", devices[0].user, exc)
        return 0

    reached = 0
    now = timezone.now()
    for device, ticket in zip(devices, tickets):
        if ticket.get("status") == "ok":
            device.last_sent_at = now
            device.save(update_fields=["last_sent_at"])
            reached += 1
        elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            device.delete()
            log.info("dropped a phone that no longer has the app for %s", device.user)
        else:
            log.warning("push to %s's phone failed (%s)", device.user, ticket.get("message") or ticket)
    return reached


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
