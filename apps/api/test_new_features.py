"""
The roster, messages between friends, the payslip check and the payday
summary — each driven the way the app drives it.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Friendship
from apps.chat.models import Message
from apps.moderation.models import Block
from apps.notifications.models import Kind, Notification
from apps.roster.models import PlannedShift
from apps.timeclock.models import PayCycle, Shift, Workplace

from .tests import ApiTestCase, PayslipApiTests


def hours_from_now(n):
    return (timezone.now() + timedelta(hours=n)).isoformat()


class RosterTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.cafe = Workplace.objects.create(user=self.kiran, name="Cafe Verde")
        Friendship.befriend(self.kiran, self.sam)
        self.sam_token = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"}).json()["token"]

    def plan(self, **over):
        data = {"workplace": self.cafe.pk, "starts": hours_from_now(24), "ends": hours_from_now(32), "note": "Opening"}
        data.update(over)
        return self.api("post", "roster", data)

    def test_a_planned_shift_is_on_your_roster(self):
        resp = self.plan()
        self.assertEqual(resp.status_code, 201, resp.content)
        (row,) = resp.json()["mine"]
        self.assertEqual(row["place"], "Cafe Verde")
        self.assertEqual(row["length"], "8h")
        self.assertFalse(row["offered"])

    def test_request_ids_are_echoed_or_replaced_and_server_faults_are_private(self):
        good = self.api("get", "roster", HTTP_X_REQUEST_ID="phone-request-123")
        self.assertEqual(good["X-Request-ID"], "phone-request-123")
        invalid = self.api("get", "roster", HTTP_X_REQUEST_ID="too long " * 20)
        self.assertRegex(invalid["X-Request-ID"], r"^[a-f0-9]{32}$")
        with patch("apps.api.views.roster.roster_page", side_effect=RuntimeError("Bearer private-secret")):
            with self.assertLogs("apps.api.observability", level="ERROR") as logged:
                failed = self.api("get", "roster")
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(failed.json()["detail"], "Something went wrong on our side. Please try again.")
        self.assertNotIn("private-secret", str(logged.output))
        self.assertNotIn("private-secret", failed.content.decode())

    def test_malformed_dates_and_workplace_are_field_errors(self):
        for value in ["not-an-id", "9" * 50, [1]]:
            with self.subTest(workplace=value):
                result = self.plan(workplace=value)
                self.assertEqual(result.status_code, 400)
                self.assertIn("workplace", result.json()["fields"])
        for value in ["2026-13-01T09:00:00Z", "bad date", "2026-02-30T09:00:00Z"]:
            with self.subTest(starts=value):
                result = self.plan(starts=value)
                self.assertEqual(result.status_code, 400)
                self.assertIn("starts", result.json()["fields"])

    def test_a_shift_that_ends_before_it_starts_is_refused_under_its_own_box(self):
        resp = self.plan(ends=hours_from_now(20))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ends", resp.json()["fields"])
        self.assertFalse(PlannedShift.objects.exists())

    def test_one_already_over_and_one_with_no_job_are_refused(self):
        self.assertEqual(self.plan(starts=hours_from_now(-9), ends=hours_from_now(-1)).status_code, 400)
        self.assertIn("workplace", self.plan(workplace="").json()["fields"])

    def test_it_can_be_changed_and_removed_only_by_its_owner(self):
        pk = self.plan().json()["mine"][0]["id"]
        self.assertEqual(self.api("patch", "roster_shift", {"note": "x"}, args=[pk], token=self.sam_token).status_code, 404)
        self.assertEqual(self.api("patch", "roster_shift", {"note": "Close instead"}, args=[pk]).json()["mine"][0]["note"], "Close instead")
        self.assertEqual(self.api("delete", "roster_shift", args=[pk]).json()["mine"], [])

    def test_a_friend_is_told_and_can_take_a_shift_put_up(self):
        pk = self.plan().json()["mine"][0]["id"]
        with patch("apps.notifications.push.send_to_user") as push:
            self.assertTrue(self.api("post", "roster_offer", args=[pk]).json()["mine"][0]["offered"])
            # Putting it up twice tells nobody twice.
            self.api("post", "roster_offer", args=[pk])
        self.assertEqual(push.call_count, 1)
        told = Notification.objects.get(recipient=self.sam)
        self.assertEqual(told.kind, Kind.ROSTER)
        self.assertIn("Cafe Verde", told.body)

        offers = self.api("get", "roster", token=self.sam_token).json()["offers"]
        self.assertEqual([o["owner"]["username"] for o in offers], ["kiran"])

        taken = self.api("post", "roster_take", args=[pk], token=self.sam_token)
        self.assertEqual(taken.status_code, 200, taken.content)
        (row,) = taken.json()["mine"]
        self.assertEqual((row["place"], row["given_by"]["username"], row["offered"]), ("Cafe Verde", "kiran", False))
        self.assertEqual(self.api("get", "roster").json()["mine"], [])
        self.assertTrue(Notification.objects.filter(recipient=self.kiran, kind=Kind.ROSTER, title__contains="took your shift").exists())

    def test_a_taken_shift_joins_the_takers_own_workplace_of_that_name(self):
        theirs = Workplace.objects.create(user=self.sam, name="cafe verde")
        pk = self.plan().json()["mine"][0]["id"]
        self.api("post", "roster_offer", args=[pk])
        self.api("post", "roster_take", args=[pk], token=self.sam_token)
        self.assertEqual(PlannedShift.objects.get(pk=pk).workplace, theirs)

    def test_it_can_only_be_taken_once_and_only_by_a_friend(self):
        pk = self.plan().json()["mine"][0]["id"]
        self.api("post", "roster_offer", args=[pk])
        alex = User.objects.create_user("alex", password="pw12345678")
        alex_token = self.client.post(reverse("api:login"), {"username": "alex", "password": "pw12345678"}).json()["token"]
        self.assertEqual(self.api("post", "roster_take", args=[pk], token=alex_token).status_code, 409)
        self.assertEqual(self.api("get", "roster", token=alex_token).json()["offers"], [])
        self.assertEqual(self.api("post", "roster_take", args=[pk]).status_code, 409)  # your own
        self.assertEqual(self.api("post", "roster_take", args=[pk], token=self.sam_token).status_code, 200)
        Friendship.befriend(self.kiran, alex)
        gone = self.api("post", "roster_take", args=[pk], token=alex_token)
        self.assertEqual(gone.status_code, 409)
        self.assertIn("already been taken", gone.json()["detail"])

    def test_taking_it_back_takes_it_off_your_friends_lists(self):
        pk = self.plan().json()["mine"][0]["id"]
        self.api("post", "roster_offer", args=[pk])
        self.assertFalse(self.api("delete", "roster_offer", args=[pk]).json()["mine"][0]["offered"])
        self.assertEqual(self.api("get", "roster", token=self.sam_token).json()["offers"], [])

    def test_a_blocked_friend_sees_no_offer(self):
        pk = self.plan().json()["mine"][0]["id"]
        self.api("post", "roster_offer", args=[pk])
        Block.block(self.kiran, self.sam)
        self.assertEqual(self.api("get", "roster", token=self.sam_token).json()["offers"], [])
        self.assertEqual(self.api("post", "roster_take", args=[pk], token=self.sam_token).status_code, 409)


class ChatTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        Friendship.befriend(self.kiran, self.sam)
        self.sam_token = self.client.post(reverse("api:login"), {"username": "sam", "password": "pw12345678"}).json()["token"]

    def say(self, body, to="sam", token=None):
        return self.api("post", "message_thread", {"body": body}, args=[to], token=token)

    def test_a_message_reaches_a_friend_and_is_read_when_they_open_it(self):
        with patch("apps.notifications.push.send_to_user") as push:
            self.assertEqual(self.say("Can you cover Saturday?").status_code, 201)
            self.say("Morning shift.")
        # One line in the inbox for the conversation, and a buzz for each message.
        self.assertEqual(push.call_count, 2)
        told = Notification.objects.get(recipient=self.sam, kind=Kind.MESSAGE)
        self.assertEqual(told.body, "Morning shift.")
        self.assertEqual(told.url, "/profile/?chat=kiran")

        inbox = self.api("get", "messages", token=self.sam_token).json()
        self.assertEqual((inbox["unread"], inbox["threads"][0]["unread"], inbox["threads"][0]["person"]["username"]), (2, 2, "kiran"))
        self.assertEqual(self.api("get", "messages_unread", token=self.sam_token).json()["unread"], 2)

        thread = self.api("get", "message_thread", args=["kiran"], token=self.sam_token).json()
        self.assertEqual([(m["body"], m["mine"]) for m in thread["messages"]], [("Can you cover Saturday?", False), ("Morning shift.", False)])
        self.assertTrue(thread["can_send"])
        self.assertEqual(self.api("get", "messages", token=self.sam_token).json()["unread"], 0)
        # Reading theirs does not mark yours.
        self.assertEqual(Message.objects.filter(read_at__isnull=False).count(), 2)

    def test_only_friends_and_only_real_words(self):
        alex = User.objects.create_user("alex", password="pw12345678")
        self.assertEqual(self.say("hello", to="alex").status_code, 400)
        self.assertEqual(self.say("   ").status_code, 400)
        self.assertEqual(self.say("x" * 2001).status_code, 400)
        self.assertEqual(self.say("kys").status_code, 400)
        self.assertEqual(self.say("hi", to="kiran").status_code, 404)
        self.assertEqual(self.say("hi", to="nobody").status_code, 404)
        self.assertFalse(Message.objects.exists())
        self.assertIsNotNone(alex)

    def test_non_text_messages_are_refused_without_crashing(self):
        for value in [42, ["hello"], {"body": "hello"}, None]:
            with self.subTest(body=value):
                self.assertEqual(self.say(value).status_code, 400)
        self.assertFalse(Message.objects.exists())

    def test_busy_threads_do_not_hide_older_conversations_or_undercount_unread(self):
        alex = User.objects.create_user("alex")
        Message.objects.create(sender=alex, recipient=self.kiran, body="Older conversation")
        Message.objects.bulk_create([Message(sender=self.sam, recipient=self.kiran, body="Hello") for _ in range(2005)])
        result = self.api("get", "messages").json()
        self.assertEqual(result["unread"], 2006)
        self.assertEqual([t["person"]["username"] for t in result["threads"]], ["sam", "alex"])
        self.assertEqual(result["threads"][0]["unread"], 2005)

    def test_a_block_ends_the_conversation_both_ways(self):
        self.say("hello")
        Block.block(self.sam, self.kiran)
        self.assertEqual(self.say("still there?").status_code, 404)
        self.assertEqual(self.api("get", "message_thread", args=["sam"]).status_code, 404)
        self.assertEqual(self.api("get", "messages").json()["threads"], [])
        self.assertEqual(self.api("get", "messages_unread", token=self.sam_token).json()["unread"], 0)

    def test_an_ended_friendship_keeps_the_history_but_takes_no_more(self):
        self.say("hello")
        Friendship.unfriend(self.kiran, self.sam)
        thread = self.api("get", "message_thread", args=["sam"]).json()
        self.assertEqual(len(thread["messages"]), 1)
        self.assertFalse(thread["can_send"])
        self.assertEqual(self.say("again").status_code, 400)

    def test_older_messages_come_a_page_at_a_time(self):
        from apps.api.views.chat import PAGE
        for n in range(PAGE + 5):
            Message.objects.create(sender=self.kiran, recipient=self.sam, body=f"line {n}")
        first = self.api("get", "message_thread", args=["sam"]).json()
        self.assertEqual((len(first["messages"]), first["more"], first["messages"][-1]["body"]), (PAGE, True, f"line {PAGE + 4}"))
        older = self.api("get", "message_thread", {"before": first["messages"][0]["id"]}, args=["sam"]).json()
        self.assertEqual(([m["body"] for m in older["messages"]], older["more"]), ([f"line {n}" for n in range(5)], False))


class PayslipCheckTests(PayslipApiTests):
    """A payslip held up against the hours logged for its fortnight."""

    def setUp(self):
        super().setUp()
        from apps.timeclock import payslip as reader
        self.slip = reader.parse(self._slip())
        self.assertIsNotNone(self.slip.hours)
        self.job = Workplace.objects.create(user=self.kiran, name="Courtlands", hourly_rate=self.slip.rate)

    def log(self, hours):
        """`hours` of finished work inside the payslip's period, in 8-hour days."""
        tz = timezone.get_current_timezone()
        day, left = self.slip.period_start, Decimal(str(hours))
        while left > 0:
            span = min(left, Decimal("8"))
            start = timezone.make_aware(datetime.combine(day, time(9)), tz)
            Shift.objects.create(user=self.kiran, workplace=self.job, clock_in=start, clock_out=start + timedelta(hours=float(span)), status=Shift.Status.COMPLETED)
            day, left = day + timedelta(days=1), left - span

    def check(self, **data):
        return self.api("post", "payslip_check", {"payslip": self._pdf(self._slip()), **data}, fmt="multipart")

    def test_the_same_hours_are_a_match(self):
        self.log(self.slip.hours)
        result = self.check().json()
        self.assertEqual(result["verdict"], "match", result)
        self.assertEqual(result["workplace"]["name"], "Courtlands")
        self.assertEqual(result["logged"]["hours"], float(self.slip.hours))

    def test_being_paid_for_fewer_hours_than_logged_is_called_short(self):
        self.log(self.slip.hours + 2)
        result = self.check().json()
        self.assertEqual(result["verdict"], "short", result)
        self.assertEqual(result["difference"]["hours"], -2.0)
        self.assertIn("2 hours unpaid", " ".join(result["lines"]))

    def test_being_paid_for_more_is_said_too(self):
        self.log(self.slip.hours - 8)
        self.assertEqual(self.check().json()["verdict"], "over")

    def test_shifts_outside_the_period_do_not_count(self):
        self.log(self.slip.hours)
        tz = timezone.get_current_timezone()
        late = timezone.make_aware(datetime.combine(self.slip.period_end + timedelta(days=1), time(9)), tz)
        Shift.objects.create(user=self.kiran, workplace=self.job, clock_in=late, clock_out=late + timedelta(hours=8), status=Shift.Status.COMPLETED)
        self.assertEqual(self.check().json()["verdict"], "match")

    def test_with_two_jobs_and_no_name_to_go_on_it_asks_which(self):
        Workplace.objects.create(user=self.kiran, name="Second Job")
        self.job.name = "Something Else"
        self.job.save()
        asked = self.check()
        self.assertEqual((asked.status_code, asked.json().get("needs")), (400, "workplace"))
        self.log(self.slip.hours)
        self.assertEqual(self.check(workplace=self.job.pk).json()["verdict"], "match")

    def test_no_file_is_said_in_words(self):
        self.assertEqual(self.api("post", "payslip_check", {}, fmt="multipart").status_code, 400)


