"""
What the board tells people about.

The notifications app knows how to reach somebody; this file knows what is
worth reaching them for. Keeping the two apart is what lets the board decide
that a reply pings the person being answered without the mailbox ever
learning what a reply is.

Three events, and the reasoning behind each is the same question: would this
person want their phone to buzz? A new notice, yes — that is the point of a
board. Somebody answering you, yes. Somebody putting a face on what you
wrote, yes, but only once however many times they change their mind.

Nothing here raises. Every one of these is called from a view that has just
saved something, and a notification that fails must not undo a notice that
succeeded — so `notify` swallows its own delivery failures and the calls sit
after the save rather than inside it.
"""

from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.notifications.models import Kind
from apps.notifications.notify import notify, notify_many

# How much of what was written rides along in the notification. Long enough
# to know whether to get up and read it, short enough to fit on a lock screen
# without being cut off mid-word by the phone instead of by us.
EXCERPT = 140


def _name(user):
    """What to call somebody in a notification: their chosen name, else their
    username — the same name the app bar and the board use."""
    profile = getattr(user, "profile", None)
    return getattr(profile, "name", None) or user.get_username()


def _excerpt(text):
    text = " ".join((text or "").split())
    return text if len(text) <= EXCERPT else text[:EXCERPT - 1].rstrip() + "…"


def _notice_url(notice, anchor=None):
    """
    Where a notification about this notice points.

    Both halves matter. `?notice=` tells the board which page to render, so a
    link to something from last week does not land on today; the anchor tells
    the browser where on that page to go, and the board highlights whatever it
    finds there — see initArrival in app.js.
    """
    board = reverse("notices:board")
    return f"{board}?notice={notice.pk}#{anchor or f'notice-{notice.pk}'}"


# ---------------------------------------------------------------------------
# A notice goes to everybody
# ---------------------------------------------------------------------------

def notice_posted(notice):
    """
    Tell the rest of the board there is something new on it.

    Everyone with an active account, because that is what a shared wall is —
    a notice nobody was told about is a notice pinned facing the wall. The
    author is dropped by `notify()` itself rather than excluded here.
    """
    people = get_user_model().objects.filter(is_active=True).exclude(pk=notice.author_id)

    notify_many(
        people,
        Kind.NOTICE,
        f"{_name(notice.author)} posted a notice",
        body=_excerpt(notice.body),
        url=_notice_url(notice),
        actor=notice.author,
    )


# ---------------------------------------------------------------------------
# A comment goes to the people already in the conversation
# ---------------------------------------------------------------------------

def comment_posted(comment):
    """
    Tell whoever is in this thread that somebody has said something.

    Who that is depends on what was written. A comment on a notice reaches
    its author. A reply reaches the person being replied to *and* the notice's
    author, because a thread under your notice is still your notice — and if
    they are the same person, `notify_many` sees the duplicate and tells them
    once.

    People further down the thread are deliberately left out. A board this
    size does not need a notification for every message in a conversation you
    once said something in; the dot on the board is enough for that.
    """
    notice = comment.notice
    author = comment.author
    reply_to = comment.parent.author if comment.parent_id else None

    kind = Kind.REPLY if reply_to else Kind.COMMENT
    verb = "replied to you" if reply_to else "commented on your notice"

    notify_many(
        [reply_to, notice.author],
        kind,
        f"{_name(author)} {verb}",
        body=_excerpt(comment.body),
        url=_notice_url(notice, anchor=f"comment-{comment.pk}"),
        actor=author,
    )


# ---------------------------------------------------------------------------
# A reaction goes to whoever wrote the thing
# ---------------------------------------------------------------------------

def notice_reacted(notice, actor, emoji):
    """Somebody put a face on a notice."""
    _reacted(notice.author, actor, emoji, "your notice", _notice_url(notice),
             f"reaction:notice:{notice.pk}:{actor.pk}", notice.body)


def comment_reacted(comment, actor, emoji):
    """The same, on a comment."""
    _reacted(comment.author, actor, emoji, "your comment",
             _notice_url(comment.notice, anchor=f"comment-{comment.pk}"),
             f"reaction:comment:{comment.pk}:{actor.pk}", comment.body)


def _reacted(recipient, actor, emoji, what, url, dedupe_key, text):
    """
    One person's reaction to one thing.

    `emoji` is whatever `ReactionBase.toggle` was left holding, so None means
    they took it back — and taking a reaction back is not news. Changing it
    from a thumb to a heart is, but it is the *same* news, which is what the
    dedupe key is for: the unread line is rewritten rather than joined by a
    second one, and a person tapping through the menu cannot ring somebody's
    phone six times.
    """
    if not emoji:
        return

    notify(
        recipient,
        Kind.REACTION,
        f"{_name(actor)} reacted to {what}",
        body=_excerpt(text),
        url=url,
        actor=actor,
        emoji=emoji,
        dedupe_key=dedupe_key,
    )
