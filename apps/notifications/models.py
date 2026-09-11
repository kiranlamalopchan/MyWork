"""
The mailbox behind the bell, and the devices a notification may reach.

Two things live here, and they are deliberately not the same kind of thing.

`Notification` is the record: one row per thing that happened to one person,
kept whether or not anything managed to interrupt them about it. It is what
the bell counts and what the inbox lists, and it outlives a phone that was
off, a permission that was never granted and a subscription the browser
quietly dropped overnight.

`PushSubscription` is a delivery address: one row per device that has agreed
to be interrupted. Push is a best effort laid over the record and never the
record itself — no push service promises delivery, and an iPhone will not
subscribe at all until the app has been added to the Home Screen. Treating
the two as one would mean a notification nobody could see afterwards.

Nothing here knows what a notice or a shift is. Each app describes its own
events — see `apps/noticeboard/notify.py` and `apps/timeclock/notify.py` —
and hands this one a line of text and a URL, so a fifth app can start
notifying without this file learning anything about it.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

# How many rows the inbox keeps per person. A notification is a nudge with a
# short life, not an archive: past this the oldest are dropped as new ones
# arrive, which keeps one busy board from growing the table without end.
KEEP_PER_PERSON = 100

# What the bell shows before it gives up counting. Past this the number stops
# being information and starts being wallpaper.
MAX_BADGE = 99


class Kind(models.TextChoices):
    """
    What happened. The inbox draws its icon from this, and a reader scanning
    the list reads the shape before they read the words.
    """

    NOTICE = "notice", "New notice"
    COMMENT = "comment", "Comment"
    REPLY = "reply", "Reply"
    REACTION = "reaction", "Reaction"
    TIMESHEET = "timesheet", "Timesheet"


# The shape each kind wears in the inbox. A reaction has none: the face
# somebody actually left is better than any icon standing in for it.
KIND_ICONS = {
    Kind.NOTICE: "chat",
    Kind.COMMENT: "chat-lines",
    Kind.REPLY: "reply",
    Kind.REACTION: "",
    Kind.TIMESHEET: "clock",
}


class Notification(models.Model):
    """One thing that happened, addressed to one person."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )

    # Who caused it. Null for anything the app itself raises — a timesheet
    # reminder has no author — and null again if that account is later
    # deleted, which is why this is SET_NULL: losing the person should not
    # silently delete the record of what they did.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    kind = models.CharField(max_length=16, choices=Kind.choices)

    # The text, written by the app that raised it and stored as written.
    #
    # Deliberately a copy rather than a pointer at the notice it came from: a
    # notification is what you were told at the time, and a line that rewrote
    # itself when somebody edited their post — or emptied itself when they
    # deleted it — would be a strange thing to find in a mailbox.
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=200, blank=True)

    # Where tapping it goes. A path, never an absolute URL: it is opened on
    # whichever host the reader is on.
    url = models.CharField(max_length=300)

    # The face somebody left, when that is what this is about. Shown instead
    # of the kind's icon, because "sam reacted" without the emoji is a worse
    # sentence than the emoji on its own.
    emoji = models.CharField(max_length=8, blank=True)

    # What makes two of these the same event. Reacting is a toggle, so
    # tapping a face four times is one person changing their mind, not four
    # notifications — see `Notification.raise_for`.
    dedupe_key = models.CharField(max_length=120, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # The two questions ever asked of this table: this person's list,
            # newest first, and this person's unread count.
            models.Index(fields=["recipient", "-created_at"]),
            models.Index(fields=["recipient", "read_at"]),
            models.Index(fields=["recipient", "dedupe_key"]),
        ]

    def __str__(self):
        return f"{self.recipient}: {self.title}"

    @property
    def is_unread(self):
        return self.read_at is None

    @property
    def icon(self):
        """The glyph for this kind, or "" when the emoji speaks for it."""
        return KIND_ICONS.get(self.kind, "bell")

    @property
    def hue(self):
        """
        The colour of whoever caused it — the same one they wear on the board
        and in the app bar, so a person is one colour everywhere in MyWork.

        Nobody behind it means the app itself spoke, and that takes the
        brand's own hue rather than borrowing somebody's.
        """
        if self.actor_id is None:
            return None
        from apps.accounts.avatars import hue_for

        return hue_for(self.actor.get_username())

    # ---- making one -----------------------------------------------------

    @classmethod
    def raise_for(cls, recipient, kind, title, *, url, body="", actor=None,
                  emoji="", dedupe_key=""):
        """
        Record something for `recipient`, or return None if there is nothing
        to record.

        Nobody is notified about their own doing: the commonest caller is a
        fan-out over everyone on the board, and the author is on the board.
        Checking it here rather than in each caller is what keeps that from
        being remembered four times and forgotten once.

        `dedupe_key` collapses repeats. An unread notification carrying the
        same key is rewritten and moved to the top rather than joined by a
        second one, so a reaction toggled on and off and on again stays one
        line. Once it has been read the next one is genuinely new, and comes
        through as its own row.

        Returns `(notification, is_new)`. The flag is what stops a rewritten
        row from buzzing a phone a second time: the mailbox is allowed to
        update itself quietly, and only the caller knows whether this repeat
        is worth interrupting somebody about — see `notify()`. A rewritten
        row also carries `previous_at`, the time the line it replaced was
        raised, which is what a re-notify window is measured from.
        """
        if recipient is None or (actor is not None and recipient.pk == actor.pk):
            return None, False

        if dedupe_key:
            existing = cls.objects.filter(
                recipient=recipient, dedupe_key=dedupe_key, read_at__isnull=True
            ).first()
            if existing is not None:
                existing.previous_at = existing.created_at
                existing.title = title
                existing.body = body
                existing.url = url
                existing.emoji = emoji
                existing.actor = actor
                existing.created_at = timezone.now()
                existing.save(update_fields=[
                    "title", "body", "url", "emoji", "actor", "created_at",
                ])
                return existing, False

        return cls.objects.create(
            recipient=recipient,
            actor=actor,
            kind=kind,
            title=title,
            body=body,
            url=url,
            emoji=emoji,
            dedupe_key=dedupe_key,
        ), True

    # ---- reading it -----------------------------------------------------

    @classmethod
    def inbox(cls, user):
        """Everything addressed to `user`, newest first, ready to render."""
        return cls.objects.filter(recipient=user).select_related(
            "actor", "actor__profile"
        )

    @classmethod
    def unread_count(cls, user):
        """
        How many are waiting — the number on the bell.

        Anonymous users get zero rather than a query: the bell is not drawn
        for them, and base.html asks on every page.
        """
        if not user or not getattr(user, "is_authenticated", False):
            return 0
        return cls.objects.filter(recipient=user, read_at__isnull=True).count()

    @classmethod
    def mark_all_read(cls, user):
        """Empty the bell. Returns how many were still unread."""
        return cls.objects.filter(recipient=user, read_at__isnull=True).update(
            read_at=timezone.now()
        )

    @classmethod
    def trim(cls, user, keep=KEEP_PER_PERSON):
        """
        Drop the oldest rows past `keep` for one person.

        Called after each new notification rather than by a nightly job,
        because there is no nightly job: the cost is one extra query on an
        event nobody is waiting on, and the table stays a mailbox instead of
        becoming a log.
        """
        ids = list(
            cls.objects.filter(recipient=user)
            .order_by("-created_at")
            .values_list("pk", flat=True)[keep:keep + 50]
        )
        if ids:
            cls.objects.filter(pk__in=ids).delete()


