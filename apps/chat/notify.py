"""A friend wrote to you."""

from datetime import timedelta
from urllib.parse import quote

from apps.accounts.avatars import display_name
from apps.notifications.models import Kind
from apps.notifications.notify import notify


def chat_url(user):
    """The profile page on the site, the conversation in the app (mobile/src/nav/paths.ts)."""
    return f"/profile/?chat={quote(user.get_username())}"


def message_sent(message):
    """
    One line in the inbox per conversation, however many messages are
    waiting in it — and a buzz for each, which is what a zero-length quiet
    window asks for: the line is rewritten, and said out loud again.
    """
    body = message.body if len(message.body) <= 160 else message.body[:157] + "…"
    return notify(
        message.recipient, Kind.MESSAGE, display_name(message.sender),
        body=body, url=chat_url(message.sender), actor=message.sender,
        dedupe_key=f"chat:{message.sender_id}", renotify_after=timedelta(0),
    )
