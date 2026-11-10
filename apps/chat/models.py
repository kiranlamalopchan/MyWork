"""
Messages between friends, one to one.

Friends only, and never across a block: the friends list is already the
answer to "who may reach me", and a second set of rules for messages would
be a second thing to get wrong. What goes on the board passes the word
filter, and so does this.

One table and no "conversation" row. A conversation is just the messages
between two people, and the list of them is the newest message of each —
which is one query and a loop, at the size a friends list is.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Case, Count, F, IntegerField, Max, Q, When
from django.utils import timezone

from apps.accounts.models import Friendship
from apps.moderation.filter import REFUSED, objectionable
from apps.moderation.models import Block

MAX_LENGTH = 2000
class Message(models.Model):
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_sent"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_received"
    )
    body = models.TextField(max_length=MAX_LENGTH)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        indexes = [
            models.Index(fields=["recipient", "read_at"]),
            models.Index(fields=["sender", "recipient", "-created_at"]),
            models.Index(fields=["recipient", "sender", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.sender} → {self.recipient}: {self.body[:40]}"

    # ---- who may write to whom ------------------------------------------

    @staticmethod
    def can_talk(a, b):
        return Friendship.are_friends(a, b) and not Block.between(a, b)

    @classmethod
    def send(cls, sender, recipient, body):
        if not isinstance(body, str):
            raise ValidationError("Write a message using text.")
        body = (body or "").strip()
        if not body:
            raise ValidationError("Write something first.")
        if len(body) > MAX_LENGTH:
            raise ValidationError(f"That is too long — keep it under {MAX_LENGTH} characters.")
        if not cls.can_talk(sender, recipient):
            raise ValidationError("You can only message your friends.")
        if objectionable(body):
            raise ValidationError(REFUSED)
        return cls.objects.create(sender=sender, recipient=recipient, body=body)

    # ---- reading ----------------------------------------------------------

    @classmethod
    def between(cls, a, b):
        return cls.objects.filter(Q(sender=a, recipient=b) | Q(sender=b, recipient=a))

    @classmethod
    def mark_read(cls, reader, other):
        return cls.objects.filter(recipient=reader, sender=other, read_at__isnull=True).update(read_at=timezone.now())

    @classmethod
    def unread_count(cls, user):
        return cls.objects.filter(recipient=user, sender__is_active=True, read_at__isnull=True).exclude(sender_id__in=Block.ids_for(user)).count()

    @classmethod
    def threads_for(cls, user):
        """
        One row per person you have exchanged messages with, newest first:
        [(other_user, newest_message, unread_from_them)].
        """
        hidden = Block.ids_for(user)
        visible = (
            cls.objects.filter(Q(sender=user) | Q(recipient=user))
            .exclude(sender_id__in=hidden).exclude(recipient_id__in=hidden)
            .filter(sender__is_active=True, recipient__is_active=True)
        )
        summary = list(visible.annotate(other_id=Case(
            When(sender=user, then=F("recipient_id")), default=F("sender_id"), output_field=IntegerField(),
        )).values("other_id").annotate(
            newest=Max("pk"), unread=Count("pk", filter=Q(recipient=user, read_at__isnull=True)),
        ).order_by("-newest"))
        unread = {item["newest"]: item["unread"] for item in summary}
        rows = visible.filter(pk__in=unread).select_related("sender", "sender__profile", "recipient", "recipient__profile").order_by("-pk")
        threads = []
        for message in rows:
            other = message.recipient if message.sender_id == user.pk else message.sender
            if other.pk in hidden or not other.is_active:
                continue
            threads.append((other, message, unread[message.pk]))
        return threads
