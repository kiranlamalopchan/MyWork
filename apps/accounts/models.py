"""
The person behind the username.

Django's own `User` carries what signing in needs and nothing about how you
look while you are signed in. `Profile` is that missing half: a photo and the
name you would rather be called. It hangs off `User` one-to-one instead of
replacing it, so the account, its password and every existing row keep working
untouched.

Every user has exactly one, created with the account (see the signal at the
foot of this file) and backfilled for accounts that predate it. `Profile.of()`
still creates on demand, because a row that must exist is worth guaranteeing at
the point of use rather than trusting three separate places to have run.

The photo is squared and shrunk on the way in. A phone camera hands over a
4000px portrait; every place KaamKoRecord shows a face is at most 96px across, so
storing the original would mean megabytes on disk and megabytes down a mobile
connection to draw a thumbnail.
"""

import uuid
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .avatars import hue_for, initial_for

# Every face on KaamKoRecord is drawn small; this is comfortably above the largest
# of them (the profile page's own, at 96px) on a 3x screen.
PHOTO_PX = 320

# What a squared, shrunk avatar is written back as.
PHOTO_QUALITY = 86

# Long enough for a full name, short enough to sit in the app bar beside the
# avatar without pushing the buttons off a narrow phone.
MAX_DISPLAY_NAME = 40

# Room for an international number written however the owner writes it,
# spaces, brackets and country code included.
MAX_PHONE = 32

# One line of address — enough for a street, a suburb and a postcode.
MAX_ADDRESS = 200

# How long after somebody's last page view they still count as here.
#
# Presence is measured from requests, so it answers "was this person moving
# around the app just now?" rather than "is a tab open somewhere?" — a phone
# in a pocket with the board still on screen is not using it. Five minutes is
# long enough to cover reading a long thread without going dark, and short
# enough that the dot means something.
LIVE_FOR = timedelta(minutes=5)

# A page view only writes last_seen if the stored value is older than this.
# Without it every request from every person is a write, which on a shared
# board is a great many writes to answer a question nobody asked precisely.
SEEN_EVERY = timedelta(seconds=60)


def photo_path(instance, filename):
    """
    Where an upload lands.

    The name is random rather than the original filename: two people uploading
    IMG_0001.jpg must not collide, a new photo must not be served from the old
    one's cache, and what somebody called the file on their phone is not
    something to publish in a URL.
    """
    return f"avatars/{instance.user_id}-{uuid.uuid4().hex[:12]}.jpg"


class Profile(models.Model):
    """How somebody appears everywhere in KaamKoRecord."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )

    photo = models.ImageField(upload_to=photo_path, blank=True)

    # When they last asked this site for a page. Null until their first one
    # after this was added, which reads correctly as "not seen".
    last_seen = models.DateTimeField(null=True, blank=True, db_index=True)

    display_name = models.CharField(
        max_length=MAX_DISPLAY_NAME,
        blank=True,
    )

    # Contact details. Every one of them is optional, and KaamKoRecord asks nothing
    # of them: they are here because a workplace app is where you keep the
    # number a manager rings and the address a roster is sent to, and having
    # to look them up somewhere else is the reason people write them on paper.
    #
    # The phone is a plain string rather than a parsed number. People write
    # "0412 345 678" and "+61 412 345 678" and mean the same thing, and a
    # field that rejects one of them teaches you to leave it empty.
    phone = models.CharField(
        max_length=MAX_PHONE,
        blank=True,
    )

    address = models.CharField(
        max_length=MAX_ADDRESS,
        blank=True,
    )

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.get_username()}'s profile"

    # ---- who they are ---------------------------------------------------

    @property
    def name(self):
        """What to call them: their chosen name, else the username."""
        return self.display_name.strip() or self.user.get_username()

    @property
    def initial(self):
        """The letter shown until there is a photo. Always the username's, so
        the face you learn on the board does not change when somebody edits
        their display name."""
        return initial_for(self.user.get_username())

    @property
    def hue(self):
        return hue_for(self.user.get_username())

    @property
    def has_details(self):
        """Whether anything has been filled in beyond the name."""
        return bool(self.phone or self.address or self.user.email)

    @property
    def is_live(self):
        """Whether they were moving around the app within the last few minutes."""
        if self.last_seen is None:
            return False
        return timezone.now() - self.last_seen <= LIVE_FOR

    def touch(self):
        """Record that they are here, at most once a minute.

        Returns whether it wrote. update() rather than save(): it is one
        statement, it touches one column, and it does not fire the signals
        that saving a profile fires — none of which have anything to say
        about somebody loading a page.
        """
        now = timezone.now()
        if self.last_seen is not None and now - self.last_seen < SEEN_EVERY:
            return False
        Profile.objects.filter(pk=self.pk).update(last_seen=now)
        self.last_seen = now
        return True

    @property
    def photo_url(self):
        """The photo's URL, or None when they have not set one."""
        if not self.photo:
            return None
        try:
            return self.photo.url
        except ValueError:
            # A row pointing at a file the storage no longer has: fall back to
            # the letter rather than rendering a broken image.
            return None

    # ---- getting one ----------------------------------------------------

    @classmethod
    def of(cls, user):
        """
        `user`'s profile, creating it if this is somehow the first ask.

        Anonymous users get None — templates then fall back to the signed-out
        rendering rather than blowing up on a missing attribute.
        """
        if not user or not getattr(user, "is_authenticated", False):
            return None
        try:
            # The related object, which is already in hand on a page that
            # select_related it — the board draws a face per notice and per
            # comment, and a query each would be dozens of them.
            return user.profile
        except cls.DoesNotExist:
            profile, _ = cls.objects.get_or_create(user=user)
            return profile

    # ---- the photo ------------------------------------------------------

    def set_photo(self, upload):
        """
        Take an uploaded image as this profile's photo: square it, shrink it,
        and drop whatever it replaced.

        Squaring here rather than in CSS means every avatar is a circle of the
        middle of the picture on every surface — including the ones that can't
        crop, like an email or a downloaded copy.
        """
        squared = _square_thumbnail(upload)
        self._drop_photo_file()
        self.photo.save(photo_path(self, "avatar.jpg"), squared, save=False)

    def clear_photo(self):
        """Back to the letter."""
        self._drop_photo_file()
        self.photo = ""

    def _drop_photo_file(self):
        """Remove the file behind the current photo, if there is one.

        Django leaves orphaned files on disk when a FileField is reassigned;
        an avatar is replaced casually and often, so cleaning up here keeps a
        long-lived account from leaving a trail of dead photos behind it.
        """
        if not self.photo:
            return
        old = self.photo
        try:
            old.storage.delete(old.name)
        except Exception:
            # Already gone, or a storage that would rather not — not worth
            # failing somebody's upload over.
            pass


