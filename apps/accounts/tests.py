"""What the profile has to get right."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.template import Context, Template
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import LIVE_FOR, SEEN_EVERY, FriendRequest, Friendship, Profile
from apps.noticeboard.models import Notice
from apps.notifications.models import Notification

User = get_user_model()


class PresenceTests(TestCase):
    """The dot that says somebody is using MyWork right now."""

    def setUp(self):
        self.me = User.objects.create_user("me", password="pw")
        self.them = User.objects.create_user("them", password="pw")
        self.client.force_login(self.me)

    def fresh(self, user):
        """The profile as the database has it.

        Profile.of() returns the object already cached on the user, which is
        what a request wants and not what a test that has just written behind
        it wants.
        """
        return Profile.objects.get(user=user)

    def test_a_page_view_records_that_you_are_here(self):
        Profile.objects.filter(user=self.me).update(last_seen=None)
        self.client.get(reverse("notices:board"))
        self.assertIsNotNone(self.fresh(self.me).last_seen)

    def test_never_seen_is_not_live(self):
        profile = Profile.of(self.them)
        profile.last_seen = None
        self.assertFalse(profile.is_live)

    def test_seen_just_now_is_live(self):
        profile = Profile.of(self.them)
        profile.last_seen = timezone.now()
        self.assertTrue(profile.is_live)

    def test_seen_longer_ago_than_the_window_is_not(self):
        profile = Profile.of(self.them)
        profile.last_seen = timezone.now() - LIVE_FOR - timedelta(seconds=1)
        self.assertFalse(profile.is_live)

    def test_the_write_is_throttled_to_once_a_minute(self):
        profile = self.fresh(self.me)
        self.assertTrue(profile.touch())
        first = profile.last_seen

        # A second page view moments later must not write again.
        self.assertFalse(profile.touch())
        self.assertEqual(self.fresh(self.me).last_seen, first)

        # Once the throttle has passed, it does.
        Profile.objects.filter(pk=profile.pk).update(
            last_seen=timezone.now() - SEEN_EVERY - timedelta(seconds=1)
        )
        self.assertTrue(self.fresh(self.me).touch())

    def test_the_board_shows_a_dot_on_someone_who_is_here(self):
        Notice.objects.create(author=self.them, body="Hello.")
        Profile.objects.filter(user=self.them).update(last_seen=timezone.now())
        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertIn("avatar__live", html)
        self.assertIn("them is here now", html)

    def test_and_none_on_someone_who_has_gone(self):
        Notice.objects.create(author=self.them, body="Hello.")
        Profile.objects.filter(user=self.them).update(
            last_seen=timezone.now() - LIVE_FOR - timedelta(minutes=1)
        )
        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertNotIn("avatar__live", html)

    def test_your_own_compose_box_does_not_tell_you_that_you_are_here(self):
        # The reply box's avatar is drawn with me=True. You know you are here.
        Profile.objects.filter(user=self.me).update(last_seen=timezone.now())
        rendered = Template(
            '{% load avatars %}{% avatar user me=True %}'
        ).render(Context({"user": self.me}))
        self.assertNotIn("avatar__live", rendered)

    def test_signing_out_leaves_presence_alone_rather_than_erroring(self):
        self.client.logout()
        self.assertEqual(self.client.get(reverse("login")).status_code, 200)


class FriendshipTests(TestCase):
    """Who your "Friends only" posts reach, and how they get there."""

    def setUp(self):
        self.me = User.objects.create_user("me", password="pw")
        self.them = User.objects.create_user("them", password="pw")
        self.stranger = User.objects.create_user("stranger", password="pw")
        self.client.force_login(self.me)

    def test_sending_a_request_creates_one_pending_row(self):
        self.client.post(reverse("accounts:friend_request_send", args=["them"]))
        self.assertTrue(
            FriendRequest.objects.filter(from_user=self.me, to_user=self.them).exists()
        )
        self.assertFalse(Friendship.are_friends(self.me, self.them))

    def test_sending_it_twice_does_not_duplicate(self):
        self.client.post(reverse("accounts:friend_request_send", args=["them"]))
        self.client.post(reverse("accounts:friend_request_send", args=["them"]))
        self.assertEqual(
            FriendRequest.objects.filter(from_user=self.me, to_user=self.them).count(), 1
        )

    def test_you_cannot_friend_request_yourself(self):
        self.client.post(reverse("accounts:friend_request_send", args=["me"]))
        self.assertFalse(FriendRequest.objects.exists())

    def test_accepting_makes_both_sides_friends(self):
        req = FriendRequest.objects.create(from_user=self.them, to_user=self.me)
        self.client.post(reverse("accounts:friend_request_accept", args=[req.pk]))

        self.assertTrue(Friendship.are_friends(self.me, self.them))
        self.assertTrue(Friendship.are_friends(self.them, self.me))
        self.assertFalse(FriendRequest.objects.exists())

    def test_only_the_recipient_can_accept(self):
        req = FriendRequest.objects.create(from_user=self.them, to_user=self.stranger)
        response = self.client.post(reverse("accounts:friend_request_accept", args=[req.pk]))
        self.assertEqual(response.status_code, 404)
        self.assertFalse(Friendship.are_friends(self.them, self.stranger))

    def test_declining_just_removes_the_request(self):
        req = FriendRequest.objects.create(from_user=self.them, to_user=self.me)
        self.client.post(reverse("accounts:friend_request_decline", args=[req.pk]))
        self.assertFalse(FriendRequest.objects.exists())
        self.assertFalse(Friendship.are_friends(self.me, self.them))

    def test_the_sender_can_cancel_their_own_request(self):
        req = FriendRequest.objects.create(from_user=self.me, to_user=self.them)
        response = self.client.post(reverse("accounts:friend_request_decline", args=[req.pk]))
        self.assertEqual(response.status_code, 302)
        self.assertFalse(FriendRequest.objects.exists())

    def test_a_crossed_pair_of_requests_settles_into_one_friendship(self):
        """Both people happen to ask each other before either answers."""
        FriendRequest.objects.create(from_user=self.them, to_user=self.me)
        self.client.post(reverse("accounts:friend_request_send", args=["them"]))

        self.assertTrue(Friendship.are_friends(self.me, self.them))
        self.assertFalse(FriendRequest.objects.exists())

    def test_removing_a_friend_removes_both_sides(self):
        Friendship.befriend(self.me, self.them)
        self.client.post(reverse("accounts:friend_remove", args=["them"]))
        self.assertFalse(Friendship.are_friends(self.me, self.them))
        self.assertFalse(Friendship.are_friends(self.them, self.me))

    def test_ids_for_is_empty_for_a_signed_out_user(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(Friendship.ids_for(AnonymousUser()), set())
        self.assertEqual(Friendship.ids_for(None), set())

    def test_a_request_notifies_the_recipient(self):
        self.client.post(reverse("accounts:friend_request_send", args=["them"]))
        self.assertTrue(
            Notification.objects.filter(recipient=self.them, kind="friend_request").exists()
        )

    def test_accepting_notifies_the_original_sender(self):
        req = FriendRequest.objects.create(from_user=self.them, to_user=self.me)
        self.client.post(reverse("accounts:friend_request_accept", args=[req.pk]))
        self.assertTrue(
            Notification.objects.filter(recipient=self.them, kind="friend_accepted").exists()
        )

    def test_the_friends_section_is_on_the_profile_page(self):
        Friendship.befriend(self.me, self.them)
        FriendRequest.objects.create(from_user=self.stranger, to_user=self.me)
        fourth = User.objects.create_user("fourth", password="pw")

        html = self.client.get(reverse("accounts:profile")).content.decode()
        self.assertIn('id="friends"', html)
        self.assertIn("them", html)
        self.assertIn("stranger", html)
        self.assertIn("fourth", html)

    def test_the_old_friends_address_still_gets_you_there(self):
        resp = self.client.get(reverse("accounts:friends"))
        self.assertRedirects(resp, reverse("accounts:profile") + "#friends", fetch_redirect_response=False)

    def test_actions_land_back_on_the_profile_page(self):
        resp = self.client.post(reverse("accounts:friend_request_send", args=["them"]))
        self.assertRedirects(resp, reverse("accounts:profile") + "#friends")


class AccountDeletionTests(TestCase):
    """The way out for good, and the page the stores ask for."""

    def setUp(self):
        self.me = User.objects.create_user("me", password="pw12345678")
        self.client.force_login(self.me)

    def test_the_privacy_page_is_public(self):
        self.client.logout()
        resp = self.client.get(reverse("privacy"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Deleting your account")

    def test_the_wrong_password_deletes_nothing(self):
        resp = self.client.post(reverse("accounts:delete"), {"password": "wrong"})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(User.objects.filter(username="me").exists())

    def test_the_right_password_deletes_everything_and_signs_out(self):
        resp = self.client.post(reverse("accounts:delete"), {"password": "pw12345678"})
        self.assertRedirects(resp, reverse("login"), fetch_redirect_response=False)
        self.assertFalse(User.objects.filter(username="me").exists())
        self.assertFalse(Profile.objects.filter(user__username="me").exists())
        self.assertEqual(self.client.get(reverse("accounts:profile")).status_code, 302)
