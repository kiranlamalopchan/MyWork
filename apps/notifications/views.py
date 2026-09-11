"""
The inbox behind the bell, and the two endpoints a browser talks to.

The pages are ordinary Django: a list, and a POST that empties it. The two
subscription endpoints are the only JSON in MyWork, and they are JSON because
their caller is the service-worker registration in notifications.js rather
than a form somebody submitted — there is no page to render back to.
"""

import json

from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import Notification, PushSubscription
from .push import configured

# A page of the inbox. Enough that a day away still fits on one screenful of
# scrolling, few enough that the page is light on a phone.
PAGE_SIZE = 30


@login_required
def inbox(request):
    """
    Everything you have been told, newest first.

    Opening the inbox is what marks it read — the bell means "there is
    something you have not seen", and you have now seen it. Which rows *were*
    unread is captured before that happens, so the page you are looking at
    still shows you what was new; it is the next page load that comes back
    quiet.
    """
    page_obj = Paginator(Notification.inbox(request.user), PAGE_SIZE).get_page(
        request.GET.get("page")
    )
    for notification in page_obj.object_list:
        notification.was_unread = notification.is_unread

    Notification.mark_all_read(request.user)

    return render(request, "notifications/inbox.html", {
        "page_obj": page_obj,
        "notifications": page_obj,
        "section_title": "Notifications",
        # The switch at the top of the page only appears where it could do
        # something: no keys configured, no offer to turn anything on.
        "push_available": configured(),
        "devices": PushSubscription.objects.filter(user=request.user).count(),
    })


@login_required
def go(request, pk):
    """
    Follow one notification to the thing it is about.

    This is what a notification on a lock screen points at, rather than the
    board directly, so that tapping it is what marks it read — the count on
    the icon goes down because you dealt with it, not because you happened to
    open the app afterwards.

    A notification that has since been trimmed away lands you on the board
    rather than on a 404: whatever it was about is still there, and a dead end
    is a poor reward for tapping.
    """
    try:
        notification = get_object_or_404(
            Notification.objects.filter(recipient=request.user), pk=pk
        )
    except Http404:
        return redirect("home")

    if notification.is_unread:
        notification.read_at = timezone.now()
        notification.save(update_fields=["read_at"])

    return redirect(notification.url or reverse("home"))


@require_POST
@login_required
def read_all(request):
    """Empty the bell without reading anything."""
    Notification.mark_all_read(request.user)
    return redirect(request.POST.get("next") or reverse("notifications:inbox"))


# ---------------------------------------------------------------------------
# What the browser talks to
# ---------------------------------------------------------------------------

def _subscription_from(request):
    """
    The three fields out of the object `pushManager.subscribe()` returned.

    Anything malformed is a bad request rather than an exception: this is an
    endpoint reached by script, and scripts are where half-built objects and
    old cached workers come from.
    """
    try:
        data = json.loads(request.body or b"{}")
        endpoint = data["endpoint"]
        keys = data["keys"]
        return endpoint, keys["p256dh"], keys["auth"]
    except (ValueError, KeyError, TypeError):
        return None


@require_POST
@login_required
def subscribe(request):
    """
    Remember this device, so it can be reached with the app closed.

    Called every time the page loads with permission already granted, not
    only the first time: browsers rotate endpoints on their own, and a
    subscription MyWork never heard about is one that silently stops working.
    `PushSubscription.store` makes that idempotent.
    """
    parsed = _subscription_from(request)
    if parsed is None:
        return JsonResponse({"ok": False, "error": "malformed subscription"}, status=400)

    endpoint, p256dh, auth = parsed
    PushSubscription.store(
        request.user, endpoint, p256dh, auth,
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )
    return JsonResponse({"ok": True})


@require_POST
@login_required
def unsubscribe(request):
    """
    Forget this device.

    Only ever your own row, looked up by endpoint *and* user: an endpoint is
    a long random string, but it arrives from the client and is not a thing
    to delete on the strength of on its own.
    """
    parsed = _subscription_from(request)
    endpoint = parsed[0] if parsed else None
    if not endpoint:
        try:
            endpoint = json.loads(request.body or b"{}").get("endpoint")
        except ValueError:
            endpoint = None
    if not endpoint:
        return JsonResponse({"ok": False, "error": "no endpoint"}, status=400)

    PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
    return JsonResponse({"ok": True})
