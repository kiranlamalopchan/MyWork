"""Boundary checks for presentation and request rules shared across apps."""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django import forms
from django.http import Http404
from django.template.loader import render_to_string
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from apps.accounts.avatars import display_name
from apps.moderation.services import report_target
from apps.noticeboard.presentation import fold_thread
from apps.timeclock.models import fortnight_hint

from .formatting import relative_time
from .http import safe_next


class SharedRequestTests(SimpleTestCase):
    def test_safe_next_uses_post_before_get_and_rejects_external_destinations(self):
        factory = RequestFactory()
        request = factory.post("/?next=/from-query/", {"next": "/from-form/"})
        self.assertEqual(safe_next(request, "/fallback/"), "/from-form/")
        for target in ("https://evil.example/", "//evil.example/", "javascript:alert(1)", ""):
            with self.subTest(target=target):
                request = factory.get("/", {"next": target})
                self.assertEqual(safe_next(request, "/fallback/"), "/fallback/")

    def test_secure_requests_cannot_redirect_to_an_insecure_absolute_url(self):
        factory = RequestFactory()
        request = factory.get("/", {"next": "http://testserver/profile/"}, secure=True)
        self.assertEqual(safe_next(request, "/fallback/"), "/fallback/")
        request = factory.get("/", {"next": "https://testserver/profile/"}, secure=True)
        self.assertEqual(safe_next(request, "/fallback/"), "https://testserver/profile/")

    def test_an_unknown_report_kind_is_rejected_before_querying(self):
        with self.assertRaises(Http404):
            report_target("unknown", 1)


class SharedPresentationTests(SimpleTestCase):
    def test_relative_time_at_the_minute_boundary_and_for_future_times(self):
        now = timezone.now()
        with patch("mywork.formatting.timezone.now", return_value=now):
            for seconds, expected in ((-5, "just now"), (59, "just now"), (60, "1 minute ago"), (120, "2 minutes ago"), (7200, "2 hours ago")):
                with self.subTest(seconds=seconds):
                    self.assertEqual(relative_time(now - timedelta(seconds=seconds)).replace("\xa0", " "), expected)

    def test_folding_keeps_recent_entries_and_handles_empty_or_short_threads(self):
        for items, keep, expected in (([], 3, ([], [])), ([1, 2], 3, ([], [1, 2])), ([1, 2, 3], 2, ([1], [2, 3])), ([1, 2], 0, ([1, 2], []))):
            with self.subTest(items=items, keep=keep):
                self.assertEqual(fold_thread(items, keep), expected)

    def test_display_name_falls_back_when_a_profile_is_missing(self):
        user = SimpleNamespace(get_username=lambda: "sam")
        self.assertEqual(display_name(user), "sam")
        user.profile = SimpleNamespace(name="Sam Lee")
        self.assertEqual(display_name(user), "Sam Lee")

    def test_fortnight_hint_describes_the_cycle_containing_today(self):
        self.assertEqual(fortnight_hint(date(2026, 9, 10), date(2026, 9, 16)),
                         "Thursday → Wednesday. This one runs 10 Sep – 23 Sep.")


class SharedFormFieldTests(SimpleTestCase):
    class ExampleForm(forms.Form):
        title = forms.CharField(label="Title", help_text="A short title")

    def test_field_keeps_its_label_escaped_value_and_optional_help(self):
        field = self.ExampleForm(initial={"title": "<b>Saved</b>"})["title"]
        html = render_to_string("_form_field.html", {"field": field, "show_help": True})
        self.assertIn('for="id_title"', html)
        self.assertIn("&lt;b&gt;Saved&lt;/b&gt;", html)
        self.assertIn("A short title", html)
        self.assertIn("data-error hidden", html)
        self.assertNotIn("A short title", render_to_string("_form_field.html", {"field": field, "show_help": False}))

    def test_invalid_field_exposes_the_validation_message(self):
        field = self.ExampleForm(data={})["title"]
        html = render_to_string("_form_field.html", {"field": field})
        self.assertIn("field--invalid", html)
        self.assertIn("This field is required.", html)
        self.assertNotIn("data-error hidden", html)