class Sweep(models.Model):
    """
    When a periodic job last ran.

    MyWork has no queue and no worker, and on a free host it has no cron worth
    the name either — one scheduled task a day, which is no use at all for
    noticing a clock-out that was forgotten at four in the afternoon. So the
    periodic work rides on ordinary web traffic instead: every request asks
    whether the job is due, and the rare one that finds it due runs it.

    The asking has to be cheap and it has to be safe with several workers
    answering requests at once, which is what `claim` is for. It is one
    conditional UPDATE — the database decides who won, not the process — so
    two simultaneous page loads cannot both start the same sweep.

    Nothing about any particular job lives here. `name` is whatever the caller
    calls it; see `apps/timeclock/middleware.py` for the only one so far.
    """

    name = models.CharField(max_length=40, unique=True)
    ran_at = models.DateTimeField()

    def __str__(self):
        return f"{self.name} last ran {self.ran_at:%Y-%m-%d %H:%M}"

    @classmethod
    def claim(cls, name, every):
        """
        True if `name` is due, and claims it in the same breath.

        Whoever gets True runs the job; everybody else gets False and carries
        on. The claim is taken *before* the work rather than after, so a job
        that crashes still holds the slot and the next attempt is one interval
        away instead of on the very next request.
        """
        now = timezone.now()

        # The ordinary case: a row exists and is old enough. UPDATE ... WHERE
        # ran_at <= cutoff returns 1 to exactly one caller however many ask.
        claimed = cls.objects.filter(name=name, ran_at__lte=now - every).update(ran_at=now)
        if claimed:
            return True

        # The first request after a deployment, when there is no row yet.
        # get_or_create absorbs the race: the loser of it gets created=False.
        _, created = cls.objects.get_or_create(name=name, defaults={"ran_at": now})
        return created


class PushSubscription(models.Model):
    """
    One browser on one device that has agreed to be interrupted.

    A person has as many of these as they have devices — the phone in a
    pocket and the laptop at home are two subscriptions, and both should
    buzz. The endpoint the browser hands over is the address; the two keys
    beside it are what the payload is encrypted to, so the push service
    carrying the message cannot read it.

    Rows die on their own: a browser that has been reinstalled, cleared or
    left alone for months answers 404 or 410 the next time something is sent,
    and `apps.notifications.push` deletes it there rather than keeping a
    address nothing lives at.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions"
    )

    # Long enough for any push service's URL; unique because re-subscribing
    # the same browser must update the row it already has rather than leave a
    # second one behind to send everything twice.
    endpoint = models.TextField(unique=True)

    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)

    # Only ever shown back to its owner, so they can tell which device a row
    # is before removing it.
    user_agent = models.CharField(max_length=300, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user}: {self.endpoint[:40]}…"

    @classmethod
    def store(cls, user, endpoint, p256dh, auth, user_agent=""):
        """
        Remember a subscription, moving it to `user` if it was somebody
        else's.

        Two people sharing a phone is the case this covers: the browser hands
        back the same endpoint, and it must now reach whoever is signed in
        rather than keep buzzing for the person who set it up.
        """
        subscription, _ = cls.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": user,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": user_agent[:300],
            },
        )
        return subscription

    def as_info(self):
        """The shape pywebpush wants."""
        return {
            "endpoint": self.endpoint,
            "keys": {"p256dh": self.p256dh, "auth": self.auth},
        }
