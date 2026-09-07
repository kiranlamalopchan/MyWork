import zoneinfo
from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Break, Shift, TimePreference, Workplace


class ShiftFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands Aged Care")

    def test_full_shift_totals(self):
        """8:03 in, 27 minutes of break, 1:49 out — the spec's worked example."""
        start = timezone.now() - timedelta(hours=5, minutes=46)
        shift = Shift.objects.create(user=self.user, workplace=self.workplace, clock_in=start)
        Break.objects.create(
            shift=shift,
            break_start=start + timedelta(hours=2, minutes=30),
            break_end=start + timedelta(hours=2, minutes=57),
        )
        shift.clock_out_now(when=start + timedelta(hours=5, minutes=46))

        self.assertEqual(shift.total_duration, timedelta(hours=5, minutes=46))
        self.assertEqual(shift.total_break, timedelta(minutes=27))
        self.assertEqual(shift.worked_duration, timedelta(hours=5, minutes=19))
        self.assertEqual(shift.status, Shift.Status.COMPLETED)

    def test_multiple_breaks_sum(self):
        start = timezone.now() - timedelta(hours=8)
        shift = Shift.objects.create(user=self.user, workplace=self.workplace, clock_in=start)
        for offset, length in ((1, 15), (3, 30), (5, 10)):
            Break.objects.create(
                shift=shift,
                break_start=start + timedelta(hours=offset),
                break_end=start + timedelta(hours=offset, minutes=length),
            )
        shift.clock_out_now(when=start + timedelta(hours=8))

        self.assertEqual(shift.total_break, timedelta(minutes=55))
        self.assertEqual(shift.worked_duration, timedelta(hours=7, minutes=5))

    # ---- validation rules from the spec --------------------------------

    def test_cannot_clock_in_twice(self):
        Shift.clock_in_now(self.user, self.workplace)
        with self.assertRaises(ValidationError):
            Shift.clock_in_now(self.user, self.workplace)

    def test_cannot_clock_in_while_on_break(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        shift.start_break()
        with self.assertRaises(ValidationError):
            Shift.clock_in_now(self.user, self.workplace)

    def test_cannot_start_second_break(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        shift.start_break()
        with self.assertRaises(ValidationError):
            shift.start_break()

    def test_cannot_end_break_that_never_started(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        with self.assertRaises(ValidationError):
            shift.end_break()

    def test_cannot_clock_out_while_on_break(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        shift.start_break()
        with self.assertRaises(ValidationError):
            shift.clock_out_now()

    def test_clock_out_must_follow_clock_in(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        with self.assertRaises(ValidationError):
            shift.clock_out_now(when=shift.clock_in - timedelta(minutes=5))

    def test_break_end_must_follow_break_start(self):
        start = timezone.now() - timedelta(hours=2)
        shift = Shift.objects.create(user=self.user, workplace=self.workplace, clock_in=start)
        brk = Break(shift=shift, break_start=start + timedelta(hours=1),
                    break_end=start + timedelta(minutes=30))
        with self.assertRaises(ValidationError):
            brk.full_clean()

    def test_cannot_use_another_users_workplace(self):
        intruder = User.objects.create_user("other", password="pw")
        with self.assertRaises(ValidationError):
            Shift.clock_in_now(intruder, self.workplace)

    def test_break_cycle_returns_to_working(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        shift.start_break()
        self.assertEqual(shift.status, Shift.Status.ON_BREAK)
        shift.end_break()
        self.assertEqual(shift.status, Shift.Status.WORKING)
        self.assertIsNone(shift.running_break)


class WorkplaceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")

    def test_only_one_default(self):
        a = Workplace.objects.create(user=self.user, name="A", is_default=True)
        b = Workplace.objects.create(user=self.user, name="B")
        b.make_default()

        a.refresh_from_db()
        self.assertFalse(a.is_default)
        self.assertTrue(b.is_default)

    def test_delete_keeps_history_by_archiving(self):
        w = Workplace.objects.create(user=self.user, name="A")
        Shift.objects.create(user=self.user, workplace=w, clock_in=timezone.now())

        self.assertEqual(w.delete_or_archive(), "archived")
        w.refresh_from_db()
        self.assertTrue(w.is_archived)
        self.assertEqual(Shift.objects.filter(workplace=w).count(), 1)

    def test_delete_removes_unused_workplace(self):
        w = Workplace.objects.create(user=self.user, name="A")
        self.assertEqual(w.delete_or_archive(), "deleted")
        self.assertFalse(Workplace.objects.filter(pk=w.pk).exists())


class AccessTests(TestCase):
    """One user must never reach another's shifts or workplaces."""

    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pw")
        self.other = User.objects.create_user("other", password="pw")
        self.workplace = Workplace.objects.create(user=self.owner, name="A")
        self.shift = Shift.objects.create(
            user=self.owner, workplace=self.workplace,
            clock_in=timezone.now() - timedelta(hours=1),
        )

    def test_other_user_cannot_view_shift(self):
        self.client.force_login(self.other)
        self.assertEqual(
            self.client.get(reverse("timeclock:shift_detail", args=[self.shift.pk])).status_code, 404
        )

    def test_other_user_cannot_edit_shift(self):
        self.client.force_login(self.other)
        self.assertEqual(
            self.client.get(reverse("timeclock:shift_edit", args=[self.shift.pk])).status_code, 404
        )

    def test_other_user_cannot_delete_shift(self):
        self.client.force_login(self.other)
        self.assertEqual(
            self.client.post(reverse("timeclock:shift_delete", args=[self.shift.pk])).status_code, 404
        )
        self.assertTrue(Shift.objects.filter(pk=self.shift.pk).exists())

    def test_other_user_cannot_edit_workplace(self):
        self.client.force_login(self.other)
        self.assertEqual(
            self.client.get(reverse("timeclock:workplace_edit", args=[self.workplace.pk])).status_code, 404
        )

    def test_anonymous_is_redirected_to_login(self):
        resp = self.client.get(reverse("timeclock:dashboard"))
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login/", resp["Location"])


class DashboardViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands", is_default=True)
        self.client.force_login(self.user)

    def test_clock_in_out_round_trip(self):
        self.client.post(reverse("timeclock:clock_in"), {"workplace": self.workplace.pk})
        shift = Shift.open_for(self.user)
        self.assertIsNotNone(shift)
        self.assertEqual(shift.status, Shift.Status.WORKING)

        self.client.post(reverse("timeclock:start_break"))
        shift.refresh_from_db()
        self.assertEqual(shift.status, Shift.Status.ON_BREAK)

        # Clocking out mid-break is refused, exactly as the model requires.
        self.client.post(reverse("timeclock:clock_out"))
        shift.refresh_from_db()
        self.assertEqual(shift.status, Shift.Status.ON_BREAK)

        self.client.post(reverse("timeclock:end_break"))
        self.client.post(reverse("timeclock:clock_out"))
        shift.refresh_from_db()
        self.assertEqual(shift.status, Shift.Status.COMPLETED)
        self.assertIsNotNone(shift.clock_out)

    def test_dashboard_renders_in_each_state(self):
        self.assertEqual(self.client.get(reverse("timeclock:dashboard")).status_code, 200)

        self.client.post(reverse("timeclock:clock_in"), {"workplace": self.workplace.pk})
        self.assertContains(self.client.get(reverse("timeclock:dashboard")), "WORKING")

        self.client.post(reverse("timeclock:start_break"))
        self.assertContains(self.client.get(reverse("timeclock:dashboard")), "ON BREAK")

    def test_timesheet_and_pages_render(self):
        Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=timezone.now() - timedelta(hours=3),
            clock_out=timezone.now() - timedelta(hours=1),
            status=Shift.Status.COMPLETED,
        )
        for name in ["timesheet", "workplaces", "workplace_create", "preferences", "more"]:
            with self.subTest(page=name):
                self.assertEqual(self.client.get(reverse(f"timeclock:{name}")).status_code, 200)

    def test_limit_warning_appears(self):
        TimePreference.objects.update_or_create(
            user=self.user,
            defaults={"hours_limit": 8, "limit_period": TimePreference.Period.WEEK},
        )
        Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=timezone.now() - timedelta(hours=9),
            clock_out=timezone.now() - timedelta(hours=1),
            status=Shift.Status.COMPLETED,
        )
        self.assertContains(self.client.get(reverse("timeclock:timesheet")), "over your limit")


class PersistenceTests(TestCase):
    """
    The running clock lives in the database, not the browser. Closing the tab,
    killing the app or swapping phones must not lose or pause a shift.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")

    def test_elapsed_time_keeps_counting_with_no_browser(self):
        # Clock in "6 hours ago" and never touch the page again.
        shift = Shift.clock_in_now(self.user, self.workplace)
        Shift.objects.filter(pk=shift.pk).update(clock_in=timezone.now() - timedelta(hours=6))
        shift.refresh_from_db()

        # A brand-new session (a different client entirely) still sees 6 hours.
        fresh = Shift.open_for(self.user)
        self.assertEqual(fresh.status, Shift.Status.WORKING)
        self.assertAlmostEqual(fresh.worked_duration.total_seconds(), 6 * 3600, delta=5)

    def test_break_keeps_counting_with_no_browser(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        Shift.objects.filter(pk=shift.pk).update(clock_in=timezone.now() - timedelta(hours=3))
        shift.refresh_from_db()
        shift.start_break()
        Break.objects.filter(shift=shift).update(break_start=timezone.now() - timedelta(minutes=20))

        fresh = Shift.open_for(self.user)
        self.assertAlmostEqual(fresh.total_break.total_seconds(), 20 * 60, delta=5)
        # Break time is off the clock, so worked is 3h minus the 20m.
        self.assertAlmostEqual(
            fresh.worked_duration.total_seconds(), 3 * 3600 - 20 * 60, delta=5
        )

    def test_dashboard_hands_the_browser_the_server_timestamps(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        self.client.force_login(self.user)
        html = self.client.get(reverse("timeclock:dashboard")).content.decode()

        # The ticker rebuilds elapsed time from these, so a reload can't drift.
        self.assertIn('data-clock-in="' + shift.clock_in.isoformat(), html)
        self.assertIn('data-server-now="', html)
        self.assertIn('data-status="WORKING"', html)

    def test_long_shift_is_flagged(self):
        shift = Shift.clock_in_now(self.user, self.workplace)
        Shift.objects.filter(pk=shift.pk).update(clock_in=timezone.now() - timedelta(hours=11))

        self.client.force_login(self.user)
        self.assertContains(
            self.client.get(reverse("timeclock:dashboard")), "has been running over 10 hours"
        )

    def test_dial_is_scaled_to_ten_hours(self):
        self.client.force_login(self.user)
        self.assertContains(
            self.client.get(reverse("timeclock:dashboard")), 'data-target-hours="10"'
        )


class ClientClockTests(TestCase):
    """
    The phone supplies the time. Its ISO string carries the phone's own UTC
    offset, so a correct phone in any zone lands on the same instant the
    server would have picked; only a genuinely wrong clock diverges.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")
        self.client.force_login(self.user)

    def _stamp(self, moment, offset="+10:00"):
        """Format a moment the way app.js does: local wall time + offset."""
        tz = zoneinfo.ZoneInfo("Australia/Sydney")
        return moment.astimezone(tz).strftime("%Y-%m-%dT%H:%M:%S") + offset

    def test_clock_in_uses_the_phones_timestamp(self):
        phone_moment = timezone.now() - timedelta(minutes=17)
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": phone_moment.isoformat(),
            "client_tz": "Australia/Sydney",
        })

        shift = Shift.open_for(self.user)
        # Recorded 17 minutes ago because that's when the phone said it was,
        # not "now" when the request landed.
        self.assertAlmostEqual(
            (timezone.now() - shift.clock_in).total_seconds(), 17 * 60, delta=5
        )

    def test_phone_timezone_is_remembered_and_used_for_rendering(self):
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": timezone.now().isoformat(),
            "client_tz": "Australia/Sydney",
        })

        pref = TimePreference.for_user(self.user)
        self.assertEqual(pref.timezone_name, "Australia/Sydney")

    def test_offset_is_honoured_not_the_wall_clock_digits(self):
        # 09:00 in Sydney (+10) is the same instant as 23:00 UTC the day
        # before — the offset has to be read, not ignored.
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": "2026-09-07T09:00:00+10:00",
            "client_tz": "Australia/Sydney",
        })
        shift = Shift.open_for(self.user)
        self.assertEqual(
            shift.clock_in.astimezone(zoneinfo.ZoneInfo("UTC")).isoformat(),
            "2026-09-06T23:00:00+00:00",
        )

    def test_absurd_phone_clock_falls_back_to_the_server(self):
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": "1999-01-01T09:00:00+10:00",
            "client_tz": "Australia/Sydney",
        })
        shift = Shift.open_for(self.user)
        self.assertAlmostEqual(
            (timezone.now() - shift.clock_in).total_seconds(), 0, delta=10
        )

    def test_missing_or_broken_stamp_falls_back_to_the_server(self):
        for payload in [
            {},                                        # no JS at all
            {"client_time": "not-a-timestamp"},
            {"client_time": "2026-09-07T09:00:00"},    # naive: no offset to place it
            {"client_time": "", "client_tz": "Mars/Olympus"},
        ]:
            with self.subTest(payload=payload):
                Shift.objects.filter(user=self.user).delete()
                data = {"workplace": self.workplace.pk}
                data.update(payload)
                self.client.post(reverse("timeclock:clock_in"), data)

                shift = Shift.open_for(self.user)
                self.assertIsNotNone(shift)
                self.assertAlmostEqual(
                    (timezone.now() - shift.clock_in).total_seconds(), 0, delta=10
                )

    def test_bogus_timezone_is_not_stored(self):
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": timezone.now().isoformat(),
            "client_tz": "Mars/Olympus",
        })
        self.assertEqual(TimePreference.for_user(self.user).timezone_name, "")

    def test_breaks_and_clock_out_take_the_phones_time_too(self):
        start = timezone.now() - timedelta(hours=5)
        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": start.isoformat(),
            "client_tz": "Australia/Sydney",
        })
        self.client.post(reverse("timeclock:start_break"), {
            "client_time": (start + timedelta(hours=2)).isoformat(),
        })
        self.client.post(reverse("timeclock:end_break"), {
            "client_time": (start + timedelta(hours=2, minutes=30)).isoformat(),
        })
        self.client.post(reverse("timeclock:clock_out"), {
            "client_time": (start + timedelta(hours=4)).isoformat(),
        })

        shift = Shift.objects.filter(user=self.user).first()
        self.assertEqual(shift.status, Shift.Status.COMPLETED)
        self.assertEqual(shift.total_duration, timedelta(hours=4))
        self.assertEqual(shift.total_break, timedelta(minutes=30))
        self.assertEqual(shift.worked_duration, timedelta(hours=3, minutes=30))

    def test_pages_render_in_the_phones_timezone(self):
        # 09:00 Sydney == 08:30 Darwin. The page must say 9:00, matching the
        # phone, not 8:30 from the server's configured TIME_ZONE.
        TimePreference.objects.update_or_create(
            user=self.user, defaults={"timezone_name": "Australia/Sydney"}
        )
        Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=datetime(2026, 9, 7, 9, 0, tzinfo=zoneinfo.ZoneInfo("Australia/Sydney")),
            clock_out=datetime(2026, 9, 7, 17, 0, tzinfo=zoneinfo.ZoneInfo("Australia/Sydney")),
            status=Shift.Status.COMPLETED,
        )

        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("9:00 AM", html)
        self.assertNotIn("8:30 AM", html)

    def test_cookie_sets_the_timezone_without_any_clock_action(self):
        Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=datetime(2026, 9, 7, 9, 0, tzinfo=zoneinfo.ZoneInfo("Australia/Sydney")),
            clock_out=datetime(2026, 9, 7, 17, 0, tzinfo=zoneinfo.ZoneInfo("Australia/Sydney")),
            status=Shift.Status.COMPLETED,
        )
        self.client.cookies["plu_tz"] = "Australia/Sydney"

        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("9:00 AM", html)

    def test_bogus_cookie_does_not_break_the_page(self):
        self.client.cookies["plu_tz"] = "Mars/Olympus"
        self.assertEqual(self.client.get(reverse("timeclock:dashboard")).status_code, 200)

    def test_timezone_does_not_leak_between_users(self):
        TimePreference.objects.update_or_create(
            user=self.user, defaults={"timezone_name": "Pacific/Kiritimati"}
        )
        self.client.get(reverse("timeclock:dashboard"))

        # A second user with no zone set must render in the server default,
        # not whatever the previous request activated on this thread.
        other = User.objects.create_user("other", password="pw")
        self.client.force_login(other)
        self.client.get(reverse("timeclock:dashboard"))
        self.assertEqual(timezone.get_current_timezone_name(), settings.TIME_ZONE)


class CalendarTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")
        self.client.force_login(self.user)

        # Two shifts on the same local day, so the cell has to sum them.
        day = timezone.localtime().replace(hour=8, minute=0, second=0, microsecond=0)
        self.day = day.date()
        for offset, hours in ((0, 4), (5, 3)):
            Shift.objects.create(
                user=self.user, workplace=self.workplace,
                clock_in=day + timedelta(hours=offset),
                clock_out=day + timedelta(hours=offset + hours),
                status=Shift.Status.COMPLETED,
            )

    def test_month_totals_sum_each_day(self):
        resp = self.client.get(reverse("timeclock:calendar"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "7h")  # 4h + 3h on the one day

    def test_day_panel_lists_that_days_shifts(self):
        resp = self.client.get(reverse("timeclock:calendar"), {"day": self.day.isoformat()})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Courtlands")
        self.assertEqual(resp.context["selected_total"], timedelta(hours=7))
        self.assertEqual(len(resp.context["selected_shifts"]), 2)

    def test_month_navigation(self):
        resp = self.client.get(reverse("timeclock:calendar"), {"year": 2026, "month": 1})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "January 2026")

    def test_garbage_query_string_does_not_crash(self):
        for params in [{"month": "13"}, {"month": "abc"}, {"year": "0"}, {"day": "not-a-date"}]:
            with self.subTest(params=params):
                self.assertEqual(
                    self.client.get(reverse("timeclock:calendar"), params).status_code, 200
                )

    def test_calendar_only_shows_own_shifts(self):
        other = User.objects.create_user("other", password="pw")
        self.client.force_login(other)
        resp = self.client.get(reverse("timeclock:calendar"))
        self.assertEqual(resp.context["month_total"], timedelta())


class ShiftEditTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")
        self.client.force_login(self.user)

        self.start = timezone.localtime().replace(hour=8, minute=0, second=0, microsecond=0)
        self.shift = Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=self.start, clock_out=self.start + timedelta(hours=8),
            status=Shift.Status.COMPLETED,
        )

    def _post(self, **overrides):
        data = {
            "workplace": self.workplace.pk,
            "clock_in": self.start.strftime("%Y-%m-%dT%H:%M"),
            "clock_out": (self.start + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M"),
            "note": "",
            "breaks-TOTAL_FORMS": "0",
            "breaks-INITIAL_FORMS": "0",
            "breaks-MIN_NUM_FORMS": "0",
            "breaks-MAX_NUM_FORMS": "1000",
        }
        data.update(overrides)
        return self.client.post(reverse("timeclock:shift_edit", args=[self.shift.pk]), data)

    def test_adding_a_break_recalculates_worked_time(self):
        resp = self._post(**{
            "breaks-TOTAL_FORMS": "1",
            "breaks-0-break_start": (self.start + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-0-break_end": (self.start + timedelta(hours=4, minutes=30)).strftime("%Y-%m-%dT%H:%M"),
        })
        self.assertEqual(resp.status_code, 302)

        self.shift.refresh_from_db()
        self.assertEqual(self.shift.total_break, timedelta(minutes=30))
        self.assertEqual(self.shift.worked_duration, timedelta(hours=7, minutes=30))

    def test_clock_out_before_clock_in_is_rejected(self):
        resp = self._post(clock_out=(self.start - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "after clock-in")

    def test_break_outside_shift_is_rejected(self):
        resp = self._post(**{
            "breaks-TOTAL_FORMS": "1",
            "breaks-0-break_start": (self.start - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-0-break_end": (self.start - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"),
        })
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "before the shift")

    def test_overlapping_breaks_are_rejected(self):
        resp = self._post(**{
            "breaks-TOTAL_FORMS": "2",
            "breaks-0-break_start": (self.start + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-0-break_end": (self.start + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-1-break_start": (self.start + timedelta(hours=2, minutes=30)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-1-break_end": (self.start + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M"),
        })
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "overlaps")

    def test_clearing_clock_out_reopens_the_shift(self):
        self._post(clock_out="")
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.status, Shift.Status.WORKING)
        self.assertIsNone(self.shift.clock_out)