def _square_thumbnail(upload):
    """An uploaded image as a centre-cropped PHOTO_PX square JPEG."""
    from PIL import Image, ImageOps

    image = Image.open(upload)
    # Phones record orientation in EXIF rather than in the pixels; without
    # this a photo taken sideways is shown sideways.
    image = ImageOps.exif_transpose(image)
    # Flatten transparency onto white: the result is a JPEG, which has no
    # alpha, and an unflattened one comes out with a black background.
    if image.mode not in ("RGB", "L"):
        backdrop = Image.new("RGB", image.size, (255, 255, 255))
        backdrop.paste(image, mask=image.convert("RGBA").split()[-1])
        image = backdrop
    image = ImageOps.fit(
        image.convert("RGB"), (PHOTO_PX, PHOTO_PX), method=Image.LANCZOS
    )

    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=PHOTO_QUALITY, optimize=True)
    return ContentFile(buffer.getvalue())


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile(sender, instance, created, **kwargs):
    """A new account gets its profile with it, so nothing else has to check."""
    if created:
        Profile.objects.get_or_create(user=instance)


class FriendRequest(models.Model):
    """
    One person asking to be friends with another, waiting on an answer.

    Deliberately not a status field on a single row: a request that has been
    accepted or declined is not a request any more, it is either a
    `Friendship` or nothing, and a table that only ever holds the pending
    ones is a table whose count on somebody's bell means what it says.
    """

    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_friend_requests",
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_friend_requests",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["from_user", "to_user"], name="one_friend_request_per_pair"
            ),
        ]

    def __str__(self):
        return f"{self.from_user} → {self.to_user}"

    def accept(self):
        """
        Turn this into a friendship and clear the pair's slate.

        A request the other way round can exist at the same time — two
        people asking each other within the same minute — and answering one
        of them settles both, so the sender of the other is never left
        waiting on a request that has already been granted in substance.
        """
        Friendship.befriend(self.from_user, self.to_user)
        FriendRequest.objects.filter(
            from_user=self.to_user, to_user=self.from_user
        ).delete()
        self.delete()

    def decline(self):
        self.delete()


class Friendship(models.Model):
    """
    One side of a friendship. Being friends is symmetric, so accepting a
    request writes two of these — one from each person's side — which is
    what lets "my friends" always be answered by a single filter on `user`
    rather than an OR across two columns.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friendships"
    )
    friend = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["friend__username"]
        constraints = [
            models.UniqueConstraint(fields=["user", "friend"], name="one_friendship_per_pair"),
        ]

    def __str__(self):
        return f"{self.user} ↔ {self.friend}"

    @classmethod
    def befriend(cls, a, b):
        """Make `a` and `b` friends, or do nothing if they already are."""
        cls.objects.get_or_create(user=a, friend=b)
        cls.objects.get_or_create(user=b, friend=a)

    @classmethod
    def unfriend(cls, a, b):
        cls.objects.filter(user=a, friend=b).delete()
        cls.objects.filter(user=b, friend=a).delete()

    @classmethod
    def are_friends(cls, a, b):
        if a is None or b is None or a.pk == b.pk:
            return False
        return cls.objects.filter(user=a, friend=b).exists()

    @classmethod
    def ids_for(cls, user):
        """
        The ids of everyone `user` is friends with, as a set — the shape a
        visibility check on a page full of notices wants: one query up
        front, then an `in` per row rather than a query per row.

        Anonymous users get an empty set rather than a query: there is
        nobody signed in to be friends with anyone.
        """
        if not user or not getattr(user, "is_authenticated", False):
            return set()
        return set(cls.objects.filter(user=user).values_list("friend_id", flat=True))
