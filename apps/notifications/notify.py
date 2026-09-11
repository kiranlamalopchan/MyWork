"""
The one way anything in MyWork raises a notification.

Two steps, always in this order: write it down, then try to interrupt them
about it. The record is the part that must not fail — it is what the bell
counts and the inbox lists — so the push goes second and its failure is
nobody's problem but the log's.

Apps do not call `push` or `Notification` directly. They call `notify()` or
`notify_many()` with a line of text and a URL, and describe their own events
in their own `notify.py` — `apps/noticeboard/notify.py` knows what a comment
is, this file never has to.
"""

import logging

from django.utils import timezone

from . import push
from .models import Notification

log = logging.getLogger(__name__)


def notify(recipient, kind, title, *, url, body="", actor=None, emoji="",
           dedupe_key="", renotify_after=None):
    """
    Tell one person about one thing. Returns the record, or None if there was
    nothing to tell them (they caused it themselves).

    A repeat under an existing `dedupe_key` updates the line quietly and does
    not buzz again — somebody changing their mind from a thumb to a heart is
    not a second event. `renotify_after` is the exception, for the reminders:
    a forgotten clock-out is worth saying again after a few hours, and passing
    a timedelta says how long the quiet lasts before the same line is allowed
    to interrupt a second time.
    """
    notification, is_new = Notification.raise_for(
        recipient, kind, title,
        url=url, body=body, actor=actor, emoji=emoji, dedupe_key=dedupe_key,
    )
    if notification is None:
        return None

    if is_new:
        Notification.trim(recipient)

    if is_new or _due_again(notification, renotify_after):
        _deliver(notification)
    return notification


def _due_again(notification, renotify_after):
    """
    Whether a rewritten line has been quiet long enough to be said out loud
    again. False whenever no window was given, which is every caller but the
    reminders.
    """
    previous_at = getattr(notification, "previous_at", None)
    if renotify_after is None or previous_at is None:
        return False
    return timezone.now() - previous_at >= renotify_after


def notify_many(recipients, kind, title, *, url, body="", actor=None, emoji="",
                dedupe_key="", renotify_after=None):
    """
    The same, to everybody at once — a new notice going out to the board.

    Recipients are de-duplicated by primary key, because the obvious way to
    build the list (the notice's author, plus everyone who commented, plus
    everyone who reacted) has the same person on it more than once, and being
    told twice about one thing is worse than a slightly longer function here.
    """
    seen, made = set(), []
    for recipient in recipients:
        if recipient is None or recipient.pk in seen:
            continue
        seen.add(recipient.pk)
        notification = notify(
            recipient, kind, title,
            url=url, body=body, actor=actor, emoji=emoji, dedupe_key=dedupe_key,
            renotify_after=renotify_after,
        )
        if notification is not None:
            made.append(notification)
    return made


def _deliver(notification):
    """
    Try to put it on their devices. Never raises.

    Wrapped rather than trusted: this runs inside the POST that posted a
    notice, and a push service having a bad afternoon must not turn somebody
    else's post into an error page.
    """
    if not push.configured():
        return
    try:
        unread = Notification.unread_count(notification.recipient)
        push.send_to_user(notification.recipient, push.payload_for(notification, unread))
    except Exception:
        log.exception("delivering notification %s failed", notification.pk)
