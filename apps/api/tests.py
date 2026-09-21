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
from django.utils import timezone
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

    def test_the_username_can_be_changed_but_not_to_someone_elses(self):
        resp = self.api("patch", "me", {"username": "kiran_l"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["username"], "kiran_l")
        self.assertTrue(User.objects.filter(username="kiran_l", pk=self.kiran.pk).exists())
        # The token still opens the account under its new name.
        self.assertEqual(self.api("get", "me").json()["username"], "kiran_l")
        # Sam's name, in any case, is Sam's.
        for attempt in ("sam", "SAM"):
            clash = self.api("patch", "me", {"username": attempt})
            self.assertEqual(clash.status_code, 400)
            self.assertEqual(clash.json()["fields"]["username"], ["That username is taken."])
        bad = self.api("patch", "me", {"username": "no spaces"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("username", bad.json()["fields"])
        # Left out, it stays as it is.
        self.assertEqual(self.api("patch", "me", {"phone": "0400"}).json()["username"], "kiran_l")

    def test_the_account_can_be_deleted_behind_the_password(self):
        from apps.timeclock.models import Shift, Workplace
        place = Workplace.objects.create(user=self.kiran, name="Butcher Shop")
        Shift.objects.create(user=self.kiran, workplace=place, clock_in=timezone.now(), clock_out=timezone.now())
        wrong = self.api("delete", "me", {"password": "nope"})
        self.assertEqual(wrong.status_code, 400)
        self.assertTrue(User.objects.filter(username="kiran").exists())
        gone = self.api("delete", "me", {"password": "pw12345678"})
        self.assertEqual(gone.status_code, 204)
        self.assertFalse(User.objects.filter(username="kiran").exists())
        self.assertFalse(Shift.objects.filter(workplace__name="Butcher Shop").exists())
        # The token died with the account.
        self.assertEqual(self.api("get", "me").status_code, 401)

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


class VisibilityApiTests(ApiTestCase):
    """Who can see this — the same rule as the site, reachable with a token."""

    def test_posting_with_an_audience_saves_and_returns_it(self):
        resp = self.api("post", "notices", {"body": "just us", "visibility": "friends"})
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["visibility"], "friends")
        self.assertEqual(Notice.objects.get().visibility, "friends")

    def test_omitting_it_defaults_to_public(self):
        resp = self.api("post", "notices", {"body": "hello"})
        self.assertEqual(resp.json()["visibility"], "public")

    def test_a_friends_only_notice_is_hidden_from_the_list_until_youre_friends(self):
        Notice.objects.create(author=self.sam, body="just friends", visibility="friends")

        page = self.api("get", "notices").json()
        self.assertEqual(page["count"], 0)

        from apps.accounts.models import Friendship
        Friendship.befriend(self.sam, self.kiran)

        page = self.api("get", "notices").json()
        self.assertEqual(page["count"], 1)

    def test_a_private_notice_404s_for_anyone_but_its_author(self):
        notice = Notice.objects.create(author=self.sam, body="only sam", visibility="private")
        self.assertEqual(self.api("get", "notice", args=[notice.pk]).status_code, 404)
        self.assertEqual(
            self.api("post", "notice_react", {"emoji": "👍"}, args=[notice.pk]).status_code, 404
        )

    def test_the_home_endpoint_does_not_choke_on_a_page_of_notices(self):
        """Regression: the hub used to hand the same decorated notice
        objects to two different code paths that each expected to be the
        one calling `comment_total()`."""
        notice = Notice.objects.create(author=self.sam, body="Sam's")
        Comment.objects.create(notice=notice, author=self.kiran, body="hi")
        resp = self.api("get", "home")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["notices"][0]["comment_total"], 1)


class FriendsApiTests(ApiTestCase):
    def test_sending_accepting_and_listing(self):
        resp = self.api("post", "friend_request_send", args=["sam"])
        self.assertEqual(resp.status_code, 201, resp.content)

        from apps.accounts.models import FriendRequest
        req = FriendRequest.objects.get()

        sam_token = self.client.post(
            reverse("api:login"), {"username": "sam", "password": "pw12345678"}
        ).json()["token"]
        resp = self.api("post", "friend_request_accept", args=[req.pk], token=sam_token)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "friends")

        data = self.api("get", "friends").json()
        self.assertEqual([f["username"] for f in data["friends"]], ["sam"])
        self.assertEqual(data["received"], [])
        self.assertEqual(data["sent"], [])

    def test_a_crossed_pair_settles_into_one_friendship(self):
        from apps.accounts.models import FriendRequest

        FriendRequest.objects.create(from_user=self.sam, to_user=self.kiran)
        resp = self.api("post", "friend_request_send", args=["sam"])
        self.assertEqual(resp.json()["status"], "friends")
        self.assertFalse(FriendRequest.objects.exists())

    def test_declining_removes_the_request_only(self):
        from apps.accounts.models import FriendRequest, Friendship

        self.api("post", "friend_request_send", args=["sam"])
        req = FriendRequest.objects.get()
        self.assertEqual(self.api("post", "friend_request_decline", args=[req.pk]).status_code, 204)
        self.assertFalse(FriendRequest.objects.exists())
        self.assertFalse(Friendship.are_friends(self.kiran, self.sam))

    def test_removing_a_friend(self):
        from apps.accounts.models import Friendship

        Friendship.befriend(self.kiran, self.sam)
        resp = self.api("post", "friend_remove", args=["sam"])
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Friendship.are_friends(self.kiran, self.sam))


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

    def test_the_idle_box_is_given_real_rows_to_show(self):
        # What the search box shows before anything is typed comes from the
        # list that was imported, not from anything invented here.
        idle = self.api("get", "plu_search", {"q": ""}).json()
        self.assertEqual(idle["total"], 3)
        mine = {(i["plu_no"], i["description"]) for i in idle["samples"]}
        self.assertEqual(mine, {(7012, "LAMB LEG CHOPS"), (1319, "LAMB LOIN CHOPS"), (900, "BEEF MINCE")})

    def test_a_name_too_long_to_watch_being_typed_is_passed_over(self):
        PluItem.objects.all().delete()
        PluItem.objects.create(plu_no=1, description="BEEF MINCE")
        PluItem.objects.create(plu_no=2, description="LAMB FOREQUARTER CHOPS FAMILY VALUE PACK")
        samples = self.api("get", "plu_search", {"q": ""}).json()["samples"]
        self.assertEqual([i["plu_no"] for i in samples], [1])

    def test_when_every_name_is_long_it_shows_one_anyway(self):
        PluItem.objects.all().delete()
        PluItem.objects.create(plu_no=2, description="LAMB FOREQUARTER CHOPS FAMILY VALUE PACK")
        samples = self.api("get", "plu_search", {"q": ""}).json()["samples"]
        self.assertEqual([i["plu_no"] for i in samples], [2])

    def test_an_empty_list_has_nothing_to_show(self):
        PluItem.objects.all().delete()
        self.assertEqual(self.api("get", "plu_search", {"q": ""}).json()["samples"], [])

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


