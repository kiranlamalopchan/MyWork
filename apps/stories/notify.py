"""
What the stories app tells people about — by way of apps.notifications.notify,
the way the board does (see apps/noticeboard/notify.py for the rules).

A story is not a notice: it is up for a day and gone, and it has no audience
setting of its own — whoever is not blocked can look. Telling everybody on
the board about every clip would be noise, so a new story reaches the
author's *friends*, and only once a day however many they post: the second
clip rewrites the same unread line ("added to their story") rather than
joining it. A reaction goes to the story's author, one line per person, as
on the board. Blocks, and the author's own actions, are dropped by
`notify()` itself.
"""
from django.urls import reverse

from apps.notifications.models import Kind
from apps.notifications.notify import notify, notify_many


def _name(user):
    from apps.accounts.models import Profile
    return Profile.of(user).name


def _url(story):
    return reverse("stories:person", kwargs={"username": story.author.get_username()})


def story_posted(story):
    """
    A new story: the author's friends hear, once per day — for a public one
    and a friends-only one alike (the board is not told about every clip),
    and nobody for one marked Only me.
    """
    from apps.accounts.models import Friendship
    from apps.noticeboard.models import Visibility

    if story.visibility == Visibility.PRIVATE:
        return
    friends = Friendship.ids_for(story.author)
    if not friends:
        return
    from django.contrib.auth import get_user_model
    people = get_user_model().objects.filter(is_active=True, pk__in=friends)
    what = "a video" if story.is_video else "a photo"
    notify_many(
        people,
        Kind.STORY,
        f"{_name(story.author)} added to their story",
        body=story.caption.strip() or f"Shared {what} from their day.",
        url=_url(story),
        actor=story.author,
        dedupe_key=f"story:{story.author_id}:{story.created_at.date().isoformat()}",
    )


def story_reacted(story, actor, emoji):
    """
    Somebody put a face on a story. `emoji` is what `StoryReaction.toggle`
    left: None means they took it back, which is not news.
    """
    if not emoji:
        return
    notify(
        story.author,
        Kind.REACTION,
        f"{_name(actor)} reacted to your story",
        body=story.caption.strip() or "",
        url=_url(story),
        actor=actor,
        emoji=emoji,
        dedupe_key=f"reaction:story:{story.pk}:{actor.pk}",
    )
