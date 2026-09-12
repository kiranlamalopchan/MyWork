"""
The mailbox, and the two promises it makes.

The first is that a notification is a record: it exists whether or not
anything reached a phone, so every test here runs with push unconfigured —
which is also how a laptop runs — and still expects the rows to be there.

The second is that it does not repeat itself. Most of what follows is about
that: your own doing is not news, a reaction toggled six times is one line,
and a reminder that runs every twenty minutes buzzes once.
"""

import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.noticeboard.models import Comment, CommentReaction, Notice, Reaction

from .models import Kind, Notification, PushSubscription
from .notify import notify


class MailboxTests(TestCase):
    """`Notification` itself: what it records and what it refuses to."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")

    def test_nobody_is_notified_about_their_own_doing(self):
        made = notify(
            self.kiran, Kind.NOTICE, "kiran posted a notice",
            url="/notices/", actor=self.kiran,
        )
        self.assertIsNone(made)
        self.assertEqual(Notification.objects.count(), 0)

    def test_a_repeat_rewrites_the_unread_line_rather_than_adding_one(self):
        first = notify(
            self.kiran, Kind.REACTION, "sam reacted to your notice",
            url="/notices/", actor=self.sam, emoji="👍", dedupe_key="r:1",
        )
        second = notify(
            self.kiran, Kind.REACTION, "sam reacted to your notice",
            url="/notices/", actor=self.sam, emoji="❤️", dedupe_key="r:1",
        )

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.get().emoji, "❤️")

    def test_once_read_the_next_one_is_new_again(self):
        notify(self.kiran, Kind.REACTION, "sam reacted", url="/notices/",
               actor=self.sam, emoji="👍", dedupe_key="r:1")
        Notification.mark_all_read(self.kiran)

        notify(self.kiran, Kind.REACTION, "sam reacted", url="/notices/",
               actor=self.sam, emoji="👍", dedupe_key="r:1")

        self.assertEqual(Notification.objects.count(), 2)
        self.assertEqual(Notification.unread_count(self.kiran), 1)

    def test_the_bell_counts_only_your_own_unread(self):
        notify(self.kiran, Kind.NOTICE, "one", url="/notices/", actor=self.sam)
        notify(self.sam, Kind.NOTICE, "two", url="/notices/", actor=self.kiran)

        self.assertEqual(Notification.unread_count(self.kiran), 1)
        self.assertEqual(Notification.unread_count(self.sam), 1)

        Notification.mark_all_read(self.kiran)
        self.assertEqual(Notification.unread_count(self.kiran), 0)
        self.assertEqual(Notification.unread_count(self.sam), 1)

    def test_the_mailbox_does_not_grow_without_end(self):
        for n in range(120):
            notify(self.kiran, Kind.NOTICE, f"notice {n}", url="/notices/",
                   actor=self.sam)

        kept = Notification.objects.filter(recipient=self.kiran).count()
        self.assertLessEqual(kept, 100)
        # And it is the newest that stayed.
        self.assertTrue(
            Notification.objects.filter(recipient=self.kiran, title="notice 119").exists()
        )


class BoardEventTests(TestCase):
    """What the board raises, driven through the views that raise it."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.jo = User.objects.create_user("jo", password="pw")
        self.client.force_login(self.kiran)

    def test_a_notice_reaches_everybody_but_its_author(self):
        self.client.post(reverse("notices:create"), {"body": "Fridge is fixed."})

        self.assertEqual(Notification.unread_count(self.sam), 1)
        self.assertEqual(Notification.unread_count(self.jo), 1)
        self.assertEqual(Notification.unread_count(self.kiran), 0)

        told = Notification.objects.filter(recipient=self.sam).get()
        self.assertEqual(told.kind, Kind.NOTICE)
        self.assertIn("kiran", told.title)
        self.assertIn("Fridge is fixed.", told.body)

    def test_a_comment_reaches_the_notice_author(self):
        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")

        self.client.post(reverse("notices:comment", args=[notice.pk]),
                         {"body": "Thanks!"})

        told = Notification.objects.filter(recipient=self.sam).get()
        self.assertEqual(told.kind, Kind.COMMENT)
        self.assertIn(f"comment-{Comment.objects.get().pk}", told.url)
        # The commenter hears nothing about their own comment.
        self.assertEqual(Notification.unread_count(self.kiran), 0)

    def test_a_reply_reaches_both_people_once_each(self):
        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        parent = Comment.objects.create(notice=notice, author=self.jo, body="When?")

        self.client.post(
            reverse("notices:comment", args=[notice.pk]),
            {"body": "This morning.", "parent": parent.pk},
        )

        self.assertEqual(Notification.objects.filter(recipient=self.jo).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)
        self.assertEqual(
            Notification.objects.filter(recipient=self.jo).get().kind, Kind.REPLY
        )

    def test_a_reply_to_your_own_notice_tells_you_once(self):
        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        parent = Comment.objects.create(notice=notice, author=self.sam, body="Anyone?")

        self.client.post(
            reverse("notices:comment", args=[notice.pk]),
            {"body": "Me.", "parent": parent.pk},
        )

        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)

    def test_a_reaction_tells_the_author_and_taking_it_back_does_not(self):
        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        react = reverse("notices:react", args=[notice.pk])

        self.client.post(react, {"emoji": Reaction.Emoji.LIKE})
        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)

        # The same face again is the reaction being taken back.
        self.client.post(react, {"emoji": Reaction.Emoji.LIKE})
        self.assertEqual(Notification.objects.filter(recipient=self.sam).count(), 1)
        self.assertEqual(Reaction.objects.count(), 0)

    def test_changing_your_mind_does_not_notify_twice(self):
        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        react = reverse("notices:react", args=[notice.pk])

        self.client.post(react, {"emoji": Reaction.Emoji.LIKE})
        self.client.post(react, {"emoji": Reaction.Emoji.LOVE})
        self.client.post(react, {"emoji": Reaction.Emoji.HAHA})

        told = Notification.objects.filter(recipient=self.sam).get()
        self.assertEqual(told.emoji, Reaction.Emoji.HAHA)

    def test_a_reaction_on_a_comment_tells_the_commenter(self):
        notice = Notice.objects.create(author=self.jo, body="Fridge is fixed.")
        comment = Comment.objects.create(notice=notice, author=self.sam, body="Good.")

        self.client.post(reverse("notices:comment_react", args=[comment.pk]),
                         {"emoji": CommentReaction.Emoji.LIKE})

        told = Notification.objects.filter(recipient=self.sam).get()
        self.assertEqual(told.kind, Kind.REACTION)
        # And the notice's author, who wrote neither, hears nothing.
        self.assertEqual(Notification.unread_count(self.jo), 0)


