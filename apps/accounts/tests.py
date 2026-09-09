"""What the profile has to get right."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.template import Context, Template
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import LIVE_FOR, SEEN_EVERY, Profile
from apps.noticeboard.models import Notice

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
