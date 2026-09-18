"""
Keeping the board civil: blocking a person, and reporting what they posted.

A shared wall needs two things a private timesheet never did. Somebody you
would rather not hear from can be blocked — after which neither of you sees
the other's notices, comments or stories, the friendship (if any) is over,
and neither can send the other a request. And anything objectionable can be
reported, which puts it in front of whoever runs the site; enough distinct
reports take it off the board on their own until somebody has looked.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

# Reports from this many different people hide the thing until it is
# reviewed. Three: one is a grudge, two may be a pair, three is a pattern.
AUTO_HIDE_AT = 3


class Block(models.Model):
    """One person choosing not to see another. One row; both ways are hidden."""

    blocker = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks"
    )
    blocked = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocked_by"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="one_block_per_pair"),
        ]

    def __str__(self):
        return f"{self.blocker} ⊘ {self.blocked}"

    @classmethod
    def block(cls, blocker, blocked):
        """
        `blocker` stops seeing `blocked`, and the other way round. Whatever
        stood between them — a friendship, a request either way — goes with
        it: you don't stay friends with somebody you have blocked.
        """
        if blocker.pk == blocked.pk:
            return None
        row, _ = cls.objects.get_or_create(blocker=blocker, blocked=blocked)
        from apps.accounts.models import FriendRequest, Friendship
        Friendship.unfriend(blocker, blocked)
        FriendRequest.objects.filter(from_user=blocker, to_user=blocked).delete()
        FriendRequest.objects.filter(from_user=blocked, to_user=blocker).delete()
        cls._forget(blocker)
        cls._forget(blocked)
        return row

    @classmethod
    def unblock(cls, blocker, blocked):
        cls.objects.filter(blocker=blocker, blocked=blocked).delete()
        cls._forget(blocker)
        cls._forget(blocked)

    @classmethod
    def is_blocking(cls, blocker, blocked):
        """Whether `blocker` has blocked `blocked` — that way round only."""
        if blocker is None or blocked is None:
            return False
        return cls.objects.filter(blocker=blocker, blocked=blocked).exists()

    @classmethod
    def between(cls, a, b):
        """Whether either of them has blocked the other."""
        if a is None or b is None or not getattr(a, "pk", None) or not getattr(b, "pk", None):
            return False
        if a.pk == b.pk:
            return False
        return b.pk in cls.ids_for(a)

    @classmethod
    def ids_for(cls, user):
        """
        Everyone hidden from `user`, as a set: the people they blocked and
        the people who blocked them. Computed once per request — it is
        remembered on the user object, the way one page's worth of
        visibility checks wants it — and forgotten by `block`/`unblock`.
        """
        if not user or not getattr(user, "is_authenticated", False):
            return set()
        cached = user.__dict__.get("_blocked_ids")
        if cached is not None:
            return cached
        ids = set(cls.objects.filter(blocker=user).values_list("blocked_id", flat=True))
        ids |= set(cls.objects.filter(blocked=user).values_list("blocker_id", flat=True))
        user.__dict__["_blocked_ids"] = ids
        return ids

    @classmethod
    def _forget(cls, user):
        user.__dict__.pop("_blocked_ids", None)


class Kind(models.TextChoices):
    NOTICE = "notice", "Notice"
    COMMENT = "comment", "Comment"
    STORY = "story", "Story"
    USER = "user", "Person"


class Reason(models.TextChoices):
    SPAM = "spam", "Spam or misleading"
    HARASSMENT = "harassment", "Harassment or bullying"
    HATE = "hate", "Hate speech or violence"
    SEXUAL = "sexual", "Nudity or sexual content"
    OTHER = "other", "Something else"


class Report(models.Model):
    """Somebody flagging something. Reviewed in the admin; see `Report.file`."""

    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_made"
    )
    kind = models.CharField(max_length=8, choices=Kind.choices)
    target_id = models.PositiveIntegerField()
    # Who wrote what was reported, kept here so a report still reads after
    # the thing itself has been taken down.
    accused = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports_received",
    )
    reason = models.CharField(max_length=12, choices=Reason.choices, default=Reason.OTHER)
    note = models.CharField(max_length=300, blank=True)
    excerpt = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    handled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "kind", "target_id"], name="one_report_per_person_per_thing"
            ),
        ]
        indexes = [models.Index(fields=["kind", "target_id"])]

    def __str__(self):
        return f"{self.get_kind_display()} {self.target_id} — {self.get_reason_display()}"

    @property
    def is_open(self):
        return self.handled_at is None

    @classmethod
    def file(cls, reporter, kind, target, reason, note=""):
        """
        Record `reporter`'s report of `target` (a Notice, Comment, Story or
        User). A second report of the same thing by the same person updates
        the reason rather than counting twice. Returns the report, and hides
        the thing once enough different people have said so.
        """
        accused = target if kind == Kind.USER else getattr(target, "author", None)
        excerpt = ""
        if kind in (Kind.NOTICE, Kind.COMMENT):
            excerpt = (target.body or "")[:200]
        elif kind == Kind.STORY:
            excerpt = (target.caption or "")[:200]
        report, _ = cls.objects.update_or_create(
            reporter=reporter, kind=kind, target_id=target.pk,
            defaults={"accused": accused, "reason": reason, "note": (note or "")[:300], "excerpt": excerpt},
        )
        if kind != Kind.USER and hasattr(target, "hidden") and not target.hidden:
            distinct = cls.objects.filter(kind=kind, target_id=target.pk).values("reporter").distinct().count()
            if distinct >= AUTO_HIDE_AT:
                target.hidden = True
                target.save(update_fields=["hidden"])
        _tell_the_site(report)
        return report

    def handle(self):
        self.handled_at = timezone.now()
        self.save(update_fields=["handled_at"])


def _tell_the_site(report):
    """
    An email to whoever runs the site, if an address is configured — the
    "timely response" a report is owed starts with somebody hearing about
    it. Never raises: a mail server having a bad afternoon must not turn
    the report itself into an error.
    """
    to = getattr(settings, "CONTACT_EMAIL", "")
    if not to:
        return
    try:
        from django.core.mail import send_mail
        send_mail(
            subject=f"[MeroKaam] Report: {report.get_kind_display().lower()} {report.target_id} — {report.get_reason_display()}",
            message=(
                f"{report.reporter} reported {report.get_kind_display().lower()} #{report.target_id}"
                f"{f' by {report.accused}' if report.accused else ''}.\n\n"
                f"Reason: {report.get_reason_display()}\n"
                f"Note: {report.note or '—'}\n"
                f"Excerpt: {report.excerpt or '—'}\n\n"
                "Review it in the admin under Moderation › Reports."
            ),
            from_email=None,
            recipient_list=[to],
            fail_silently=True,
        )
    except Exception:
        pass
