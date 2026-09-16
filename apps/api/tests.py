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

    def test_logout_can_keep_the_token_for_the_phone_lock(self):
        # The app keeps the token behind Face ID: the phone is forgotten, the token is not.
        self.api("post", "devices", {"token": "ExponentPushToken[abc]", "platform": "ios"})
        resp = self.api("post", "logout", {"device": "ExponentPushToken[abc]", "keep_token": True})
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Device.objects.exists())
        self.assertEqual(self.api("get", "home").status_code, 200)

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

    def test_a_photo_of_a_list_comes_back_as_rows(self):
        from apps.plu.picking import Line
        # The OCR is stubbed: what matters here is the reading becoming rows
        # the phone can show, correct and print — not the reading itself.
        read = [Line("lamb leg chops", 90.0), Line("beef mince 2kg", 88.0), Line("Tuesday", 70.0)]
        with patch("apps.plu.picking.read_lines", return_value=read):
            resp = self.api("post", "plu_photo", {"photo": picture()}, fmt="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        rows = data["rows"]
        self.assertEqual([r["item"]["plu_no"] for r in rows], [7012, 900])
        self.assertIn(rows[0]["sureness"], ("sure", "likely", "unsure"))
        self.assertEqual([a["plu_no"] for a in rows[0]["alternatives"]], [1319])
        self.assertEqual(data["skipped"], 1)   # "Tuesday" matched nothing
        # And the rows, corrected on the phone, come back as the PDF.
        resp = self.api("post", "plu_photo_pdf", {"rows": [{"plu_no": 1319, "line": "lamb leg chops"}, {"plu_no": 900, "line": "beef mince"}]})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp.content.startswith(b"%PDF"))
        self.assertEqual(self.api("post", "plu_photo_pdf", {"rows": [{"line": "x"}]}).status_code, 400)

    def test_an_unreadable_photo_is_refused_in_words(self):
        from apps.plu.picking import Unreadable
        with patch("apps.plu.picking.read_lines", side_effect=Unreadable("Nothing legible — try in better light.")):
            resp = self.api("post", "plu_photo", {"photo": picture()}, fmt="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "Nothing legible — try in better light.")
        self.assertEqual(self.api("post", "plu_photo", {}, fmt="multipart").status_code, 400)


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


class TimesheetTests(ApiTestCase):
    """The clock, the timesheet, shifts, workplaces and pay — the site's rules, as data."""

    def setUp(self):
        super().setUp()
        from decimal import Decimal

        from apps.timeclock.models import Workplace

        self.shop = Workplace.objects.create(user=self.kiran, name="Butcher Shop", hourly_rate=Decimal("28.50"), is_default=True)
        self.cafe = Workplace.objects.create(user=self.kiran, name="Cafe Verde", hourly_rate=Decimal("25.00"), hours_limit=Decimal("20"))

    def test_clock_in_break_and_out(self):
        from apps.timeclock.models import Shift

        state = self.api("get", "clock").json()
        self.assertIsNone(state["shift"])
        self.assertEqual(state["selected"], self.shop.pk)
        self.assertEqual([w["name"] for w in state["workplaces"]], ["Butcher Shop", "Cafe Verde"])

        resp = self.api("post", "clock_in", {"workplace": self.cafe.pk, "client_tz": "Australia/Sydney"})
        self.assertEqual(resp.status_code, 200, resp.content)
        state = resp.json()
        self.assertEqual(state["shift"]["status"], "WORKING")
        self.assertEqual(state["shift"]["workplace"]["name"], "Cafe Verde")
        self.assertEqual(state["limit"]["cap"]["hm"], "20h")
        self.assertIn("Clocked in at", state["message"])

        state = self.api("post", "start_break").json()
        self.assertEqual(state["shift"]["status"], "ON_BREAK")
        self.assertIsNotNone(state["shift"]["running_break"])
        state = self.api("post", "end_break").json()
        self.assertEqual(state["shift"]["status"], "WORKING")

        resp = self.api("post", "clock_out")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json()["shift"])
        shift = Shift.objects.get(pk=resp.json()["finished"])
        self.assertEqual(shift.status, "COMPLETED")
        self.assertEqual(shift.breaks.count(), 1)

        # Twice is refused with the site's words.
        self.assertEqual(self.api("post", "clock_out").status_code, 400)
        self.assertEqual(self.api("post", "clock_in", {}).json()["detail"], "Pick a workplace before clocking in.")

    def _shift(self, days_ago, hours=8, workplace=None):
        from datetime import datetime, time, timedelta

        from django.utils import timezone

        from apps.timeclock.models import Shift

        day = timezone.localdate() - timedelta(days=days_ago)
        start = timezone.make_aware(datetime.combine(day, time(8, 0)), timezone.get_current_timezone())
        return Shift.objects.create(
            user=self.kiran, workplace=workplace or self.shop, clock_in=start,
            clock_out=start + timedelta(hours=hours), status="COMPLETED",
        )

    def test_timesheet_days_and_summary(self):
        self._shift(1)
        self._shift(2, workplace=self.cafe)
        data = self.api("get", "timesheet").json()
        self.assertEqual(len(data["days"]), 2)
        self.assertEqual(data["days"][0]["shifts"][0]["worked"]["hm"], "8h")
        self.assertEqual([c["key"] for c in data["summary"]["cards"]], ["week"])
        self.assertEqual(data["summary"]["period"]["title"], "This week’s pay")
        self.assertEqual(len(data["summary"]["limits"]), 1)
        # Filtered to one job, only its shifts and its own summary.
        data = self.api("get", "timesheet", {"workplace": self.cafe.pk}).json()
        self.assertEqual(len(data["days"]), 1)
        self.assertEqual(data["workplace"], self.cafe.pk)

    def test_calendar_grid(self):
        from django.utils import timezone

        shift = self._shift(0)
        today = timezone.localdate()
        data = self.api("get", "calendar", {"year": today.year, "month": today.month, "day": today.isoformat()}).json()
        self.assertEqual(len(data["weekday_labels"]), 7)
        cell = next(c for w in data["weeks"] for c in w if c["date"] == today.isoformat())
        self.assertTrue(cell["is_today"])
        self.assertEqual(cell["total"]["hm"], "8h")
        self.assertEqual(len(cell["track"]), 1)
        self.assertEqual(data["legend"][0]["name"], "Butcher Shop")
        self.assertEqual(data["selected_shifts"][0]["id"], shift.pk)
        self.assertEqual(data["worked_days"], 1)

    def test_add_shift_with_breaks_and_the_form_rules(self):
        from django.utils import timezone

        from apps.timeclock.models import Shift

        opening = self.api("get", "shift_new").json()
        self.assertEqual(opening["workplace"], self.shop.pk)
        from datetime import timedelta

        day = (timezone.localdate() - timedelta(days=1)).strftime("%Y-%m-%d")
        resp = self.api("post", "shifts", {
            "workplace": self.shop.pk, "clock_in": f"{day}T06:00", "clock_out": f"{day}T07:30", "note": "Early start",
            "breaks": [{"break_start": f"{day}T06:30", "break_end": f"{day}T06:45"}],
        })
        self.assertEqual(resp.status_code, 201, resp.content)
        shift = resp.json()
        self.assertEqual(shift["worked"]["hm"], "1h 15m")
        self.assertEqual(len(shift["breaks"]), 1)
        self.assertEqual(shift["pay"]["gross"], 35.62)
        self.assertEqual(shift["note"], "Early start")

        # A future time is refused, in the site's words.
        resp = self.api("post", "shifts", {"workplace": self.shop.pk, "clock_in": "2099-01-01T09:00", "clock_out": "2099-01-01T17:00"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("fields", resp.json())

        # Editing: drop the break, change the end.
        pk = shift["id"]
        break_id = shift["breaks"][0]["id"]
        resp = self.api("patch", "shift", {
            "workplace": self.shop.pk, "clock_in": f"{day}T06:00", "clock_out": f"{day}T07:00", "note": "",
            "breaks": [{"id": break_id, "break_start": f"{day}T06:30", "break_end": f"{day}T06:45", "delete": True}],
        }, args=[pk])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["worked"]["hm"], "1h")
        self.assertEqual(resp.json()["breaks"], [])

        self.assertEqual(self.api("delete", "shift", args=[pk]).status_code, 204)
        self.assertFalse(Shift.objects.filter(pk=pk).exists())
        # Somebody else's shift is nobody's business.
        other = self._shift(3)
        self.assertEqual(self.api("get", "shift", args=[other.pk], token=self.api("post", "login", {"username": "sam", "password": "pw12345678"}).json()["token"]).status_code, 404)

    def test_workplaces_crud_default_and_cycles(self):
        from apps.timeclock.models import Workplace

        data = self.api("get", "workplaces").json()
        self.assertEqual([w["name"] for w in data["workplaces"]], ["Butcher Shop", "Cafe Verde"])
        self.assertEqual(data["workplaces"][1]["sub"], "No address · $25.00/hr · 20h/fortnight")
        self.assertEqual(len(data["choices"]["colors"]), 8)

        resp = self.api("post", "workplaces", {"name": "Bakery", "pay_cycle": "WEEK", "paid_in": "CASH", "hourly_rate": "30", "limit_period": "FORTNIGHT", "week_starts_on": 0, "fortnight_starts_on": 3, "fortnight_phase": "this", "month_starts_on": 1, "is_default": True})
        self.assertEqual(resp.status_code, 201, resp.content)
        bakery = Workplace.objects.get(name="Bakery")
        self.assertTrue(bakery.is_default)
        self.assertTrue(bakery.in_cash)
        self.assertFalse(Workplace.objects.get(pk=self.shop.pk).is_default)

        # The site's name rule, in its words.
        resp = self.api("post", "workplaces", {"name": "bakery", "limit_period": "FORTNIGHT", "week_starts_on": 0, "month_starts_on": 1})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("already have a workplace", resp.json()["fields"]["name"][0])

        resp = self.api("patch", "workplace", {"name": "Bakery", "address": "1 Bread St", "hours_limit": "38", "limit_period": "WEEK", "week_starts_on": 0, "fortnight_starts_on": 3, "fortnight_phase": "this", "month_starts_on": 1}, args=[bakery.pk])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["limit_label"], "38h/week")

        self.assertEqual(self.api("post", "workplace_default", args=[self.shop.pk]).json()["is_default"], True)
        removal = self.api("get", "workplace_removal", args=[bakery.pk]).json()
        self.assertEqual(removal["going"]["shifts"], 0)
        self.assertEqual(self.api("delete", "workplace", args=[bakery.pk]).status_code, 200)
        self.assertFalse(Workplace.objects.filter(pk=bakery.pk).exists())

        resp = self.api("put", "preferences", {"week_starts_on": 0, "fortnight_starts_on": 0, "fortnight_phase": "last", "month_starts_on": 15})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["week_label"], "Monday")
        self.assertEqual(resp.json()["month_starts_on"], 15)

    def test_pay_record_and_undo(self):
        from apps.timeclock.models import Payment

        self._shift(2)
        self._shift(1)
        page = self.api("get", "pay").json()
        shop = next(r for r in page["owing"] if r["workplace"]["id"] == self.shop.pk)
        self.assertEqual(shop["worked"]["hm"], "16h")
        self.assertEqual(shop["owed_pay"]["gross"], 456.0)
        self.assertFalse(shop["scheduled"])
        self.assertEqual(shop["covers"][0]["value"], "now")

        resp = self.api("post", "payment_record", {"covers": "now"}, args=[self.shop.pk])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("marked paid", resp.json()["message"])
        self.assertEqual(Payment.objects.filter(workplace=self.shop).count(), 1)
        shop = next(r for r in resp.json()["owing"] if r["workplace"]["id"] == self.shop.pk)
        self.assertEqual(shop["worked"]["seconds"], 0)
        self.assertEqual(shop["last_payment"]["hours"], 16.0)

        resp = self.api("post", "payment_undo", args=[self.shop.pk])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Payment.objects.filter(workplace=self.shop).count(), 0)
        self.assertEqual(self.api("post", "payment_undo", args=[self.shop.pk]).status_code, 400)

    def test_more_activity_and_statement(self):
        self._shift(1)
        more = self.api("get", "more").json()
        self.assertEqual(more["workplace_count"], 2)
        self.assertEqual(more["unpaid_total"]["hm"], "8h")
        activity = self.api("get", "activity").json()
        self.assertEqual(activity["shift_count"], 1)
        self.assertEqual(len(activity["statement"]["workplaces"]), 2)
        resp = self.api("get", "statement", {"from": activity["statement"]["this_month"][0], "to": activity["statement"]["this_month"][1]})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")