class PluImportTests(ApiTestCase):
    """The site's staff-only CSV import, reached with a token."""

    def csv(self, text, name="plu.csv"):
        return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")

    def staff_token(self):
        self.kiran.is_staff = True
        self.kiran.save()
        return self.token

    def test_an_ordinary_account_is_told_it_may_not_and_cannot(self):
        self.assertFalse(self.api("get", "plu_import").json()["allowed"])
        resp = self.api(
            "post", "plu_import",
            {"file": self.csv("plu_no,description\n7012,LAMB LEG CHOPS\n")},
            fmt="multipart",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(PluItem.objects.count(), 0)

    def test_a_manager_may_and_the_rows_go_in(self):
        token = self.staff_token()
        self.assertTrue(self.api("get", "plu_import", token=token).json()["allowed"])
        PluItem.objects.create(plu_no=900, description="OLD NAME")

        resp = self.api(
            "post", "plu_import",
            # A till export's extra columns are ignored, as on the site.
            {"file": self.csv(
                "plu_no,description,price,tare\n"
                "7012,LAMB LEG CHOPS,12.50,0\n"
                "900,BEEF MINCE,8.00,0\n"
            )},
            fmt="multipart", token=token,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual((data["created"], data["updated"], data["skipped"]), (1, 1, 0))
        self.assertEqual(data["total"], 2)
        self.assertEqual(PluItem.objects.get(plu_no=900).description, "BEEF MINCE")

    def test_a_row_without_a_number_or_a_name_is_skipped_not_guessed_at(self):
        token = self.staff_token()
        resp = self.api(
            "post", "plu_import",
            {"file": self.csv(
                "plu_no,description\n"
                "7012,LAMB LEG CHOPS\n"
                "abc,NOT A NUMBER\n"
                ",NO NUMBER\n"
                "1319,\n"
            )},
            fmt="multipart", token=token,
        )
        self.assertEqual(resp.json()["skipped"], 3)
        self.assertEqual(PluItem.objects.count(), 1)

    def test_a_file_missing_its_headers_is_refused_in_so_many_words(self):
        token = self.staff_token()
        resp = self.api(
            "post", "plu_import",
            {"file": self.csv("code,name\n7012,LAMB\n")},
            fmt="multipart", token=token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("missing headers", resp.json()["detail"])
        self.assertEqual(PluItem.objects.count(), 0)

    def test_sending_nothing_asks_for_a_file(self):
        token = self.staff_token()
        resp = self.api("post", "plu_import", {}, fmt="multipart", token=token)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Choose a CSV", resp.json()["detail"])


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

    def _worked(self, workplace, hours):
        from datetime import timedelta

        from django.utils import timezone

        from apps.timeclock.models import Shift

        at = (timezone.localtime() - timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        Shift.objects.create(
            user=self.kiran, workplace=workplace, clock_in=at,
            clock_out=at + timedelta(hours=hours), status=Shift.Status.COMPLETED,
        )

    def test_the_clock_answers_for_the_workplace_it_is_asked_about(self):
        # The cap under the dial is the picked job's, not whichever is default.
        self._worked(self.cafe, 5)
        default = self.api("get", "clock").json()
        self.assertEqual(default["selected"], self.shop.pk)
        self.assertIsNone(default["limit"])          # the shop has no cap

        picked = self.api("get", "clock", {"workplace": self.cafe.pk}).json()
        self.assertEqual(picked["selected"], self.cafe.pk)
        self.assertEqual(picked["limit"]["workplace"]["name"], "Cafe Verde")
        self.assertEqual(picked["limit"]["cap"]["hm"], "20h")

    def test_a_cash_job_without_a_cap_counts_what_is_owed_instead(self):
        from apps.timeclock.models import PaidIn, Workplace

        Workplace.objects.filter(pk=self.shop.pk).update(paid_in=PaidIn.CASH)
        self._worked(self.shop, 4)

        state = self.api("get", "clock", {"workplace": self.shop.pk}).json()
        self.assertIsNone(state["limit"])            # nothing to draw a bar against
        self.assertEqual(state["tally"]["workplace"]["name"], "Butcher Shop")
        self.assertEqual(state["tally"]["total"]["hm"], "4h")
        self.assertEqual(state["tally"]["label"], "Since you were paid")

    def test_a_cap_is_the_better_answer_and_keeps_its_place(self):
        # Cash, but capped: the cap is what was asked for, so the cap is shown.
        from apps.timeclock.models import PaidIn, Workplace

        Workplace.objects.filter(pk=self.cafe.pk).update(paid_in=PaidIn.CASH)
        self._worked(self.cafe, 4)

        state = self.api("get", "clock", {"workplace": self.cafe.pk}).json()
        self.assertIsNone(state["tally"])
        self.assertEqual(state["limit"]["workplace"]["name"], "Cafe Verde")

    def test_a_bank_job_without_a_cap_says_nothing_either_way(self):
        self._worked(self.shop, 4)
        state = self.api("get", "clock", {"workplace": self.shop.pk}).json()
        self.assertIsNone(state["limit"])
        self.assertIsNone(state["tally"])

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


class ModerationApiTests(ApiTestCase):
    """Blocking a person and reporting a post, from the app."""

    def test_block_hides_them_and_unblock_brings_them_back(self):
        Notice.objects.create(author=self.sam, body="From Sam")
        resp = self.api("post", "person_block", args=["sam"])
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["blocked"])
        board = self.api("get", "notices").json()
        self.assertEqual([n["author"]["username"] for n in board["results"]], [])
        self.assertEqual(self.api("get", "person", args=["sam"]).json()["blocked"], True)
        blocked = self.api("get", "me_blocked").json()["people"]
        self.assertEqual([p["person"]["username"] for p in blocked], ["sam"])

        resp = self.api("delete", "person_block", args=["sam"])
        self.assertFalse(resp.json()["blocked"])
        board = self.api("get", "notices").json()
        self.assertEqual([n["author"]["username"] for n in board["results"]], ["sam"])

    def test_the_blocked_person_cannot_find_you(self):
        self.api("post", "person_block", args=["sam"])
        resp = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"})
        sam = resp.json()["token"]
        self.assertEqual(self.api("get", "person", args=["kiran"], token=sam).status_code, 404)
        self.assertEqual(self.api("post", "friend_request_send", args=["kiran"], token=sam).status_code, 400)
        others = self.api("get", "friends", token=sam).json()["others"]
        self.assertNotIn("kiran", [p["username"] for p in others])

    def test_you_cannot_block_yourself(self):
        self.assertEqual(self.api("post", "person_block", args=["kiran"]).status_code, 400)

    def test_report_a_notice(self):
        from apps.moderation.models import Report
        notice = Notice.objects.create(author=self.sam, body="Rude")
        self.assertEqual(self.api("get", "report").json()["reasons"][0]["value"], "spam")
        resp = self.api("post", "report", {"kind": "notice", "id": notice.pk, "reason": "harassment", "note": "look"})
        self.assertEqual(resp.status_code, 201, resp.content)
        report = Report.objects.get()
        self.assertEqual((report.reporter, report.accused, report.reason), (self.kiran, self.sam, "harassment"))

    def test_report_refuses_your_own_and_nonsense(self):
        notice = Notice.objects.create(author=self.kiran, body="Mine")
        self.assertEqual(self.api("post", "report", {"kind": "notice", "id": notice.pk}).status_code, 400)
        self.assertEqual(self.api("post", "report", {"kind": "thing", "id": 1}).status_code, 400)
        self.assertEqual(self.api("post", "report", {"kind": "notice", "id": 999}).status_code, 404)

    def test_the_filter_refuses_a_notice_and_a_comment(self):
        resp = self.api("post", "notices", {"body": "kys", "visibility": "public"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("civil", resp.json()["detail"])
        notice = Notice.objects.create(author=self.sam, body="ok")
        resp = self.api("post", "comments", {"body": "you cunt", "visibility": "public"}, args=[notice.pk])
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Comment.objects.exists())


@override_settings(MEDIA_ROOT="/tmp/mywork-test-media")
class ChunkedUploadTests(ApiTestCase):
    """A video too big for one request: sent in pieces, then named when the story is made."""

    def _pieces(self, blob, n):
        import base64
        size = -(-len(blob) // n)
        return [base64.b64encode(blob[i * size:(i + 1) * size]).decode() for i in range(n)]

    def test_pieces_are_assembled_in_order_and_become_the_story(self):
        import os
        from pathlib import Path
        from apps.stories.models import Story
        blob = (Path("apps/stories/fixtures/short.mp4")).read_bytes()
        pieces = self._pieces(blob, 3)
        upload_id = "ab12cd34ef56ab12cd34"
        for i, data in enumerate(pieces):
            resp = self.api("post", "uploads", {"upload_id": upload_id, "index": i, "total": 3, "data": data})
            self.assertEqual(resp.status_code, 200, resp.content[:200])
            self.assertEqual(resp.json()["received"], i + 1)
        self.assertEqual(resp.json()["bytes"], len(blob))
        resp = self.api("post", "stories", {"upload_id": upload_id, "filename": "clip.mp4", "caption": "in pieces", "duration": "3.0"}, fmt="multipart")
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        story = Story.objects.get()
        self.assertTrue(story.is_video)
        self.assertEqual(story.caption, "in pieces")
        # The assembled file is gone once the story has it.
        self.assertFalse(os.path.exists(f"/tmp/mywork-test-media/uploads/{self.kiran.pk}-{upload_id}.part"))
        # And the id can't be used twice.
        resp = self.api("post", "stories", {"upload_id": upload_id, "filename": "clip.mp4"}, fmt="multipart")
        self.assertEqual(resp.status_code, 400)

    def test_a_bad_id_a_missing_start_and_somebody_elses_pieces_are_refused(self):
        self.assertEqual(self.api("post", "uploads", {"upload_id": "../x", "index": 0, "total": 1, "data": "AAAA"}).status_code, 400)
        self.assertEqual(self.api("post", "uploads", {"upload_id": "ab12cd34ef56ab12cd34", "index": 1, "total": 2, "data": "AAAA"}).status_code, 409)
        self.assertEqual(self.api("post", "uploads", {"upload_id": "ab12cd34ef56ab12cd34", "index": 0, "total": 2, "data": "AAAA"}).status_code, 200)
        # Another person naming the same id gets nothing: the file is scoped by user.
        other = User.objects.create_user("other", password="pw")
        from rest_framework.authtoken.models import Token
        token = Token.objects.create(user=other).key
        resp = self.api("post", "stories", {"upload_id": "ab12cd34ef56ab12cd34", "filename": "clip.mp4"}, fmt="multipart", token=token)
        self.assertEqual(resp.status_code, 400)

    def test_a_full_size_piece_is_not_too_big_for_django(self):
        # The app sends 6 MB pieces (8 MB as base64) — past Django's 2.5 MB
        # DATA_UPLOAD_MAX_MEMORY_SIZE, which must not apply to this stream.
        import base64, os
        blob = os.urandom(6 * 1024 * 1024)
        resp = self.api("post", "uploads", {"upload_id": "ab12cd34ef56ab12cd34", "index": 0, "total": 1, "data": base64.b64encode(blob).decode()})
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(resp.json()["bytes"], len(blob))
