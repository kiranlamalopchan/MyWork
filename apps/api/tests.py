"""
The API: the site's rules, reachable with a token.

Each test signs in through the API and drives an endpoint the way the app
would — then checks the database the way the site's own tests do, since the
whole point is that a phone and a browser land on the same rows.
"""

import io
from datetime import date
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from apps.accounts.models import Profile
from apps.holidays.models import HolidayPreference, PublicHoliday
from apps.noticeboard.models import Comment, Notice, Reaction
from apps.notifications.models import Device, Notification
from apps.plu.models import PluItem
from apps.stories.models import Story


def picture(width=800, height=600):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(buf, format="JPEG")
    return SimpleUploadedFile("photo.jpg", buf.getvalue(), content_type="image/jpeg")


def fixture(name):
    path = Path(__file__).resolve().parent.parent / "stories" / "fixtures" / name
    return SimpleUploadedFile(name, path.read_bytes())


class ApiTestCase(TestCase):
    """A signed-in phone: `self.api(...)` carries the token."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw12345678")
        self.sam = User.objects.create_user("sam", password="pw12345678")
        resp = self.client.post(reverse("api:login"), {"username": "kiran", "password": "pw12345678"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.token = resp.json()["token"]

    def api(self, method, name, data=None, *, args=None, token=None, fmt="json", **extra):
        url = reverse(f"api:{name}", args=args or [])
        headers = {"HTTP_AUTHORIZATION": f"Token {token or self.token}", **extra}
        call = getattr(self.client, method)
        if method == "get":
            return call(url, data or {}, **headers)
        if fmt == "json":
            return call(url, data or {}, content_type="application/json", **headers)
        return call(url, data or {}, **headers)


class AuthTests(ApiTestCase):
    def test_login_hands_out_a_token_and_who_you_are(self):
        resp = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["token"])
        self.assertEqual(data["me"]["username"], "sam")
        self.assertEqual(data["me"]["initial"], "S")
        self.assertIn("hue", data["me"])

    def test_a_wrong_password_is_refused_in_words(self):
        resp = self.client.post(reverse("api:login"), {"username": "sam", "password": "nope"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("don't match", resp.json()["detail"])

    def test_nothing_else_answers_without_a_token(self):
        self.assertEqual(self.client.get(reverse("api:home")).status_code, 401)

    def test_register_makes_an_account_under_the_site_rules(self):
        resp = self.client.post(reverse("api:register"), {"username": "newbie", "password": "a-long-enough-one"})
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(User.objects.filter(username="newbie").exists())
        weak = self.client.post(reverse("api:register"), {"username": "weak", "password": "123"})
        self.assertEqual(weak.status_code, 400)
        self.assertIn("fields", weak.json())
        taken = self.client.post(reverse("api:register"), {"username": "kiran", "password": "a-long-enough-one"})
        self.assertEqual(taken.status_code, 400)

    def test_logout_forgets_the_token_and_the_phone(self):
        self.api("post", "devices", {"token": "ExponentPushToken[abc]", "platform": "ios"})
        resp = self.api("post", "logout", {"device": "ExponentPushToken[abc]"})
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self.api("get", "home").status_code, 401)
        self.assertFalse(Device.objects.exists())

    def test_an_api_call_counts_as_being_here(self):
        self.assertIsNone(Profile.objects.get(user=self.kiran).last_seen)
        self.api("get", "home")
        self.assertIsNotNone(Profile.objects.get(user=self.kiran).last_seen)


class MeTests(ApiTestCase):
    def test_me_can_be_read_and_changed_a_field_at_a_time(self):
        resp = self.api("patch", "me", {"display_name": "Kiran L", "phone": "0400 000 000"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["name"], "Kiran L")
        self.assertEqual(Profile.objects.get(user=self.kiran).phone, "0400 000 000")
        again = self.api("patch", "me", {"email": "k@example.com"})
        self.assertEqual(again.json()["display_name"], "Kiran L")   # untouched
        self.kiran.refresh_from_db()
        self.assertEqual(self.kiran.email, "k@example.com")
        bad = self.api("patch", "me", {"email": "not-an-email"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("email", bad.json()["fields"])

    @override_settings(MEDIA_ROOT="/tmp/mywork-test-media-api")
    def test_a_photo_goes_up_and_comes_off(self):
        resp = self.api("post", "me_photo", {"photo": picture()}, fmt="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["photo"].startswith("http://testserver/media/"))
        gone = self.api("delete", "me_photo")
        self.assertIsNone(gone.json()["photo"])

    def test_the_holiday_state_is_yours_to_set(self):
        resp = self.api("put", "me_holiday_state", {"state": "vic"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["holiday_state"], "VIC")
        self.assertEqual(HolidayPreference.state_for(self.kiran), "VIC")
        self.assertEqual(self.api("put", "me_holiday_state", {"state": "XX"}).status_code, 400)

    def test_a_phone_is_remembered_once_and_re_owned(self):
        self.api("post", "devices", {"token": "ExponentPushToken[abc]", "platform": "ios", "name": "Kiran's iPhone"})
        self.api("post", "devices", {"token": "ExponentPushToken[abc]", "platform": "ios"})
        self.assertEqual(Device.objects.count(), 1)
        sam = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"}).json()["token"]
        self.api("post", "devices", {"token": "ExponentPushToken[abc]", "platform": "ios"}, token=sam)
        self.assertEqual(Device.objects.get().user, self.sam)


class HomeTests(ApiTestCase):
    def test_the_hub_carries_everything_the_first_tab_draws(self):
        from apps.noticeboard.notify import notice_posted
        notice_posted(Notice.objects.create(author=self.sam, body="Hello board"))
        PublicHoliday.objects.create(date=date(2099, 12, 25), name="Christmas Day", state="NATIONAL")
        resp = self.api("get", "home", HTTP_X_TIMEZONE="Australia/Sydney")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["holiday"]["holiday"]["name"], "Christmas Day")
        self.assertEqual(data["notices"][0]["body"], "Hello board")
        self.assertEqual(data["notice_total"], 1)
        self.assertEqual(data["stories"], [])
        self.assertEqual(data["unread"], 1)   # sam's post told kiran
        self.assertEqual(len(data["emoji"]), 7)


class BoardTests(ApiTestCase):
    def test_posting_reads_back_and_tells_the_room(self):
        resp = self.api("post", "notices", {"body": "Cold room door — please close it"})
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json()["mine"])
        self.assertEqual(Notice.objects.get().author, self.kiran)
        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)
        self.assertEqual(self.api("post", "notices", {"body": "   "}).status_code, 400)
        page = self.api("get", "notices").json()
        self.assertEqual(page["count"], 1)
        self.assertEqual(page["results"][0]["author"]["username"], "kiran")

    def test_only_your_own_can_be_changed_or_removed(self):
        theirs = Notice.objects.create(author=self.sam, body="Sam's")
        self.assertEqual(self.api("patch", "notice", {"body": "x"}, args=[theirs.pk]).status_code, 404)
        self.assertEqual(self.api("delete", "notice", args=[theirs.pk]).status_code, 404)
        mine = Notice.objects.create(author=self.kiran, body="Mine")
        self.assertEqual(self.api("patch", "notice", {"body": "Mine, fixed"}, args=[mine.pk]).json()["body"], "Mine, fixed")
        self.assertEqual(self.api("delete", "notice", args=[mine.pk]).status_code, 204)
        self.assertFalse(Notice.objects.filter(pk=mine.pk).exists())

    def test_reacting_toggles_and_names_the_room(self):
        notice = Notice.objects.create(author=self.sam, body="Sam's")
        resp = self.api("post", "notice_react", {"emoji": "❤️"}, args=[notice.pk])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["my_emoji"], "❤️")
        self.assertEqual(resp.json()["reactions"], [{"emoji": "❤️", "count": 1}])
        self.assertEqual(resp.json()["who_reacted"], "You")
        again = self.api("post", "notice_react", {"emoji": "❤️"}, args=[notice.pk]).json()
        self.assertEqual(again["my_emoji"], "")
        self.assertEqual(Reaction.objects.count(), 0)
        who = self.api("get", "notice_reactors", args=[notice.pk]).json()
        self.assertEqual(who["total"], 0)

    def test_comments_and_replies_fold_the_way_the_board_does(self):
        notice = Notice.objects.create(author=self.sam, body="Sam's")
        first = self.api("post", "comments", {"body": "first"}, args=[notice.pk])
        self.assertEqual(first.status_code, 201, first.content)
        parent = first.json()["comments"][0]["id"]
        for n in range(3):
            self.api("post", "comments", {"body": f"reply {n}", "parent": parent}, args=[notice.pk])
        for n in range(4):
            self.api("post", "comments", {"body": f"comment {n}"}, args=[notice.pk])
        folded = self.api("get", "notices").json()["results"][0]
        self.assertEqual(len(folded["comments"]), 3)
        self.assertEqual(folded["older_comments"], 2)
        self.assertEqual(folded["comment_total"], 8)
        whole = self.api("get", "notice", args=[notice.pk]).json()
        self.assertEqual(len(whole["comments"]), 5)
        self.assertEqual(len(whole["comments"][0]["replies"]), 3)
        # A reply to a reply joins the thread rather than nesting deeper.
        deeper = whole["comments"][0]["replies"][0]["id"]
        self.api("post", "comments", {"body": "deeper", "parent": deeper}, args=[notice.pk])
        self.assertEqual(Comment.objects.get(body="deeper").parent_id, parent)
        # Sam was told about the comment on their notice.
        self.assertTrue(Notification.objects.filter(recipient=self.sam, kind="comment").exists())

    def test_removing_a_comment_takes_its_replies(self):
        notice = Notice.objects.create(author=self.sam, body="Sam's")
        mine = Comment.objects.create(notice=notice, author=self.kiran, body="mine")
        Comment.objects.create(notice=notice, author=self.sam, body="reply", parent=mine)
        theirs = Comment.objects.create(notice=notice, author=self.sam, body="theirs")
        self.assertEqual(self.api("delete", "comment", args=[theirs.pk]).status_code, 404)
        resp = self.api("delete", "comment", args=[mine.pk])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Comment.objects.count(), 1)

    def test_a_person_page_counts_what_they_did(self):
        notice = Notice.objects.create(author=self.sam, body="Sam's")
        Reaction.objects.create(notice=notice, user=self.kiran, emoji="👍")
        resp = self.api("get", "person", args=["sam"])
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["notice_count"], 1)
        self.assertEqual(data["received"], 1)
        self.assertEqual(data["notices"][0]["my_emoji"], "👍")


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media-api")
class StoryTests(ApiTestCase):
    def test_a_photo_story_goes_up_and_shows_in_the_tray(self):
        resp = self.api("post", "stories", {"image": picture(), "caption": "Snow day"}, fmt="multipart")
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data["story"]["image"].startswith("http://testserver/media/"))
        self.assertEqual(data["stories"][0]["username"], "kiran")
        self.assertTrue(data["stories"][0]["mine"])
        sam = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"}).json()["token"]
        tray = self.api("get", "stories", token=sam).json()["stories"]
        self.assertTrue(tray[0]["unseen"])

    def test_a_video_story_is_cut_to_the_window_sent(self):
        import shutil
        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            self.skipTest("needs ffmpeg")
        resp = self.api(
            "post", "stories",
            {"video": fixture("long.mp4"), "duration": "65", "trim_start": "3", "trim_end": "13"},
            fmt="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        story = Story.objects.get()
        self.assertAlmostEqual(story.duration, 10.0, delta=0.5)
        self.assertTrue(resp.json()["story"]["video"].endswith(".mp4"))
        # No poster was sent: the server took the first frame for the tile.
        self.assertTrue(story.image)
        self.assertTrue(resp.json()["story"]["image"].endswith(".jpg"))

    def test_a_video_over_a_minute_is_refused_in_words(self):
        resp = self.api("post", "stories", {"video": fixture("long.mp4"), "duration": "65"}, fmt="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("60 seconds", resp.json()["detail"])

    def test_nothing_at_all_is_refused(self):
        resp = self.api("post", "stories", {"caption": "hi"}, fmt="multipart")
        self.assertEqual(resp.status_code, 400)

    def test_seeing_reacting_and_taking_down(self):
        story = Story(author=self.sam)
        story.set_image(picture())
        story.save()
        viewer = self.api("get", "story_person", args=["sam"]).json()
        self.assertEqual(viewer["stories"][0]["id"], story.pk)
        self.assertEqual(viewer["name"], "sam")
        self.assertEqual(self.api("post", "story_seen", args=[story.pk]).status_code, 204)
        self.assertEqual(story.views.count(), 1)
        react = self.api("post", "story_react", {"emoji": "😂"}, args=[story.pk]).json()
        self.assertEqual(react["my_emoji"], "😂")
        self.assertEqual(self.api("delete", "story", args=[story.pk]).status_code, 403)
        sam = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"}).json()["token"]
        self.assertEqual(self.api("delete", "story", args=[story.pk], token=sam).status_code, 200)
        self.assertEqual(Story.objects.count(), 0)
        self.assertEqual(self.api("get", "story_person", args=["sam"]).status_code, 404)


class NotificationTests(ApiTestCase):
    def test_the_inbox_lists_and_reads(self):
        Notice.objects.create(author=self.sam, body="Sam's")   # no notify: made directly
        from apps.notifications.notify import notify
        notify(self.kiran, "notice", "sam posted", url="/notices/?notice=1", actor=self.sam)
        resp = self.api("get", "notifications", HTTP_X_TIMEZONE="Australia/Darwin")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["unread"], 1)
        self.assertFalse(data["results"][0]["read"])
        self.assertEqual(data["results"][0]["actor"]["username"], "sam")
        one = self.api("post", "notification_read", args=[data["results"][0]["id"]]).json()
        self.assertEqual(one["url"], "/notices/?notice=1")
        self.assertEqual(one["unread"], 0)
        notify(self.kiran, "notice", "again", url="/notices/", actor=self.sam)
        self.assertEqual(self.api("get", "notifications_unread").json()["unread"], 1)
        self.assertEqual(self.api("post", "notifications_read").json()["unread"], 0)

    def test_a_notice_reaches_a_phone_through_expo(self):
        Device.store(self.sam, "ExponentPushToken[sam]", "android", "Pixel")
        with patch("apps.notifications.push.requests.post") as post:
            post.return_value.json.return_value = {"data": [{"status": "ok"}]}
            self.api("post", "notices", {"body": "Hello phones"})
        self.assertEqual(post.call_count, 1)
        sent = post.call_args.kwargs["json"][0]
        self.assertEqual(sent["to"], "ExponentPushToken[sam]")
        self.assertEqual(sent["title"], Notification.objects.get(recipient=self.sam).title)
        self.assertEqual(sent["badge"], 1)
        self.assertTrue(sent["data"]["url"].startswith("/notifications/"))
        self.assertIsNotNone(Device.objects.get().last_sent_at)

    def test_a_phone_that_lost_the_app_is_forgotten(self):
        Device.store(self.sam, "ExponentPushToken[gone]", "ios")
        with patch("apps.notifications.push.requests.post") as post:
            post.return_value.json.return_value = {
                "data": [{"status": "error", "message": "…", "details": {"error": "DeviceNotRegistered"}}]
            }
            self.api("post", "notices", {"body": "Anyone there?"})
        self.assertFalse(Device.objects.exists())

    def test_expo_being_down_loses_nothing_but_the_buzz(self):
        Device.store(self.sam, "ExponentPushToken[sam]", "ios")
        with patch("apps.notifications.push.requests.post", side_effect=OSError("down")):
            resp = self.api("post", "notices", {"body": "Still posted"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)


class PluTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        for no, desc in ((7012, "LAMB LEG CHOPS"), (1319, "LAMB LOIN CHOPS"), (900, "BEEF MINCE")):
            PluItem.objects.create(plu_no=no, description=desc)

    def test_search_ranks_as_the_page_does(self):
        resp = self.api("get", "plu_search", {"q": "lamb chops"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual([r["plu_no"] for r in data["results"]], [7012, 1319])   # 7000s first
        self.assertEqual(data["count"], 2)
        self.assertEqual(self.api("get", "plu_search", {"q": ""}).json()["results"], [])

    def test_one_item(self):
        self.assertEqual(self.api("get", "plu_item", args=[900]).json()["description"], "BEEF MINCE")
        self.assertEqual(self.api("get", "plu_item", args=[1]).status_code, 404)


class HolidayTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        PublicHoliday.objects.create(date=date(2099, 12, 25), name="Christmas Day", state="NATIONAL")
        PublicHoliday.objects.create(date=date(2099, 11, 3), name="Melbourne Cup", state="VIC")

    def test_next_and_upcoming_for_a_state(self):
        self.assertEqual(self.api("get", "holidays_next", {"state": "VIC"}).json()["holiday"]["name"], "Melbourne Cup")
        self.assertEqual(self.api("get", "holidays_next", {"state": "NT"}).json()["holiday"]["name"], "Christmas Day")
        self.assertEqual(self.api("get", "holidays_next", {"state": "ZZ"}).status_code, 400)
        upcoming = self.api("get", "holidays_upcoming", {"state": "VIC"}).json()
        self.assertEqual([h["name"] for h in upcoming["holidays"]], [])   # 2099 is past the year-ahead horizon
        self.assertEqual(len(upcoming["states"]), 8)
