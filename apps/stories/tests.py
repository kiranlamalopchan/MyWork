"""
Stories: up for a day, seen once, then gone.
"""

from datetime import timedelta
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from .models import LIFETIME, Story, StoryReaction
from .views import tray_for


def picture(width=1200, height=1800, colour=(200, 40, 40)):
    image = Image.new("RGB", (width, height), colour)
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return SimpleUploadedFile("photo.jpg", buffer.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class StoryTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.kiran)

    def post_story(self, user, caption="", when=None):
        story = Story(author=user, caption=caption)
        if when:
            story.created_at = when
        story.set_image(picture())
        story.save()
        return story

    # ---- the day ---------------------------------------------------------

    def test_a_story_lasts_a_day(self):
        story = self.post_story(self.sam)
        self.assertEqual(story.expires_at, story.created_at + LIFETIME)
        self.assertTrue(story.is_live)
        self.assertIn(story, Story.objects.live())

    def test_an_old_story_is_not_live_and_is_swept(self):
        old = self.post_story(self.sam, when=timezone.now() - timedelta(hours=25))
        name = old.image.name
        self.assertNotIn(old, Story.objects.live())
        self.assertEqual(Story.sweep(), 1)
        self.assertFalse(Story.objects.filter(pk=old.pk).exists())
        self.assertFalse(old.image.storage.exists(name))

    def test_the_picture_is_shrunk(self):
        story = self.post_story(self.sam)
        with Image.open(story.image.path) as image:
            self.assertLessEqual(max(image.size), 1920)

    # ---- the row ---------------------------------------------------------

    def test_the_tray_puts_yours_first_then_unseen(self):
        seen = self.post_story(self.sam, when=timezone.now() - timedelta(hours=2))
        seen.seen_by(self.kiran)
        other = User.objects.create_user("jo", password="pw")
        self.post_story(other, when=timezone.now() - timedelta(hours=1))
        self.post_story(self.kiran)
        rows = tray_for(self.kiran)
        self.assertEqual([r["user"].username for r in rows], ["kiran", "jo", "sam"])
        self.assertTrue(rows[1]["unseen"])
        self.assertFalse(rows[2]["unseen"])

    def test_the_hub_shows_the_row(self):
        self.post_story(self.sam, caption="Snow day")
        resp = self.client.get(reverse("home"))
        self.assertContains(resp, 'data-story-of="sam"')
        self.assertContains(resp, "Create story")

    # ---- posting and taking down ----------------------------------------

    def test_posting_returns_the_row_with_you_in_it(self):
        resp = self.client.post(
            reverse("stories:create"), {"image": picture(), "caption": "hi"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'data-story-of="kiran"')
        self.assertEqual(Story.objects.filter(author=self.kiran).count(), 1)

    def test_a_missing_photo_is_refused(self):
        resp = self.client.post(reverse("stories:create"), {"caption": "hi"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.json())

    def test_only_the_author_can_delete(self):
        story = self.post_story(self.sam)
        resp = self.client.post(reverse("stories:delete", args=[story.pk]))
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Story.objects.filter(pk=story.pk).exists())
        self.client.force_login(self.sam)
        self.client.post(reverse("stories:delete", args=[story.pk]))
        self.assertFalse(Story.objects.filter(pk=story.pk).exists())

    # ---- looking ----------------------------------------------------------

    def test_the_viewer_json_starts_at_the_first_unseen(self):
        first = self.post_story(self.sam, when=timezone.now() - timedelta(hours=3))
        second = self.post_story(self.sam, when=timezone.now() - timedelta(hours=1))
        first.seen_by(self.kiran)
        resp = self.client.get(reverse("stories:person", args=["sam"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        data = resp.json()
        self.assertEqual([s["id"] for s in data["stories"]], [first.pk, second.pk])
        self.assertEqual(data["start"], 1)
        self.assertFalse(data["stories"][0]["mine"])

    def test_seen_is_recorded_and_the_owner_sees_who(self):
        story = self.post_story(self.sam)
        self.client.post(reverse("stories:seen", args=[story.pk]))
        self.assertEqual(story.seen_by_count, 1)
        self.client.force_login(self.sam)
        data = self.client.get(reverse("stories:person", args=["sam"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest").json()
        self.assertEqual(data["stories"][0]["seen_count"], 1)
        self.assertEqual(data["stories"][0]["viewers"][0]["name"], "kiran")

    def test_your_own_view_does_not_count(self):
        story = self.post_story(self.kiran)
        self.client.post(reverse("stories:seen", args=[story.pk]))
        self.assertEqual(story.seen_by_count, 0)

    def test_reacting_toggles(self):
        story = self.post_story(self.sam)
        url = reverse("stories:react", args=[story.pk])
        data = self.client.post(url, {"emoji": "❤️"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest").json()
        self.assertEqual(data["my_emoji"], "❤️")
        self.assertEqual(data["reactions"], [{"emoji": "❤️", "count": 1}])
        data = self.client.post(url, {"emoji": "❤️"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest").json()
        self.assertEqual(data["my_emoji"], "")
        self.assertEqual(StoryReaction.objects.count(), 0)

    def test_an_expired_story_cannot_be_seen_or_reacted_to(self):
        old = self.post_story(self.sam, when=timezone.now() - timedelta(hours=25))
        self.assertEqual(self.client.post(reverse("stories:seen", args=[old.pk])).status_code, 404)
        resp = self.client.get(reverse("stories:person", args=["sam"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 404)

    def test_the_plain_page_works_without_script(self):
        self.post_story(self.sam, caption="Snow day")
        resp = self.client.get(reverse("stories:person", args=["sam"]))
        self.assertContains(resp, "Snow day")
        resp = self.client.get(reverse("stories:compose"))
        self.assertContains(resp, "Share to your story")


def fixture(name):
    from pathlib import Path
    path = Path(__file__).parent / "fixtures" / name
    return SimpleUploadedFile(name, path.read_bytes())


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class VideoStoryTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.kiran)

    def test_a_short_video_is_kept_with_its_poster_and_length(self):
        resp = self.client.post(
            reverse("stories:create"),
            {"video": fixture("short.mp4"), "poster": picture(320, 568), "duration": "3.0"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        story = Story.objects.get(author=self.kiran)
        self.assertTrue(story.is_video)
        self.assertTrue(story.video.name.endswith(".mp4"))
        self.assertTrue(story.image)                      # the poster
        self.assertAlmostEqual(story.duration, 3.0, delta=0.5)
        self.assertNotContains(resp, "story-tile__play")

    def test_a_video_over_sixty_seconds_is_refused(self):
        resp = self.client.post(
            reverse("stories:create"), {"video": fixture("long.mp4"), "duration": "65"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("60 seconds", resp.json()["error"])
        self.assertEqual(Story.objects.count(), 0)

    def test_a_trim_longer_than_a_minute_is_refused(self):
        resp = self.client.post(
            reverse("stories:create"),
            {"video": fixture("long.mp4"), "duration": "65", "trim_start": "0", "trim_end": "62"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("60 seconds", resp.json()["error"])
        self.assertEqual(Story.objects.count(), 0)

    def test_a_trim_past_the_end_or_back_to_front_is_refused(self):
        for start, end in (("30", "90"), ("40", "30"), ("10", "")):
            resp = self.client.post(
                reverse("stories:create"),
                {"video": fixture("long.mp4"), "duration": "65", "trim_start": start, "trim_end": end},
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
            self.assertEqual(resp.status_code, 400, (start, end))
        self.assertEqual(Story.objects.count(), 0)

    def test_without_ffmpeg_a_trim_is_refused_in_so_many_words(self):
        from unittest.mock import patch

        with patch("apps.stories.models.shutil.which", return_value=None):
            resp = self.client.post(
                reverse("stories:create"),
                {"video": fixture("long.mp4"), "duration": "65", "trim_start": "2", "trim_end": "50"},
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("can't cut", resp.json()["error"])
        self.assertEqual(Story.objects.count(), 0)

    def test_a_file_that_is_not_a_video_is_refused(self):
        resp = self.client.post(
            reverse("stories:create"), {"video": SimpleUploadedFile("notes.txt", b"hello")},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("MP4", resp.json()["error"])

    def test_the_viewer_json_says_it_is_a_video(self):
        self.client.post(reverse("stories:create"), {"video": fixture("short.mp4"), "duration": "3"})
        data = self.client.get(reverse("stories:person", args=["kiran"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest").json()
        self.assertEqual(data["stories"][0]["kind"], "video")
        self.assertTrue(data["stories"][0]["video"].endswith(".mp4"))
        self.assertEqual(data["max_seconds"], 60)

    def test_an_expired_video_is_swept_off_the_disk(self):
        self.client.post(reverse("stories:create"), {"video": fixture("short.mp4"), "poster": picture(320, 568), "duration": "3"})
        story = Story.objects.get()
        video_name, poster_name = story.video.name, story.image.name
        Story.objects.filter(pk=story.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(Story.sweep(), 1)
        self.assertFalse(story.video.storage.exists(video_name))
        self.assertFalse(story.image.storage.exists(poster_name))
        self.assertEqual(Story.objects.count(), 0)

    def test_an_iphone_heic_photo_is_turned_into_a_jpeg(self):
        resp = self.client.post(
            reverse("stories:create"), {"image": fixture("photo.heic")},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        story = Story.objects.get()
        self.assertTrue(story.image.name.endswith(".jpg"))
        with Image.open(story.image.path) as image:
            self.assertEqual(image.format, "JPEG")

    def test_neither_a_photo_nor_a_video_is_refused(self):
        resp = self.client.post(reverse("stories:create"), {"caption": "hi"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("photo or a video", resp.json()["error"])


import shutil as _shutil
import unittest


@unittest.skipUnless(_shutil.which("ffmpeg") and _shutil.which("ffprobe"), "needs ffmpeg")
@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class VideoSizeTests(TestCase):
    """Above 1080p, or in a codec phones don't all play, a video is re-encoded."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.kiran)

    def probe_stored(self, story):
        from .models import probe
        with open(story.video.path, "rb") as f:
            upload = SimpleUploadedFile(story.video.name, f.read())
        return probe(upload)

    def test_a_4k_portrait_video_is_shrunk_to_1080p(self):
        resp = self.client.post(reverse("stories:create"), {"video": fixture("tall4k.mp4")}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        story = Story.objects.get()
        info = self.probe_stored(story)
        self.assertEqual((info["width"], info["height"]), (1080, 1920))
        self.assertEqual(info["codec"], "h264")
        self.assertTrue(story.video.name.endswith(".mp4"))

    def test_an_hevc_video_is_re_encoded_so_every_phone_plays_it(self):
        self.client.post(reverse("stories:create"), {"video": fixture("hevc.mp4")})
        story = Story.objects.get()
        self.assertEqual(self.probe_stored(story)["codec"], "h264")

    def test_a_long_video_is_cut_to_the_part_chosen(self):
        resp = self.client.post(
            reverse("stories:create"),
            {"video": fixture("long.mp4"), "duration": "65", "trim_start": "3", "trim_end": "63"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        story = Story.objects.get()
        self.assertAlmostEqual(story.duration, 60.0, delta=0.5)
        info = self.probe_stored(story)
        self.assertAlmostEqual(info["duration"], 60.0, delta=0.5)
        self.assertEqual(info["codec"], "h264")
        self.assertTrue(story.video.name.endswith(".mp4"))

    def test_a_short_trim_of_a_long_video_keeps_only_that(self):
        self.client.post(
            reverse("stories:create"),
            {"video": fixture("long.mp4"), "trim_start": "10", "trim_end": "14.5"},
        )
        story = Story.objects.get()
        self.assertAlmostEqual(self.probe_stored(story)["duration"], 4.5, delta=0.3)

    def test_a_trim_overshooting_the_end_by_a_hair_is_brought_in(self):
        # A phone's reading of the length and ffprobe's can differ a little.
        resp = self.client.post(
            reverse("stories:create"),
            {"video": fixture("long.mp4"), "duration": "65.4", "trim_start": "20", "trim_end": "65.4"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertAlmostEqual(self.probe_stored(Story.objects.get())["duration"], 45.0, delta=0.5)

    def test_a_trim_over_the_whole_of_a_short_video_cuts_nothing(self):
        self.client.post(reverse("stories:create"), {"video": fixture("short.mp4"), "trim_start": "0", "trim_end": "3"})
        self.assertAlmostEqual(self.probe_stored(Story.objects.get())["duration"], 3.0, delta=0.2)

    def test_a_small_h264_video_is_converted_too(self):
        # Every video is re-encoded, so what is kept is always the same
        # kind of file — but a small one is not enlarged.
        original = fixture("short.mp4")
        size = original.size
        self.client.post(reverse("stories:create"), {"video": original})
        story = Story.objects.get()
        info = self.probe_stored(story)
        self.assertEqual((info["codec"], info["width"], info["height"]), ("h264", 320, 568))
        self.assertNotEqual(story.video.size, size)
        with open(story.video.path, "rb") as f:
            head = f.read(64 * 1024)
        # Re-encoded with faststart: the index before the picture.
        self.assertLess(head.index(b"moov"), head.index(b"mdat"))

    def test_there_is_no_cap_on_what_is_sent(self):
        # A file said to be far larger than any cap there used to be: what
        # is kept is bounded by the re-encoding, not by what arrived.
        upload = fixture("short.mp4")
        upload.size = 5 * 1024 ** 3
        story = Story(author=self.kiran)
        story.set_video(upload)
        story.save()
        self.assertAlmostEqual(story.duration, 3.0, delta=0.2)
        self.assertEqual(self.probe_stored(story)["codec"], "h264")

    def test_probe_reads_the_shape_and_length(self):
        from .models import probe
        info = probe(fixture("tall4k.mp4"))
        self.assertEqual((info["width"], info["height"], info["short"]), (2160, 3840, 2160))
        self.assertAlmostEqual(info["duration"], 2.0, delta=0.2)


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class VideoServingTests(TestCase):
    """
    The clip is fetched from the range-serving view, not /media/: an
    iPhone's player asks for pieces and refuses a server that sends the
    whole file back.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.kiran)
        self.story = Story(author=self.kiran)
        self.story.kind = "video"
        self.story.image.save("stories/poster.jpg", picture(9, 16), save=False)
        self.story.video.save("stories/1-abcdef012345.mp4", SimpleUploadedFile("c.mp4", bytes(range(256)) * 4), save=False)
        self.story.duration = 3
        self.story.save()
        # story_path names the file itself: "<author id>-<12 hex>.mp4".
        self.name = self.story.video.name.rsplit("/", 1)[-1]
        self.url = reverse("stories:video", args=[self.name])

    def test_the_viewer_is_pointed_at_the_view_not_the_media_file(self):
        self.assertEqual(self.url, f"/stories/video/{self.name}")
        self.assertEqual(self.story.video_url, self.url)
        resp = self.client.get(reverse("stories:person", args=["kiran"]))
        self.assertContains(resp, self.url)
        self.assertNotContains(resp, "/media/stories/")

    def test_whole_file_says_it_takes_ranges(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Accept-Ranges"], "bytes")
        self.assertEqual(resp["Content-Type"], "video/mp4")
        self.assertEqual(resp["Content-Length"], "1024")
        self.assertEqual(b"".join(resp.streaming_content), bytes(range(256)) * 4)

    def test_a_range_comes_back_as_206_with_just_that_piece(self):
        resp = self.client.get(self.url, HTTP_RANGE="bytes=0-1")
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp["Content-Range"], "bytes 0-1/1024")
        self.assertEqual(resp["Content-Length"], "2")
        self.assertEqual(b"".join(resp.streaming_content), b"\x00\x01")
        resp = self.client.get(self.url, HTTP_RANGE="bytes=1020-")
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp["Content-Range"], "bytes 1020-1023/1024")
        self.assertEqual(b"".join(resp.streaming_content), bytes([252, 253, 254, 255]))
        resp = self.client.get(self.url, HTTP_RANGE="bytes=-4")
        self.assertEqual(resp["Content-Range"], "bytes 1020-1023/1024")
        resp = self.client.get(self.url, HTTP_RANGE="bytes=5000-")
        self.assertEqual(resp.status_code, 416)
        self.assertEqual(resp["Content-Range"], "bytes */1024")

    def test_head_answers_without_a_body(self):
        resp = self.client.head(self.url, HTTP_RANGE="bytes=0-1")
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp["Content-Length"], "2")

    def test_gone_or_made_up_names_are_404(self):
        self.assertEqual(self.client.get(reverse("stories:video", args=["1-000000000000.mp4"])).status_code, 404)
        self.assertEqual(self.client.get("/stories/video/..%2F..%2Fsettings.py").status_code, 404)
        Story.objects.filter(pk=self.story.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.client.get(self.url).status_code, 404)


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class StoryNotificationTests(TestCase):
    """A new story reaches the author's friends, once a day; a reaction reaches the author."""

    def setUp(self):
        from apps.accounts.models import Friendship
        from apps.moderation.models import Block
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.tom = User.objects.create_user("tom", password="pw")
        self.stranger = User.objects.create_user("stranger", password="pw")
        for a, b in ((self.kiran, self.sam), (self.sam, self.kiran), (self.kiran, self.tom), (self.tom, self.kiran)):
            Friendship.objects.create(user=a, friend=b)
        Block.objects.create(blocker=self.tom, blocked=self.kiran)
        self.client.force_login(self.kiran)

    def _post(self, caption=""):
        return self.client.post(reverse("stories:create"), {"image": picture(9, 16), "caption": caption}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")

    def test_friends_hear_about_a_story_but_strangers_and_blockers_do_not(self):
        from apps.notifications.models import Notification
        self.assertEqual(self._post("Morning rush").status_code, 200)
        got = Notification.objects.filter(kind="story")
        self.assertEqual({n.recipient.username for n in got}, {"sam"})
        n = got.get()
        self.assertEqual(n.title, "kiran added to their story")
        self.assertEqual(n.body, "Morning rush")
        self.assertEqual(n.url, "/stories/kiran/")
        self.assertEqual(n.actor, self.kiran)

    def test_three_stories_in_a_day_are_one_line(self):
        from apps.notifications.models import Notification
        for _ in range(3):
            self._post()
        self.assertEqual(Notification.objects.filter(kind="story", recipient=self.sam).count(), 1)

    def test_a_reaction_reaches_the_author_and_taking_it_back_is_not_news(self):
        from apps.notifications.models import Notification
        self._post()
        story = Story.objects.get()
        self.client.force_login(self.sam)
        self.client.post(reverse("stories:react", args=[story.pk]), {"emoji": "❤️"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        n = Notification.objects.get(kind="reaction", recipient=self.kiran)
        self.assertEqual(n.title, "sam reacted to your story")
        self.assertEqual(n.emoji, "❤️")
        self.client.post(reverse("stories:react", args=[story.pk]), {"emoji": "❤️"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(Notification.objects.filter(kind="reaction", recipient=self.kiran).count(), 1)
        # Reacting to your own story tells nobody.
        self.client.force_login(self.kiran)
        self.client.post(reverse("stories:react", args=[story.pk]), {"emoji": "👍"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(Notification.objects.filter(kind="reaction").count(), 1)


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class StoryVisibilityTests(TestCase):
    """Who a story reaches: everyone, friends, or only its author."""

    def setUp(self):
        from apps.accounts.models import Friendship
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")        # a friend
        self.stranger = User.objects.create_user("stranger", password="pw")
        Friendship.objects.create(user=self.kiran, friend=self.sam)
        Friendship.objects.create(user=self.sam, friend=self.kiran)

    def _post(self, visibility):
        self.client.force_login(self.kiran)
        resp = self.client.post(reverse("stories:create"), {"image": picture(9, 16), "visibility": visibility}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        return Story.objects.latest("pk")

    def _sees(self, who, story):
        return Story.objects.for_viewer(who).filter(pk=story.pk).exists()

    def test_friends_only_reaches_friends_and_the_author_and_nobody_else(self):
        story = self._post("friends")
        self.assertEqual(story.visibility, "friends")
        self.assertTrue(self._sees(self.kiran, story))
        self.assertTrue(self._sees(self.sam, story))
        self.assertFalse(self._sees(self.stranger, story))
        # And the page and the reaction endpoint are gated the same way.
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(reverse("stories:person", args=["kiran"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest").status_code, 404)
        self.assertEqual(self.client.post(reverse("stories:react", args=[story.pk]), {"emoji": "❤️"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest").status_code, 404)

    def test_only_me_is_only_me(self):
        story = self._post("private")
        self.assertTrue(self._sees(self.kiran, story))
        self.assertFalse(self._sees(self.sam, story))
        self.assertFalse(self._sees(self.stranger, story))
        from apps.notifications.models import Notification
        self.assertFalse(Notification.objects.filter(kind="story").exists())

    def test_public_is_everyone_and_the_default(self):
        story = self._post("")
        self.assertEqual(story.visibility, "public")
        self.assertTrue(self._sees(self.stranger, story))

    def test_the_tray_and_the_json_carry_it(self):
        story = self._post("friends")
        self.client.force_login(self.stranger)
        resp = self.client.get("/", follow=True)
        self.assertNotContains(resp, 'data-story-of="kiran"', msg_prefix="a friends-only story must not be on a stranger's tray")
        self.client.force_login(self.sam)
        resp = self.client.get("/", follow=True)
        self.assertContains(resp, 'data-story-of="kiran"')
        resp = self.client.get(reverse("stories:person", args=["kiran"]), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.json()["stories"][0]["visibility"], "friends")
