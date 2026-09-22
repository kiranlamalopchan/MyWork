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
    """The dot that says somebody is using KaamKoRecord right now."""

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


class UsernameChangeTests(TestCase):
    """The name you sign in by can be changed — to one nobody else has."""

    def setUp(self):
        self.me = User.objects.create_user("me", password="pw12345678")
        User.objects.create_user("taken", password="pw12345678")
        self.client.force_login(self.me)
        self.url = reverse("accounts:edit")

    def post(self, username):
        return self.client.post(self.url, {"username": username, "display_name": "", "email": "", "phone": "", "address": ""})

    def test_the_username_is_on_the_edit_page_and_can_be_changed(self):
        resp = self.client.get(self.url)
        self.assertContains(resp, 'name="username"')
        self.assertContains(resp, 'value="me"')
        resp = self.post("  newme ")
        self.assertEqual(resp.status_code, 302, resp.content)
        self.me.refresh_from_db()
        self.assertEqual(self.me.get_username(), "newme")
        # Still signed in as the same account afterwards.
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_a_taken_username_is_refused_whatever_its_case(self):
        for attempt in ("taken", "Taken", "TAKEN"):
            resp = self.post(attempt)
            self.assertEqual(resp.status_code, 200)
            self.assertContains(resp, "That username is taken.")
        self.me.refresh_from_db()
        self.assertEqual(self.me.get_username(), "me")

    def test_keeping_your_own_name_is_not_a_clash(self):
        self.assertEqual(self.post("me").status_code, 302)
        self.assertEqual(self.post("ME").status_code, 302)
        self.me.refresh_from_db()
        self.assertEqual(self.me.get_username(), "ME")

    def test_the_sign_up_rules_still_apply(self):
        for bad in ("", "has space", "no!bang"):
            resp = self.post(bad)
            self.assertEqual(resp.status_code, 200, bad)
        self.me.refresh_from_db()
        self.assertEqual(self.me.get_username(), "me")


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


class PasswordChangeTests(TestCase):
    """Changing the password you still know, from the site."""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="old-password-77")
        self.client.force_login(self.user)
        self.url = reverse("accounts:password")

    def _change(self, old="old-password-77", new="quokka-brunch-91"):
        return self.client.post(self.url, {
            "old_password": old, "new_password1": new, "new_password2": new,
        })

    def test_the_new_password_works_and_the_old_one_stops(self):
        self.assertRedirects(self._change(), reverse("accounts:profile"))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("quokka-brunch-91"))
        self.assertFalse(self.user.check_password("old-password-77"))

    def test_the_browser_that_changed_it_stays_signed_in(self):
        """
        What `update_session_auth_hash` is for. Changing a password rotates
        the hash sessions are checked against, so without it the very page
        that succeeded would bounce to the login screen.
        """
        self._change()
        self.assertEqual(self.client.get(reverse("accounts:profile")).status_code, 200)

    def test_the_wrong_current_password_changes_nothing(self):
        response = self._change(old="not-the-one")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-77"))

    def test_two_different_new_passwords_change_nothing(self):
        response = self.client.post(self.url, {
            "old_password": "old-password-77",
            "new_password1": "quokka-brunch-91",
            "new_password2": "quokka-brunch-92",
        })
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-77"))

    def test_a_password_the_validators_refuse_is_refused(self):
        response = self._change(new="1234")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-77"))

    def test_the_phones_are_signed_out_of_the_app(self):
        from rest_framework.authtoken.models import Token

        Token.objects.create(user=self.user)
        self._change()
        self.assertFalse(Token.objects.filter(user=self.user).exists())

    def test_the_page_renders_and_the_profile_points_at_it(self):
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertContains(self.client.get(reverse("accounts:profile")), self.url)

    def test_it_needs_a_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)


class ResetLinkTests(TestCase):
    """
    An admin letting somebody back in.

    KaamKoRecord can email nobody, so this is the only road back for a person who
    has forgotten their password entirely — see apps/accounts/passwords.py.
    """

    def setUp(self):
        self.admin = User.objects.create_user("boss", password="boss-password-12", is_staff=True)
        self.person = User.objects.create_user("kiran", password="old-password-77")
        self.url = reverse("accounts:reset_links")

    def _link(self):
        from apps.accounts.passwords import reset_path

        return reset_path(self.person)

    def _set_password(self, link, password="quokka-brunch-91"):
        """
        Walk Django's two steps: the link itself redirects to the form, with
        the token moved into the session on the way so it never sits in the
        address bar to be shoulder-read or logged.
        """
        page = self.client.get(link, follow=True)
        form_url = page.redirect_chain[-1][0] if page.redirect_chain else link
        return self.client.post(form_url, {"new_password1": password, "new_password2": password})

    # ---- who may make one ------------------------------------------------

    def test_the_page_hides_from_everybody_but_staff(self):
        self.client.force_login(self.person)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_it_needs_a_login_at_all(self):
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_only_an_admin_is_told_the_page_is_there(self):
        """A page only admins may use is a page only admins need to see."""
        self.client.force_login(self.person)
        self.assertNotContains(self.client.get(reverse("accounts:profile")), self.url)

        self.client.force_login(self.admin)
        self.assertContains(self.client.get(reverse("accounts:profile")), self.url)

    def test_an_admin_is_offered_everybody(self):
        self.client.force_login(self.admin)
        page = self.client.get(self.url)
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "kiran")

    def test_an_admin_gets_a_whole_link_back(self):
        self.client.force_login(self.admin)
        page = self.client.post(self.url, {"user": self.person.pk})
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "/reset/")

    # ---- what the link does ----------------------------------------------

    def test_it_lets_somebody_set_a_new_password_without_the_old_one(self):
        self._set_password(self._link())
        self.person.refresh_from_db()
        self.assertTrue(self.person.check_password("quokka-brunch-91"))

    def test_it_works_once_and_not_twice(self):
        link = self._link()
        self._set_password(link)
        self._set_password(link, password="second-attempt-55")

        self.person.refresh_from_db()
        self.assertTrue(self.person.check_password("quokka-brunch-91"))
        self.assertFalse(self.person.check_password("second-attempt-55"))

    def test_a_link_made_before_a_password_change_is_already_dead(self):
        """Two links out at once must not both work: the older one is stale."""
        stale = self._link()
        self._set_password(self._link(), password="quokka-brunch-91")
        self.client.logout()

        self._set_password(stale, password="stale-link-took-42")

        self.person.refresh_from_db()
        self.assertFalse(self.person.check_password("stale-link-took-42"))

    def test_a_tampered_link_is_refused(self):
        page = self.client.get(self._link()[:-6] + "abcde/", follow=True)
        self.assertContains(page, "expired")

    def test_using_it_signs_the_phones_out_of_the_app(self):
        from rest_framework.authtoken.models import Token

        Token.objects.create(user=self.person)
        self._set_password(self._link())
        self.assertFalse(Token.objects.filter(user=self.person).exists())

    def test_nobody_is_signed_in_by_setting_a_password(self):
        """The first thing a new password should do is be typed once."""
        self._set_password(self._link())
        self.assertNotIn("_auth_user_id", self.client.session)
