"""
The notice board on the hub — one shared wall every signed-in user can read.

Anyone can post; nobody can touch anyone else's. That rule lives in the
queryset every editing view starts from (`Notice.editable_by`), rather than in
a permission check bolted on afterwards, so a missed check can't quietly open
someone else's notice to a stranger.

A notice and a comment are the same kind of thing to a reader: somebody wrote
it, and other people put a face on it. That shared half lives in `Social`
below, so the board and the thread under it can never drift apart.
"""

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

# The letter and colour somebody wears on the board are the same ones they
# wear in the app bar and on their profile, so they are defined once, with the
# person. Re-exported here because the board has always imported them from
# here, and `Social` below still reads them.
from apps.accounts.avatars import hue_for, initial_for  # noqa: F401

# Long enough for a shift swap, a reminder or a phone number; short enough
# that the board stays a board rather than a forum.
MAX_BODY = 600

# A reply is a reply, not a second notice.
MAX_COMMENT = 300

# An edit inside this window of posting is a typo being fixed, not a revision
# worth flagging to everyone who already read it.
EDIT_GRACE = timedelta(minutes=2)

# How many names the tally spells out before it starts counting the rest.
# Two fits on the narrowest phone without wrapping the line.
NAMES_SHOWN = 2


class Emoji(models.TextChoices):
    """
    The faces available on a notice and on a comment alike.

    One menu, shared: a board where you can be sad about a notice but not
    about a reply would need explaining, and this way there is nothing to
    explain.
    """

    LIKE = "\U0001F44D", "Like"
    LOVE = "❤️", "Love"
    HAHA = "\U0001F602", "Haha"
    WOW = "\U0001F62E", "Wow"
    SAD = "\U0001F622", "Sad"
    ANGRY = "\U0001F621", "Angry"




# How long something reads as new on the board.
#
# Long enough that a board looked at once a day still shows what has arrived
# since; short enough that "new" is a claim worth making. It is not "unread by
# you" — nothing here tracks who has read what, and a dot that quietly meant
# "recent" while looking like "unread" would be the wrong kind of clever.
FRESH_FOR = timedelta(hours=18)


class Social:
    """
    What a notice and a comment have in common: an author to show, and
    reactions to count.

    Every method here reads `self.reactions` and `self.author` as they already
    stand, so on a prefetched page the whole board renders without going back
    to the database — see `Notice.visible()`.
    """

    # ---- who wrote it ---------------------------------------------------

    @property
    def initial(self):
        return initial_for(self.author.get_username())

    @property
    def hue(self):
        return hue_for(self.author.get_username())

    @property
    def is_new(self):
        """Whether this landed recently enough to still be worth a dot."""
        return timezone.now() - self.created_at <= FRESH_FOR

    # ---- what other people made of it -----------------------------------

    def reaction_groups(self):
        """
        Each emoji left here with its count, busiest first.
        """
        counts = {}
        for reaction in self.reactions.all():
            counts[reaction.emoji] = counts.get(reaction.emoji, 0) + 1
        return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))

    def reaction_people(self):
        """
        Each emoji with the people behind it — what the "who reacted" page
        lists, and the reason reactions are prefetched with their user.
        """
        people = {}
        for reaction in self.reactions.all():
            people.setdefault(reaction.emoji, []).append(reaction.user)
        for users in people.values():
            users.sort(key=lambda u: u.get_username().lower())
        return sorted(people.items(), key=lambda pair: (-len(pair[1]), pair[0]))

    def reaction_total(self):
        return len(self.reactions.all())

    def emoji_of(self, user):
        """The emoji `user` left here, or None."""
        if not user.is_authenticated:
            return None
        for reaction in self.reactions.all():
            if reaction.user_id == user.pk:
                return reaction.emoji
        return None

    def reactor_names(self, user):
        """
        Everyone who reacted, the reader first.

        Seeing your own reaction named "You" is how you tell at a glance that
        the tally already counts you, without hunting for your own name.
        """
        mine, others = [], []
        for reaction in self.reactions.all():
            if user.is_authenticated and reaction.user_id == user.pk:
                mine.append("You")
            else:
                others.append(reaction.user.get_username())
        return mine + sorted(others, key=str.lower)

    def reactor_summary(self, user, limit=NAMES_SHOWN):
        """
        "You, sam and 3 others" — the count in words.

        A bare number tells you how many people reacted; on a board of people
        who work together, which people is the part worth reading.
        """
        names = self.reactor_names(user)
        if not names:
            return ""

        rest = len(names) - limit
        if rest > 0:
            return f"{', '.join(names[:limit])} and {rest} other{'' if rest == 1 else 's'}"
        if len(names) == 1:
            return names[0]
        return f"{', '.join(names[:-1])} and {names[-1]}"


