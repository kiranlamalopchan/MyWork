"""
Stories: a photo from somebody's day, on the hub for a day, then gone.

The notice board is what people write down; a story is what they show. It
sits in a row of faces above the board, opens full-screen, and is gone
twenty-four hours after it was posted — the point of it is that it is of
today. Nothing here is edited; a story is posted or taken down.

A story is a photo or a short video. A photo is straightened, cropped
the way the phone's editor left it, and shrunk to a phone-screen JPEG
whatever it arrived as — HEIC from an iPhone included. A video is
re-encoded to 1080p H.264 whatever it arrived as, and cut to the sixty
seconds the composer's trimmer was left on when it ran longer, with a
poster frame the phone took for the tile. There is no cap on what may be
sent: what is kept is bounded by the re-encoding.

Three rows: the story itself, who has seen it (so the ring around a face
goes quiet once you have looked, and the owner can see who looked), and
the reaction somebody left on it (one per person, the board's own faces).

Expiry is decided by `expires_at` at query time, so a story stops showing
the second its day is up, and swept from the disk afterwards — by the
`expire_stories` command on a schedule, and quietly whenever the tray is
built, so a server with no scheduler still doesn't keep old photos or,
more to the point, old videos: a day of those is the disk.
"""

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models
from django.urls import reverse
from django.utils import timezone

from apps.noticeboard.models import Emoji

# How long a story stays up.
LIFETIME = timedelta(hours=24)

# The longest side a story is kept at. A phone photo is 4000px on its long
# side and is only ever looked at on a phone; a 1080×1920 frame at this
# quality is a few hundred kilobytes rather than a few megabytes.
MAX_SIDE = 1920
QUALITY = 84

MAX_CAPTION = 200

# A video story is a moment, not a film: sixty seconds, no more.
MAX_VIDEO_SECONDS = 60

# Every video is re-encoded by ffmpeg to H.264 in an MP4, no bigger than
# 1080p on its short side, whichever way round — a phone films in 4K by
# default now, and four times the pixels is four times the disk for a
# picture looked at on a phone for a minute — so what is kept is bounded
# by this, and there is no cap on what may be sent. Nothing is enlarged:
# a 720p clip stays 720p. Needs ffmpeg on the server; without it, what
# arrived is kept where every phone can play it as it is, and refused
# where it can't.
MAX_VIDEO_SHORT_SIDE = 1080
# H.264 only: VP8/VP9 in a WebM plays in a browser and on Android, never on an iPhone.
PLAYABLE_CODECS = {"h264"}
TRANSCODE_TIMEOUT = 240
VIDEO_TYPES = {
    "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime",
    "webm": "video/webm", "3gp": "video/3gpp",
}


def story_path(instance, filename):
    """A random name: two IMG_0001.jpg must not collide, and the phone's own
    name for the file is nobody's business. The extension is kept for a
    video — the browser plays it by what it is called."""
    ext = os.path.splitext(filename)[1].lower() or ".jpg"
    return f"stories/{instance.author_id}-{uuid.uuid4().hex[:12]}{ext}"


class Unusable(Exception):
    """The upload can't be a story — the message is for the user."""


class Kind(models.TextChoices):
    PHOTO = "photo", "Photo"
    VIDEO = "video", "Video"


class StoryQuerySet(models.QuerySet):
    def live(self):
        return self.filter(expires_at__gt=timezone.now())

    def for_viewer(self, user):
        """
        The live ones `user` may look at: not taken down, and not by
        anybody one of them has blocked. Their own are always theirs.
        """
        from apps.moderation.models import Block
        return self.live().filter(
            models.Q(author=user)
            | (models.Q(hidden=False) & ~models.Q(author_id__in=Block.ids_for(user)))
        )

    def expired(self):
        return self.filter(expires_at__lte=timezone.now())