class InboxTests(TestCase):
    """The pages: the bell, the list, and following one out of it."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.kiran)

    def test_the_bell_in_the_app_bar_shows_a_count_on_every_page(self):
        notify(self.kiran, Kind.NOTICE, "sam posted a notice", url="/notices/",
               actor=self.sam)

        resp = self.client.get(reverse("home"))
        self.assertContains(resp, 'class="appbar__bell"')
        self.assertContains(resp, 'class="tab__badge"')
        self.assertEqual(resp.context["unread_notifications"], 1)

    def test_opening_the_inbox_shows_what_was_unread_and_then_clears_it(self):
        notify(self.kiran, Kind.NOTICE, "sam posted a notice", url="/notices/",
               actor=self.sam)

        resp = self.client.get(reverse("notifications:inbox"))
        self.assertContains(resp, "sam posted a notice")
        self.assertContains(resp, "note--unread")

        self.assertEqual(Notification.unread_count(self.kiran), 0)
        self.assertNotContains(
            self.client.get(reverse("notifications:inbox")), "note--unread"
        )

    def test_following_one_marks_it_read_and_goes_where_it_points(self):
        told = notify(self.kiran, Kind.COMMENT, "sam replied to you",
                      url="/notices/#notice-1", actor=self.sam)

        resp = self.client.get(reverse("notifications:go", args=[told.pk]))
        self.assertRedirects(resp, "/notices/#notice-1", fetch_redirect_response=False)

        told.refresh_from_db()
        self.assertIsNotNone(told.read_at)

    def test_somebody_elses_notification_is_not_yours_to_follow(self):
        theirs = notify(self.sam, Kind.NOTICE, "kiran posted", url="/notices/",
                        actor=self.kiran)

        resp = self.client.get(reverse("notifications:go", args=[theirs.pk]))
        self.assertRedirects(resp, reverse("home"), fetch_redirect_response=False)

        theirs.refresh_from_db()
        self.assertIsNone(theirs.read_at)

    def test_a_reminder_has_no_face_and_still_renders(self):
        """
        Nothing raised the timesheet reminders, so there is no avatar to draw.
        The row wears the app's own mark instead — a path no notification with
        an actor ever takes.
        """
        notify(self.kiran, Kind.TIMESHEET, "You're still clocked in",
               body="12h at Courtlands.", url="/timesheet/")

        resp = self.client.get(reverse("notifications:inbox"))
        self.assertContains(resp, "You&#x27;re still clocked in")
        self.assertContains(resp, "note__mark")

    def test_the_inbox_needs_a_login(self):
        self.client.logout()
        resp = self.client.get(reverse("notifications:inbox"))
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login/", resp["Location"])

    def test_the_service_worker_is_served_from_the_root(self):
        resp = self.client.get("/sw.js")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("javascript", resp["Content-Type"])
        # A worker below /static/ could not control the board.
        self.assertIn(b"notificationclick", resp.content)


class SubscriptionTests(TestCase):
    """The two endpoints the browser talks to."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.kiran)
        self.body = {
            "endpoint": "https://push.example.com/abc",
            "keys": {"p256dh": "key", "auth": "secret"},
        }

    def _post(self, name, body):
        return self.client.post(
            reverse(f"notifications:{name}"),
            data=json.dumps(body),
            content_type="application/json",
        )

    def test_subscribing_stores_the_device(self):
        resp = self._post("subscribe", self.body)
        self.assertEqual(resp.status_code, 200)

        stored = PushSubscription.objects.get()
        self.assertEqual(stored.user, self.kiran)
        self.assertEqual(stored.endpoint, "https://push.example.com/abc")

    def test_subscribing_twice_keeps_one_row(self):
        self._post("subscribe", self.body)
        self._post("subscribe", self.body)
        self.assertEqual(PushSubscription.objects.count(), 1)

    def test_a_shared_phone_moves_to_whoever_is_signed_in(self):
        self._post("subscribe", self.body)

        self.client.force_login(self.sam)
        self._post("subscribe", self.body)

        self.assertEqual(PushSubscription.objects.count(), 1)
        self.assertEqual(PushSubscription.objects.get().user, self.sam)

    def test_unsubscribing_forgets_only_your_own(self):
        self._post("subscribe", self.body)
        PushSubscription.objects.create(
            user=self.sam, endpoint="https://push.example.com/other",
            p256dh="k", auth="a",
        )

        self._post("unsubscribe", {"endpoint": "https://push.example.com/other"})
        self._post("unsubscribe", {"endpoint": "https://push.example.com/abc"})

        left = PushSubscription.objects.get()
        self.assertEqual(left.user, self.sam)

    def test_a_half_built_subscription_is_a_bad_request(self):
        resp = self._post("subscribe", {"endpoint": "https://push.example.com/abc"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_subscribing_needs_a_login(self):
        self.client.logout()
        resp = self._post("subscribe", self.body)
        self.assertEqual(resp.status_code, 302)


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
class PushOffTests(TestCase):
    """
    A deployment with no keys is a working deployment.

    This is the state a laptop runs in and the state the site starts in, so
    it is worth a test of its own: the record is still written, the bell still
    counts it, and nothing anywhere raises.
    """

    def test_notifications_are_recorded_with_push_switched_off(self):
        kiran = User.objects.create_user("kiran", password="pw")
        sam = User.objects.create_user("sam", password="pw")

        told = notify(kiran, Kind.NOTICE, "sam posted a notice", url="/notices/",
                      actor=sam)

        self.assertIsNotNone(told)
        self.assertEqual(Notification.unread_count(kiran), 1)

    def test_the_page_offers_no_switch_it_cannot_honour(self):
        User.objects.create_user("kiran", password="pw")
        self.client.login(username="kiran", password="pw")

        resp = self.client.get(reverse("notifications:inbox"))
        self.assertFalse(resp.context["push_available"])
        self.assertNotContains(resp, 'id="push-setup"')


class SweepTests(TestCase):
    """
    The claim that stands in for a cron.

    What matters is not that it runs, but that it runs *once*: several workers
    answer requests at the same moment, and a sweep that two of them both
    started would notify everybody twice.
    """

    def setUp(self):
        from .models import Sweep

        self.Sweep = Sweep

    def test_the_first_request_after_a_deployment_claims_it(self):
        self.assertTrue(self.Sweep.claim("job", timedelta(minutes=15)))

    def test_the_next_request_does_not(self):
        self.Sweep.claim("job", timedelta(minutes=15))

        self.assertFalse(self.Sweep.claim("job", timedelta(minutes=15)))
        self.assertFalse(self.Sweep.claim("job", timedelta(minutes=15)))

    def test_it_comes_due_again_after_the_interval(self):
        self.Sweep.claim("job", timedelta(minutes=15))

        # Wind the clock back rather than waiting fifteen minutes for a test.
        self.Sweep.objects.filter(name="job").update(
            ran_at=timezone.now() - timedelta(minutes=16)
        )

        self.assertTrue(self.Sweep.claim("job", timedelta(minutes=15)))

    def test_two_jobs_do_not_claim_each_other(self):
        self.assertTrue(self.Sweep.claim("one", timedelta(minutes=15)))
        self.assertTrue(self.Sweep.claim("two", timedelta(minutes=15)))


class InboxLookTests(TestCase):
    """
    The inbox's rendering: one row per kind, grouped by the reader's day.

    A template with five shapes in it is a template where one shape can break
    without the others noticing, so each kind is rendered here rather than
    trusting the one that happens to be easiest to make.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.kiran)

    def _inbox(self):
        return self.client.get(reverse("notifications:inbox")).content.decode()

    def test_every_kind_renders(self):
        from .models import KIND_ICONS

        for kind in Kind.values:
            Notification.objects.create(
                recipient=self.kiran,
                actor=None if kind == Kind.TIMESHEET else self.sam,
                kind=kind,
                title=f"a {kind} happened",
                body="something worth reading",
                url="/notices/",
                emoji="❤️" if kind == Kind.REACTION else "",
            )

        html = self._inbox()
        for kind in Kind.values:
            self.assertIn(f"a {kind} happened", html)
        # The reaction wears the face somebody left — drawn, the same picture
        # the board draws for it, not the glyph the phone happens to have.
        self.assertIn("note__kind--emoji", html)
        self.assertIn("rx--love", html)
        # And every other kind wears its own glyph.
        self.assertTrue(KIND_ICONS[Kind.REPLY])

    def test_a_person_colours_their_own_notification(self):
        from apps.accounts.avatars import hue_for

        notify(self.kiran, Kind.NOTICE, "sam posted a notice", url="/notices/",
               actor=self.sam)

        html = self._inbox()
        self.assertIn("note--from", html)
        self.assertIn(f"--hue: {hue_for('sam')}", html)

    def test_what_the_app_raises_wears_no_borrowed_colour(self):
        notify(self.kiran, Kind.TIMESHEET, "You're still clocked in",
               url="/timesheet/", body="12h at Courtlands.")

        html = self._inbox()
        self.assertIn("note--app", html)
        self.assertIn("note__mark", html)
        # No borrowed colour on the row itself — the app bar's own avatar
        # carries a hue, so this has to be looked for where it would matter.
        row = html[html.index('<li class="note'):html.index("</li>")]
        self.assertNotIn("--hue:", row)
        # And no second copy of the glyph it already wears as a face.
        self.assertNotIn("note__kind", row)

    def test_rows_are_grouped_under_the_day_they_arrived(self):
        fresh = notify(self.kiran, Kind.NOTICE, "today's news", url="/notices/",
                       actor=self.sam)
        old = notify(self.kiran, Kind.NOTICE, "old news", url="/notices/",
                     actor=self.sam)
        Notification.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=1)
        )

        html = self._inbox()
        self.assertIn("Today", html)
        self.assertIn("Yesterday", html)
        # Today's group comes first, because newest is what you came for.
        self.assertLess(html.index("Today"), html.index("Yesterday"))
        self.assertLess(html.index("today&#x27;s news"), html.index("old news"))
        self.assertTrue(fresh.pk)

    def test_read_and_unread_look_different(self):
        notify(self.kiran, Kind.NOTICE, "sam posted a notice", url="/notices/",
               actor=self.sam)

        first = self._inbox()
        self.assertIn("note--unread", first)
        self.assertIn("note__dot", first)

        # Opening it was the reading of it; the next visit is quiet.
        second = self._inbox()
        self.assertNotIn("note--unread", second)
        self.assertIn("note__chev", second)


class TestNotificationCommandTests(TestCase):
    """
    The command that fills an inbox so there is something to look at, and
    takes it away again afterwards.
    """

    def setUp(self):
        self.wayne = User.objects.create_user("wayne", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")

    def _run(self, *args):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("test_notification", *args, stdout=out)
        return out.getvalue()

    def test_it_notifies_one_person(self):
        out = self._run("wayne")

        self.assertEqual(Notification.objects.filter(recipient=self.wayne).count(), 1)
        self.assertIn("Recorded", out)

    def test_an_unknown_name_says_who_there_is(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError) as caught:
            self._run("nobody")
        self.assertIn("wayne", str(caught.exception))

    def test_demo_fills_the_inbox_with_every_kind(self):
        self._run("wayne", "--demo")

        made = Notification.objects.filter(recipient=self.wayne)
        self.assertEqual(made.count(), 5)
        self.assertEqual(set(made.values_list("kind", flat=True)), set(Kind.values))
        # Spread over more than one day, so the grouping has something to group.
        days = {timezone.localtime(n.created_at).date() for n in made}
        self.assertEqual(len(days), 2)

    def test_demo_borrows_other_people_for_their_colour(self):
        self._run("wayne", "--demo")

        actors = set(
            Notification.objects.filter(recipient=self.wayne)
            .exclude(actor=None)
            .values_list("actor__username", flat=True)
        )
        self.assertEqual(actors, {"sam"})

    def test_clear_removes_its_own_and_nothing_else(self):
        real = notify(self.wayne, Kind.NOTICE, "a real one", url="/notices/",
                      actor=self.sam)
        self._run("wayne", "--demo")
        self.assertEqual(Notification.objects.filter(recipient=self.wayne).count(), 6)

        self._run("wayne", "--clear")

        left = Notification.objects.filter(recipient=self.wayne)
        self.assertEqual(left.count(), 1)
        self.assertEqual(left.get().pk, real.pk)

    def test_it_says_when_push_cannot_reach_anybody(self):
        out = self._run("wayne")
        self.assertIn("no VAPID keys", out)

    def test_the_demo_inbox_renders(self):
        self._run("wayne", "--demo")
        self.client.force_login(self.wayne)

        resp = self.client.get(reverse("notifications:inbox"))

        self.assertContains(resp, "note--from")
        self.assertContains(resp, "note--app")
        self.assertContains(resp, "Today")
        self.assertContains(resp, "Yesterday")


class PushSetupHintTests(TestCase):
    """
    What the page says when the server has no keys.

    Nothing, to almost everybody: there is no decision to make until push can
    work. But the person who has to make it work should not be left looking
    at a page with the feature silently missing from it.
    """

    def setUp(self):
        self.wayne = User.objects.create_user("wayne", password="pw")
        self.boss = User.objects.create_user("boss", password="pw", is_staff=True)

    @override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
    def test_staff_are_told_the_keys_are_missing(self):
        self.client.force_login(self.boss)
        resp = self.client.get(reverse("notifications:inbox"))

        self.assertContains(resp, "Push isn't set up yet")
        self.assertContains(resp, "vapid_keys")

    @override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
    def test_everybody_else_sees_nothing_about_it(self):
        self.client.force_login(self.wayne)
        resp = self.client.get(reverse("notifications:inbox"))

        self.assertNotContains(resp, "Push isn't set up yet")
        self.assertNotContains(resp, "push-setup")

    @override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv")
    def test_once_the_keys_are_there_the_switch_replaces_the_note(self):
        self.client.force_login(self.boss)
        resp = self.client.get(reverse("notifications:inbox"))

        self.assertNotContains(resp, "Push isn't set up yet")
        self.assertContains(resp, 'id="push-toggle"')