class Notice(Social, models.Model):
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notices"
    )
    body = models.TextField(max_length=MAX_BODY)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at"])]

    def __str__(self):
        return f"{self.author}: {self.body[:40]}"

    @classmethod
    def visible(cls):
        """
        Everything on the board. Reading is what everyone shares.

        Reactions and comments come along for the ride — including the people
        behind them, since the board names who reacted rather than only
        counting them. Fetching any of it per row would turn one page into
        dozens of queries.
        """
        return cls.objects.select_related("author", "author__profile").prefetch_related(
            "reactions__user",
            "comments__author",
            "comments__author__profile",
            "comments__reactions__user",
        )

    @classmethod
    def editable_by(cls, user):
        """
        The notices `user` may change — only ever their own.

        Editing views look a notice up in here, so someone else's returns a
        404: it isn't theirs to change, and the board doesn't confirm which
        ids exist by answering 403 instead.
        """
        return cls.objects.filter(author=user)

    @property
    def was_edited(self):
        return self.updated_at - self.created_at > EDIT_GRACE

    def thread(self):
        """
        The comments under this notice, replies nested under the comment they
        answer, oldest first.

        Built in Python out of the one flat prefetched list rather than by
        following `replies` per comment, so a thread of any shape still costs
        the page nothing.
        """
        by_id, roots = {}, []
        for comment in self.comments.all():
            comment.reply_list = []
            by_id[comment.pk] = comment

        for comment in by_id.values():
            parent = by_id.get(comment.parent_id)
            # A reply whose parent is gone would otherwise vanish with it;
            # it reads as a comment on the notice, which is what it now is.
            (parent.reply_list if parent else roots).append(comment)

        return roots

    def comment_total(self):
        """Replies count as comments — the tally is what was said, not where."""
        return len(self.comments.all())


class ReactionBase(models.Model):
    """
    One person's emoji on one thing.

    A person gets one reaction per thing, enforced in the database rather
    than by the view that happens to write it: tapping the same emoji again
    takes it back, tapping a different one changes their mind.
    """

    # The field naming what this reaction is attached to, so `toggle` can be
    # written once for notices and comments both.
    TARGET = ""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="%(class)ss"
    )
    emoji = models.CharField(max_length=8, choices=Emoji.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["created_at"]

    @classmethod
    def toggle(cls, target, user, emoji):
        """
        Leave, change or take back `user`'s reaction. Returns the emoji they
        are left with, or None if there is none.
        """
        existing = cls.objects.filter(**{cls.TARGET: target}, user=user).first()

        # An emoji that isn't on the menu is somebody typing at the form, not
        # a person tapping a face: leave what they already had alone.
        if emoji not in Emoji.values:
            return existing.emoji if existing else None

        if existing is None:
            cls.objects.create(**{cls.TARGET: target}, user=user, emoji=emoji)
            return emoji
        if existing.emoji == emoji:
            existing.delete()
            return None
        existing.emoji = emoji
        existing.save(update_fields=["emoji"])
        return emoji


class Reaction(ReactionBase):
    """An emoji on a notice."""

    # Kept as an attribute of the model people already reach for, so
    # `Reaction.Emoji.LOVE` still means what it did.
    Emoji = Emoji
    TARGET = "notice"

    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="reactions")

    class Meta(ReactionBase.Meta):
        abstract = False
        constraints = [
            models.UniqueConstraint(fields=["notice", "user"], name="one_reaction_per_person")
        ]

    def __str__(self):
        return f"{self.user} {self.emoji} {self.notice_id}"


class Comment(Social, models.Model):
    """
    A reply under a notice. Anyone may add one; only its author may remove it
    — the same rule the notices themselves follow.

    A comment may itself answer another comment, one level deep: a thread you
    can follow down the page beats a thread you have to indent your way into,
    and on a phone the fourth indent has no room left to say anything.
    """

    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="comments")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments"
    )
    body = models.TextField(max_length=MAX_COMMENT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["notice", "created_at"])]

    def __str__(self):
        return f"{self.author} on {self.notice_id}"

    @classmethod
    def editable_by(cls, user):
        """The comments `user` may remove — only ever their own."""
        return cls.objects.filter(author=user)

    @classmethod
    def under(cls, notice, pk):
        """
        The comment `pk` is answering, or None.

        Only ever a comment on this notice, so a reply can't be smuggled onto
        a thread the writer is not looking at, and only ever a top-level one:
        an answer to a reply joins that reply's thread rather than starting a
        deeper one nothing on the page could show.
        """
        if not pk:
            return None
        try:
            parent = cls.objects.filter(pk=pk, notice=notice).first()
        except (TypeError, ValueError):
            # `pk` came off a form, so it need not be an id at all. Something
            # that isn't one is a comment on the notice, not an error page.
            return None
        if parent is None:
            return None
        return parent.parent or parent

    @property
    def is_reply(self):
        return self.parent_id is not None


class CommentReaction(ReactionBase):
    """An emoji on a comment. The same menu, the same one-per-person rule."""

    Emoji = Emoji
    TARGET = "comment"

    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="reactions")

    class Meta(ReactionBase.Meta):
        abstract = False
        constraints = [
            models.UniqueConstraint(
                fields=["comment", "user"], name="one_comment_reaction_per_person"
            )
        ]

    def __str__(self):
        return f"{self.user} {self.emoji} on comment {self.comment_id}"