class PaydaySummaryTests(ApiTestCase):
    """On payday, once: what the period came to."""

    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        # Yesterday's period has closed; summarize it this morning.
        self.job = Workplace.objects.create(
            user=self.kiran, name="Courtlands", hourly_rate=Decimal("30"), paid_in="CASH",
            pay_cycle=PayCycle.WEEK, week_starts_on=self.today.weekday(),
        )
        self.noon = timezone.make_aware(datetime.combine(self.today, time(12)), timezone.get_current_timezone())

    def work(self, days_ago, hours):
        start = self.noon - timedelta(days=days_ago, hours=6)
        Shift.objects.create(user=self.kiran, workplace=self.job, clock_in=start, clock_out=start + timedelta(hours=hours), status=Shift.Status.COMPLETED)

    def run_it(self, at=None):
        from apps.timeclock.notify import payday_summaries
        with patch("apps.notifications.push.send_to_user") as push:
            made = payday_summaries(at or self.noon)
        return made, push

    def test_payday_brings_one_summary_and_only_one(self):
        self.assertEqual(self.job.pay_window(self.today - timedelta(days=1))[1], self.today)
        self.work(1, 8)
        self.work(2, 6)
        self.work(8, 10)  # last week
        made, push = self.run_it()
        self.assertEqual(len(made), 1)
        told = Notification.objects.get(recipient=self.kiran)
        self.assertEqual(told.title, "Payday at Courtlands")
        self.assertIn("14h this week", told.body)
        self.assertIn("$420.00", told.body)
        self.assertIn("4h more than last week", told.body)
        self.assertEqual(push.call_count, 1)
        # The sweep comes round again, before and after it is read: still one, still quiet.
        _, again = self.run_it(self.noon + timedelta(minutes=15))
        Notification.mark_all_read(self.kiran)
        _, after = self.run_it(self.noon + timedelta(minutes=30))
        self.assertEqual((again.call_count, after.call_count, Notification.objects.count()), (0, 0, 1))

    def test_nothing_on_an_ordinary_day_an_empty_period_or_before_breakfast(self):
        self.assertEqual(self.run_it()[0], [])  # no hours
        self.work(1, 8)
        self.assertEqual(self.run_it(self.noon - timedelta(hours=7))[0], [])  # 5 am
        self.assertEqual(self.run_it(self.noon - timedelta(days=1))[0], [])  # the day before
        self.job.pay_cycle = PayCycle.IRREGULAR
        self.job.save()
        self.assertEqual(self.run_it()[0], [])
