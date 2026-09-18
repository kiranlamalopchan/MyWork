"""
Blocking and reporting, on the site and through the API: what disappears,
what is refused, and what a report does.
"""

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import FriendRequest, Friendship
from apps.noticeboard.models import Comment, Notice, Visibility
from apps.notifications.models import Notification
from apps.stories.models import Story

from .filter import objectionable
from .models import AUTO_HIDE_AT, Block, Kind, Reason, Report


def _story(author):
    return Story.objects.create(author=author, expires_at=timezone.now() + timezone.timedelta(hours=1))


class BlockTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw12345678")
        self.sam = User.objects.create_user("sam", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")

    def test_blocking_hides_their_notices_and_comments_both_ways(self):
        theirs = Notice.objects.create(author=self.sam, body="From Sam")
        mine = Notice.objects.create(author=self.kiran, body="From Kiran")
        Comment.objects.create(notice=mine, author=self.sam, body="Sam replying")
        Block.block(self.kiran, self.sam)

        self.assertNotIn(theirs, Notice.visible(self.kiran))
        self.assertNotIn(mine, Notice.visible(self.sam))
        self.assertIn(mine, Notice.visible(self.kiran))
        self.assertEqual(mine.thread(self.kiran), [])

    def test_blocking_ends_the_friendship_and_the_requests(self):
        Friendship.befriend(self.kiran, self.sam)
        FriendRequest.objects.create(from_user=self.sam, to_user=self.kiran)
        Block.block(self.kiran, self.sam)
        self.assertFalse(Friendship.are_friends(self.kiran, self.sam))
        self.assertFalse(FriendRequest.objects.exists())

    def test_a_blocked_pair_cannot_ask_to_be_friends(self):
        Block.block(self.kiran, self.sam)
        self.client.post(reverse("accounts:friend_request_send", args=["sam"]))
        self.assertFalse(FriendRequest.objects.exists())
        # And not from the other side either.
        self.client.logout()
        self.client.login(username="sam", password="pw12345678")
        self.client.post(reverse("accounts:friend_request_send", args=["kiran"]))
        self.assertFalse(FriendRequest.objects.exists())

    def test_blocking_hides_stories_both_ways(self):
        theirs = _story(self.sam)
        mine = _story(self.kiran)
        Block.block(self.kiran, self.sam)
        self.assertNotIn(theirs, Story.objects.for_viewer(self.kiran))
        self.assertNotIn(mine, Story.objects.for_viewer(self.sam))
        self.assertIn(mine, Story.objects.for_viewer(self.kiran))

    def test_no_notifications_across_a_block(self):
        from apps.noticeboard import notify
        Block.block(self.kiran, self.sam)
        notice = Notice.objects.create(author=self.sam, body="Hello board")
        notify.notice_posted(notice)
        self.assertFalse(Notification.objects.filter(recipient=self.kiran).exists())

    def test_the_person_page_when_blocked(self):
        Block.block(self.kiran, self.sam)
        resp = self.client.get(reverse("notices:person", args=["sam"]))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Unblock")
        # Sam cannot find Kiran's page at all.
        self.client.logout()
        self.client.login(username="sam", password="pw12345678")
        resp = self.client.get(reverse("notices:person", args=["kiran"]))
        self.assertEqual(resp.status_code, 404)

    def test_block_and_unblock_on_the_site(self):
        self.client.post(reverse("moderation:block", args=["sam"]))
        self.assertTrue(Block.is_blocking(self.kiran, self.sam))
        resp = self.client.get(reverse("moderation:blocked"))
        self.assertContains(resp, "sam")
        self.client.post(reverse("moderation:unblock", args=["sam"]))
        self.assertFalse(Block.is_blocking(self.kiran, self.sam))

    def test_you_cannot_block_yourself(self):
        self.client.post(reverse("moderation:block", args=["kiran"]))
        self.assertFalse(Block.objects.exists())

    def test_ids_for_is_remembered_and_forgotten(self):
        self.assertEqual(Block.ids_for(self.kiran), set())
        Block.block(self.kiran, self.sam)
        self.assertEqual(Block.ids_for(self.kiran), {self.sam.pk})
        self.assertEqual(Block.ids_for(self.sam), {self.kiran.pk})
        Block.unblock(self.kiran, self.sam)
        self.assertEqual(Block.ids_for(self.kiran), set())


class ReportTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw12345678")
        self.sam = User.objects.create_user("sam", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")

    def test_reporting_a_notice_records_it(self):
        notice = Notice.objects.create(author=self.sam, body="Something rude")
        resp = self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": "harassment", "note": "see this"})
        self.assertEqual(resp.status_code, 302)
        report = Report.objects.get()
        self.assertEqual(report.accused, self.sam)
        self.assertEqual(report.reason, Reason.HARASSMENT)
        self.assertEqual(report.excerpt, "Something rude")
        self.assertTrue(report.is_open)

    def test_reporting_twice_counts_once(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        for reason in ("spam", "hate"):
            self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": reason})
        self.assertEqual(Report.objects.count(), 1)
        self.assertEqual(Report.objects.get().reason, Reason.HATE)

    def test_enough_reports_hide_the_thing(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        for i in range(AUTO_HIDE_AT):
            who = User.objects.create_user(f"p{i}", password="pw12345678")
            Report.file(who, Kind.NOTICE, notice, Reason.SPAM)
        notice.refresh_from_db()
        self.assertTrue(notice.hidden)
        self.assertNotIn(notice, Notice.visible(self.kiran))
        # Its author still sees it.
        self.assertIn(notice, Notice.visible(self.sam))

    def test_hidden_comments_and_stories_are_hidden(self):
        notice = Notice.objects.create(author=self.kiran, body="mine")
        comment = Comment.objects.create(notice=notice, author=self.sam, body="theirs", hidden=True)
        self.assertFalse(comment.visible_to(self.kiran))
        story = _story(self.sam)
        story.hidden = True
        story.save()
        self.assertNotIn(story, Story.objects.for_viewer(self.kiran))

    def test_you_cannot_report_your_own(self):
        notice = Notice.objects.create(author=self.kiran, body="mine")
        self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": "spam"})
        self.assertFalse(Report.objects.exists())

    def test_the_report_form_shows_the_thing(self):
        notice = Notice.objects.create(author=self.sam, body="Quoted words")
        resp = self.client.get(reverse("moderation:report"), {"kind": "notice", "id": notice.pk})
        self.assertContains(resp, "Quoted words")
        self.assertContains(resp, "Block sam")

    @override_settings(CONTACT_EMAIL="owner@example.com", EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_a_report_emails_the_site(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        Report.file(self.kiran, Kind.NOTICE, notice, Reason.SPAM)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Report", mail.outbox[0].subject)

    def test_the_rules_page_is_public(self):
        self.client.logout()
        resp = self.client.get(reverse("moderation:rules"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "no tolerance")


class FilterTests(TestCase):
    def test_slurs_and_threats_are_caught_whole_word_only(self):
        self.assertTrue(objectionable("you absolute cunt"))
        self.assertTrue(objectionable("KYS"))
        self.assertTrue(objectionable("I will kill you tomorrow"))
        self.assertFalse(objectionable("the class starts at nine"))
        self.assertFalse(objectionable("scunthorpe united"))
        self.assertFalse(objectionable(""))

    def test_a_refused_notice_is_not_posted(self):
        kiran = User.objects.create_user("kiran", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")
        resp = self.client.post(reverse("notices:create"), {"body": "kys", "visibility": Visibility.PUBLIC})
        self.assertFalse(Notice.objects.exists())
        self.assertNotEqual(resp.status_code, 500)

    @override_settings(OBJECTIONABLE_WORDS=("bananas",))
    def test_the_list_can_be_extended(self):
        self.assertTrue(objectionable("this is bananas"))