class Story(models.Model):
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stories"
    )
    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.PHOTO)
    # A photo story's picture; a video story's poster frame, for the tile.
    image = models.ImageField(upload_to=story_path, blank=True)
    video = models.FileField(upload_to=story_path, blank=True)
    duration = models.FloatField(null=True, blank=True)
    caption = models.CharField(max_length=MAX_CAPTION, blank=True)
    # Off the tray pending review — enough reports, or the admin.
    hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(db_index=True)

    objects = StoryQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.author} · {self.created_at:%d %b %H:%M}"

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = self.created_at + LIFETIME
        super().save(*args, **kwargs)

    @property
    def is_live(self):
        return self.expires_at > timezone.now()

    @property
    def seen_by_count(self):
        return self.views.count()

    def seen_by(self, user):
        """Note that `user` looked. Their own story counts as seen."""
        if user.pk == self.author_id:
            return
        StoryView.objects.get_or_create(story=self, viewer=user)

    @property
    def is_video(self):
        return self.kind == Kind.VIDEO

    def set_image(self, upload):
        """Take the upload: straightened, shrunk to fit MAX_SIDE, as a JPEG."""
        self.kind = Kind.PHOTO
        self.image.save(story_path(self, "story.jpg"), _fitted(upload), save=False)

    @property
    def video_url(self):
        """
        Where a clip is fetched from: the range-serving view (views.video),
        not the file under /media/. An iPhone's player asks a video for
        pieces and will not play from a server that answers with the whole
        file — and the static one does exactly that.
        """
        if not self.video:
            return ""
        return reverse("stories:video", args=[os.path.basename(self.video.name)])

    def set_video(self, upload, poster=None, duration=None, start=None, end=None):
        """
        Take a video, once it is known to be one and short enough, and
        keep it as 1080p H.264. The poster is the frame the phone grabbed
        for the tile; without one the tile is plain.

        `start` and `end`, in seconds, are the part of a longer video to
        keep — where the composer's trimmer was left. The cut is ffmpeg's;
        a server without it can only say so.
        """
        self.kind = Kind.VIDEO
        ext = os.path.splitext(upload.name or "")[1].lower().lstrip(".")
        if ext not in VIDEO_TYPES:
            raise Unusable("Send a video as MP4, MOV or WebM.")
        info = probe(upload)
        seconds = info.get("duration") if info else None
        if seconds is None:
            seconds = duration
        window = _window(start, end, seconds)
        if window is not None:
            cut = transcode(upload, info, window=window)
            if cut is None:
                if not shutil.which("ffmpeg"):
                    raise Unusable(
                        f"This server can't cut a video. Trim it to {MAX_VIDEO_SECONDS} seconds "
                        "in your phone's photo app and try again."
                    )
                raise Unusable("That video couldn't be cut. Try a different clip, or trim it on your phone.")
            upload, ext = cut, "mp4"
            seconds = window[1] - window[0]
        elif seconds is not None and seconds > MAX_VIDEO_SECONDS + 0.5:
            raise Unusable(
                f"A story video can be up to {MAX_VIDEO_SECONDS} seconds — this one is "
                f"{int(round(seconds))}. Choose which {MAX_VIDEO_SECONDS} to keep."
            )
        else:
            converted = transcode(upload, info)
            if converted is not None:
                upload, ext = converted, "mp4"
            elif not (info and plays_as_it_is(info)):
                # No ffmpeg, or it failed, or its shape couldn't even be
                # read: only a clip known to play as it is can be kept
                # unconverted — one that can't be checked is not that.
                raise Unusable("That video couldn't be converted. Send an MP4 (H.264) at 1080p or under.")
        self.duration = seconds
        self.video.save(story_path(self, f"story.{ext}"), upload, save=False)
        # The tile's frame: the one the phone grabbed, or, from the app,
        # which sends none, the first moment of what was kept.
        if poster is None:
            poster = first_frame(upload)
        if poster is not None:
            try:
                self.image.save(story_path(self, "poster.jpg"), _fitted(poster), save=False)
            except Exception:
                pass

    def take_down(self):
        """Gone, files and all."""
        files = [f for f in (self.image, self.video) if f]
        self.delete()
        for f in files:
            try:
                f.storage.delete(f.name)
            except Exception:
                pass

    @classmethod
    def sweep(cls):
        """Remove every story whose day is up. Returns how many went."""
        gone = 0
        for story in cls.objects.expired():
            story.take_down()
            gone += 1
        return gone


class StoryView(models.Model):
    """Somebody looked at a story. One row per person per story."""

    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="views")
    viewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="story_views")
    seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("story", "viewer")]
        ordering = ["-seen_at"]


class StoryReaction(models.Model):
    """The face somebody left on a story — the board's own menu."""

    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="story_reactions")
    emoji = models.CharField(max_length=8, choices=Emoji.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("story", "user")]

    @classmethod
    def toggle(cls, story, user, emoji):
        """Leave, change or take back a reaction; returns what they're left with."""
        existing = cls.objects.filter(story=story, user=user).first()
        if emoji not in Emoji.values:
            return existing.emoji if existing else None
        if existing is None:
            cls.objects.create(story=story, user=user, emoji=emoji)
            return emoji
        if existing.emoji == emoji:
            existing.delete()
            return None
        existing.emoji = emoji
        existing.save(update_fields=["emoji"])
        return emoji


def _on_disk(upload):
    """
    A path to the upload on disk, and whether it was made here.

    ffprobe and ffmpeg want a file, not a pipe: a MOV keeps its index at
    the end and they seek to it. A big upload is already a temp file;
    a small one is held in memory and written out.
    """
    path = getattr(upload, "temporary_file_path", None)
    path = path() if callable(path) else None
    if path:
        return path, False
    ext = os.path.splitext(getattr(upload, "name", "") or "")[1] or ".mp4"
    made = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    upload.seek(0)
    for chunk in upload.chunks():
        made.write(chunk)
    made.close()
    upload.seek(0)
    return made.name, True


