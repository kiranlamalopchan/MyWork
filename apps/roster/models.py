"""
The roster: shifts you are due to work, before you have worked them.

`timeclock.Shift` is the record of what happened — it starts when the clock
does. A `PlannedShift` is the other half: what is meant to happen, written
down ahead of time, which is what a reminder before a shift needs and what a
shift you cannot work has to be before somebody else can take it.

Handing one on is deliberately simple. You put a shift up, your friends are
told, and the first of them to take it has it: the row changes owner. There
is no approval step, because the people on your friends list are the people
you would have rung anyway, and a swap that waits on a third tap is a swap
that gets arranged by text message instead.

A workplace belongs to one person (`timeclock.Workplace.user`), so a shift
that changes hands cannot keep pointing at the giver's. It carries the
place's name as words as well, and is tied to the taker's own workplace of
the same name when they have one.
"""

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from apps.accounts.models import Friendship
from apps.moderation.models import Block
from apps.timeclock.models import Workplace

# Longer than this is two shifts, or a mistyped date.
MAX_LENGTH = timedelta(hours=24)


class PlannedShift(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="planned_shifts"
    )
    # Null once the workplace is removed, or when the shift was taken from
    # a friend and you have no workplace by that name: `place` still says where.
    workplace = models.ForeignKey(
        Workplace, null=True, blank=True, on_delete=models.SET_NULL, related_name="planned_shifts"
    )
    place = models.CharField(max_length=120)
    starts = models.DateTimeField()
    ends = models.DateTimeField()
    note = models.CharField(max_length=200, blank=True)

    # Up for a friend to take.
    offered = models.BooleanField(default=False)
    offered_at = models.DateTimeField(null=True, blank=True)
    # Who it came from, when it was taken rather than typed in.
    given_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["starts", "pk"]
        indexes = [
            models.Index(fields=["user", "starts"]),
            models.Index(fields=["offered", "starts"]),
        ]

    def __str__(self):
        return f"{self.user}: {self.place} {self.starts:%Y-%m-%d %H:%M}"

    def clean(self):
        if self.starts and self.ends:
            if self.ends <= self.starts:
                raise ValidationError({"ends": "A shift has to end after it starts."})
            if self.ends - self.starts > MAX_LENGTH:
                raise ValidationError({"ends": "That is longer than a day — check the dates."})

    def save(self, *args, **kwargs):
        if self.workplace_id:
            self.place = self.workplace.name
        super().save(*args, **kwargs)

    @property
    def duration(self):
        return self.ends - self.starts

    @property
    def has_started(self):
        return self.starts <= timezone.now()

    # ---- the lists ------------------------------------------------------

    @classmethod
    def upcoming_for(cls, user, now=None):
        """Your own, from the one running now onwards."""
        now = now or timezone.now()
        return cls.objects.filter(user=user, ends__gt=now).select_related("workplace", "given_by", "given_by__profile")

    @classmethod
    def offers_for(cls, user, now=None):
        """What your friends have put up and nobody has taken yet."""
        now = now or timezone.now()
        friends = Friendship.ids_for(user) - Block.ids_for(user)
        return (
            cls.objects.filter(offered=True, starts__gt=now, user_id__in=friends)
            .select_related("user", "user__profile")
        )

    # ---- handing one on -------------------------------------------------

    def offer(self):
        if self.has_started:
            raise ValidationError("That shift has already started.")
        if not self.offered:
            self.offered = True
            self.offered_at = timezone.now()
            self.save(update_fields=["offered", "offered_at"])

    def withdraw(self):
        if self.offered:
            self.offered = False
            self.offered_at = None
            self.save(update_fields=["offered", "offered_at"])

    @classmethod
    def take(cls, pk, taker):
        """
        `taker` takes the shift with this id. Returns (shift, giver).

        Locked and re-read inside the transaction: two friends tapping at
        once must end with one of them holding the shift and the other told
        it has gone, not both.
        """
        with transaction.atomic():
            shift = cls.objects.select_for_update().select_related("user").filter(pk=pk).first()
            if shift is None or not shift.offered:
                raise ValidationError("That shift has already been taken.")
            giver = shift.user
            if giver.pk == taker.pk:
                raise ValidationError("That is your own shift.")
            if not Friendship.are_friends(taker, giver) or Block.between(taker, giver):
                raise ValidationError("That shift isn't yours to take.")
            if shift.has_started:
                raise ValidationError("That shift has already started.")

            shift.user = taker
            shift.given_by = giver
            shift.workplace = Workplace.objects.filter(user=taker, name__iexact=shift.place).first()
            shift.offered = False
            shift.offered_at = None
            shift.save()
        return shift, giver
