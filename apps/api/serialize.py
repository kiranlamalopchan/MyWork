"""
The shapes the app is handed, in one place, so a person, a notice or a
reaction tally is the same JSON on every screen that shows one.

Plain functions over the models rather than serializer classes: everything
here reads what the models already know how to say — `Profile.name`,
`Social.reaction_groups`, `Notice.thread` — and writes it down, so the
board's rules live in one place and the API can't drift from the site.
"""

from django.core.paginator import Paginator
from django.utils import timezone
from django.utils.timesince import timesince

from apps.accounts.models import Profile
from apps.holidays.whereabouts import guess_state
from apps.noticeboard.models import Emoji
from apps.noticeboard.views import COMMENTS_SHOWN, REPLIES_SHOWN
from mywork.version import VERSION


def absolute(request, url):
    """A media path as a URL a phone can fetch, or None for nothing."""
    return request.build_absolute_uri(url) if url else None


def ago(when):
    """"just now", "3 minutes ago" — the words the site uses."""
    if timezone.now() - when < timezone.timedelta(seconds=60):
        return "just now"
    return timesince(when, timezone.now()).split(",")[0] + " ago"


def page_of(request, items, per_page, page=None):
    """
    A page of `items` (a queryset or a list) with the numbers a list screen
    needs to ask for the next one: {results, page, pages, count, next}.
    """
    paginator = Paginator(items, per_page)
    current = paginator.get_page(page or request.GET.get("page") or 1)
    return current, {
        "page": current.number,
        "pages": paginator.num_pages,
        "count": paginator.count,
        "next": current.number + 1 if current.has_next() else None,
    }


# ---- people ------------------------------------------------------------------


def person(request, user, viewer=None):
    """Who somebody is, everywhere: name, the letter and colour of their
    face, their photo if they have one, and whether they are here now."""
    profile = Profile.of(user)
    return {
        "username": user.get_username(),
        "name": profile.name,
        "initial": profile.initial,
        "hue": profile.hue,
        "photo": absolute(request, profile.photo_url),
        "is_live": profile.is_live,
        "is_me": viewer is not None and user.pk == viewer.pk,
        # The people who run the board wear a mark beside their name.
        "is_admin": bool(user.is_staff),
    }


def me(request, user):
    """The signed-in person, with what only they get to see and change."""
    from apps.holidays.models import HolidayPreference

    profile = Profile.of(user)
    data = person(request, user, viewer=user)
    data.update({
        "display_name": profile.display_name,
        "email": user.email,
        "phone": profile.phone,
        "address": profile.address,
        "is_staff": user.is_staff,
        "holiday_state": HolidayPreference.state_for(user, guess=guess_state(request)),
        "since": user.date_joined.strftime("%b %Y"),
        # Which KaamKoRecord the phone is talking to. It rides along here
        # rather than on an endpoint of its own because the profile screen —
        # the one place that shows it — already asks for this and nothing
        # else, and a footer is not worth a second request. It answers the
        # question a phone cannot answer for itself: the app's own version
        # says what was installed, and this says whether the server it is
        # calling has caught up.
        "server_version": VERSION,
    })
    return data


# ---- the board ------------------------------------------------------------------


def emoji_choices():
    return [{"value": value, "label": label} for value, label in Emoji.choices]


def reactions(item, viewer):
    """What the room made of a notice or a comment, as the tally shows it."""
    mine = item.emoji_of(viewer)
    return {
        "reactions": [{"emoji": emoji, "count": count} for emoji, count in item.reaction_groups()],
        "total_reactions": item.reaction_total(),
        "my_emoji": mine or "",
        "who_reacted": item.reactor_summary(viewer),
    }


def reactors(request, item, viewer):
    """Who reacted, emoji by emoji — the sheet behind a tally."""
    return {
        "total": item.reaction_total(),
        "my_emoji": item.emoji_of(viewer) or "",
        "groups": [
            {"emoji": emoji, "people": [person(request, user, viewer) for user in users]}
            for emoji, users in item.reaction_people()
        ],
    }


def _fold(items, keep):
    """The older part of a thread that folds away, and the newest that stays."""
    cut = max(len(items) - keep, 0)
    return items[:cut], items[cut:]


def comment(request, item, viewer, folded=True):
    replies = getattr(item, "reply_list", [])
    older, recent = _fold(replies, REPLIES_SHOWN) if folded else ([], replies)
    data = {
        "id": item.pk,
        "author": person(request, item.author, viewer),
        "body": item.body,
        "visibility": item.visibility,
        "created": item.created_at.isoformat(),
        "ago": ago(item.created_at),
        "mine": item.author_id == viewer.pk,
        "parent": item.parent_id,
        "replies": [comment(request, reply, viewer, folded) for reply in recent],
        "older_replies": len(older),
    }
    data.update(reactions(item, viewer))
    return data


def notice(request, item, viewer, folded=True, friend_ids=None):
    """
    A notice as the board shows it. `folded` keeps only the newest few
    comments and replies, as the board does, with a count of what folded
    away; the notice's own screen asks for the whole thread.

    `friend_ids` — `Friendship.ids_for(viewer)` — is worth passing in when
    serializing a page of these; left out, `Notice.thread` and
    `Notice.comment_total` each work it out themselves, one query apiece.
    """
    thread = item.thread(viewer, friend_ids)
    older, recent = _fold(thread, COMMENTS_SHOWN) if folded else ([], thread)
    data = {
        "id": item.pk,
        "author": person(request, item.author, viewer),
        "body": item.body,
        "visibility": item.visibility,
        "created": item.created_at.isoformat(),
        "ago": ago(item.created_at),
        "edited": item.was_edited,
        "is_new": item.is_new,
        "mine": item.author_id == viewer.pk,
        "comment_total": item.comment_total(viewer, friend_ids),
        "comments": [comment(request, c, viewer, folded) for c in recent],
        "older_comments": len(older),
    }
    data.update(reactions(item, viewer))
    return data


# ---- stories -------------------------------------------------------------------


def tray_row(request, row, viewer):
    """One tile of the row above the board."""
    latest = row["latest"]
    data = person(request, row["user"], viewer)
    data.update({
        "latest": {
            "id": latest.pk,
            "kind": latest.kind,
            "image": absolute(request, latest.image.url if latest.image else ""),
        },
        "count": row["count"],
        "unseen": row["unseen"],
        "mine": row["mine"],
    })
    return data


def story(request, item, viewer):
    """One story in the viewer, with the photo and clip as fetchable URLs."""
    from apps.stories.views import _story_json

    data = _story_json(item, viewer)
    data["image"] = absolute(request, data["image"])
    data["video"] = absolute(request, data["video"])
    data.pop("delete_url", None)
    return data


# ---- notifications ------------------------------------------------------------


def notification(request, item, viewer):
    return {
        "id": item.pk,
        "kind": item.kind,
        "icon": item.icon,
        "title": item.title,
        "body": item.body,
        "emoji": item.emoji,
        "url": item.url,
        "actor": person(request, item.actor, viewer) if item.actor_id else None,
        "hue": item.hue,
        "created": item.created_at.isoformat(),
        "ago": ago(item.created_at),
        "read": not item.is_unread,
    }