def probe(upload):
    """
    What ffprobe says of a video: duration, width and height as it plays
    (a phone's rotation applied), the short side, and the codec. None
    where there is no ffprobe or it could make nothing of the file.
    """
    if not shutil.which("ffprobe"):
        return None
    path, made = _on_disk(upload)
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, timeout=20,
        )
        data = json.loads(out.stdout or b"{}")
        stream = next((st for st in data.get("streams", []) if st.get("codec_type") == "video"), None)
        if stream is None:
            return None
        width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
        # Filmed upright: the pixels are landscape with a note to turn them.
        rotation = 0
        for side in stream.get("side_data_list", []) or []:
            if "rotation" in side:
                rotation = int(float(side["rotation"]))
        rotation = rotation or int(float((stream.get("tags") or {}).get("rotate", 0) or 0))
        if rotation % 180:
            width, height = height, width
        duration = data.get("format", {}).get("duration") or stream.get("duration")
        return {
            "duration": float(duration) if duration else None,
            "width": width,
            "height": height,
            "short": min(width, height),
            "codec": (stream.get("codec_name") or "").lower(),
        }
    except Exception:
        return None
    finally:
        if made:
            try:
                os.unlink(path)
            except OSError:
                pass


def first_frame(upload):
    """
    The first moment of a video as a JPEG, by ffmpeg — or None without it,
    or if it could make nothing of the file; the tile then goes plain.
    """
    if not shutil.which("ffmpeg"):
        return None
    src, made = _on_disk(upload)
    try:
        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", "0.1", "-i", src, "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"],
            capture_output=True, timeout=30,
        )
        return ContentFile(out.stdout, name="poster.jpg") if out.stdout else None
    except Exception:
        return None
    finally:
        if made:
            try:
                os.unlink(src)
            except OSError:
                pass


def _window(start, end, seconds):
    """
    The (start, end) to cut a video to, checked — or None when there is
    nothing to cut: no trim was asked for, or it covers the whole clip.

    Raises Unusable for a window that isn't one: back to front, longer
    than a story may be, or past the end of the video, where the video's
    length is known.
    """
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise Unusable("A trim needs both a start and an end.")
    if end - start < 0.5:
        raise Unusable("A trim has to keep at least a moment of the video.")
    if end - start > MAX_VIDEO_SECONDS + 0.5:
        raise Unusable(f"A story video can be up to {MAX_VIDEO_SECONDS} seconds — that trim keeps {int(round(end - start))}.")
    if seconds is not None:
        # The phone's reading of the length and ffprobe's can differ by a
        # few hundred milliseconds; a window that overshoots by that much
        # is brought in, one well past the end is not a window.
        if end > seconds + 1.0:
            raise Unusable("That trim runs past the end of the video.")
        end = min(end, seconds)
    if start <= 0.05 and (seconds is None or end >= seconds - 0.05):
        return None
    return (start, end)


def plays_as_it_is(info):
    """1080p or under, in a codec every phone plays: fit to keep unconverted."""
    return info["short"] <= MAX_VIDEO_SHORT_SIDE and info["codec"] in PLAYABLE_CODECS


def transcode(upload, info, window=None):
    """
    The video re-encoded by ffmpeg: H.264 in an MP4, no bigger than 1080p
    on its short side, the long side following — and, given a `window`
    of (start, end) seconds, only that part of it. Returns a file to
    save, or None if ffmpeg is missing or failed — the caller decides
    whether what arrived is good enough to keep instead.
    """
    if not shutil.which("ffmpeg"):
        return None
    src, made = _on_disk(upload)
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()
    # Cap the short side at 1080 whichever way the picture is; -2 keeps
    # the other side even, which H.264 insists on. A video already small
    # enough is only re-encoded, not enlarged.
    cap = MAX_VIDEO_SHORT_SIDE
    scale = (
        f"scale=w='if(gt(iw,ih),-2,min(iw,{cap}))':h='if(gt(iw,ih),min(ih,{cap}),-2)'"
    )
    # The cut: seek before the input, which is the quick way in and, since
    # the clip is re-encoded anyway, still lands on the exact frame.
    cut = []
    if window is not None:
        cut = ["-ss", f"{window[0]:.3f}", "-t", f"{window[1] - window[0]:.3f}"]
    try:
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", *cut, "-i", src,
                "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ac", "2",
                "-movflags", "+faststart", "-map_metadata", "-1", out.name,
            ],
            capture_output=True, timeout=TRANSCODE_TIMEOUT, check=True,
        )
        with open(out.name, "rb") as f:
            data = f.read()
        if not data:
            return None
        return ContentFile(data, name="story.mp4")
    except Exception:
        return None
    finally:
        for path, remove in ((src, made), (out.name, True)):
            if remove:
                try:
                    os.unlink(path)
                except OSError:
                    pass


def _fitted(upload):
    """The upload as a JPEG no bigger than MAX_SIDE on its long side."""
    from PIL import Image, ImageOps

    # HEIC/HEIF, what an iPhone photographs in, opens like any other format:
    # AccountsConfig.ready registers the opener when the process starts.
    image = Image.open(upload)
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        backdrop = Image.new("RGB", image.size, (255, 255, 255))
        backdrop.paste(image, mask=image.convert("RGBA").split()[-1])
        image = backdrop
    image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=QUALITY, optimize=True)
    return ContentFile(buffer.getvalue())
