import zoneinfo
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .forms import WorkplaceForm
from .models import (
    Break,
    fortnight_start,
    Shift,
    TimePreference,
    Weekday,
    Workplace,
    month_start,
    next_month_start,
    week_start,
)
from .views import _limits_for


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
        Workplace.objects.filter(pk=self.workplace.pk).update(
            hours_limit=8, limit_period=Workplace.Period.WEEK
        )
        Shift.objects.create(
            user=self.user, workplace=self.workplace,
            clock_in=timezone.now() - timedelta(hours=9),
            clock_out=timezone.now() - timedelta(hours=1),
            status=Shift.Status.COMPLETED,
        )
        self.assertContains(self.client.get(reverse("timeclock:timesheet")), "over your limit")


class PerWorkplaceLimitTests(TestCase):
    """
    Each workplace's cap is its own. Hours at one job must never spend another
    job's allowance, and going over at one must not warn about the other.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        # A tight cap at one job, a roomy one at the other.
        self.tight = Workplace.objects.create(
            user=self.user, name="Courtlands",
            hours_limit=8, limit_period=Workplace.Period.WEEK,
        )
        self.roomy = Workplace.objects.create(
            user=self.user, name="Bakery",
            hours_limit=40, limit_period=Workplace.Period.WEEK,
        )

    def _worked(self, workplace, hours):
        """A finished shift of `hours` inside the current week."""
        start = timezone.localtime(timezone.now()).replace(hour=9, minute=0, second=0, microsecond=0)
        # Monday of this week at 09:00 keeps the shift inside the weekly window
        # no matter which day the suite runs on.
        start -= timedelta(days=start.weekday())
        Shift.objects.create(
            user=self.user, workplace=workplace,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def test_hours_at_one_workplace_do_not_touch_the_others_limit(self):
        self._worked(self.tight, 9)

        limits = {l["workplace"].pk: l for l in _limits_for(self.user)}
        self.assertEqual(limits[self.tight.pk]["state"], "over")
        self.assertEqual(limits[self.tight.pk]["used"], timedelta(hours=9))
        # The bakery saw none of those hours.
        self.assertEqual(limits[self.roomy.pk]["state"], "ok")
        self.assertEqual(limits[self.roomy.pk]["used"], timedelta())

    def test_a_workplace_without_a_cap_gets_no_bar(self):
        Workplace.objects.filter(pk=self.roomy.pk).update(hours_limit=None)
        self._worked(self.roomy, 60)

        capped = [l["workplace"].pk for l in _limits_for(self.user)]
        self.assertEqual(capped, [self.tight.pk])

    def test_each_workplace_counts_over_its_own_fortnight_cycle(self):
        today = timezone.localdate()
        # Two fortnightly caps whose cycles start a week apart.
        Workplace.objects.filter(pk=self.tight.pk).update(
            limit_period=Workplace.Period.FORTNIGHT,
            fortnight_anchor=today - timedelta(days=today.weekday()),
        )
        Workplace.objects.filter(pk=self.roomy.pk).update(
            limit_period=Workplace.Period.FORTNIGHT,
            fortnight_anchor=today - timedelta(days=today.weekday() + 7),
        )
        tight = Workplace.objects.get(pk=self.tight.pk)
        roomy = Workplace.objects.get(pk=self.roomy.pk)

        self.assertNotEqual(tight.limit_window(today)[0], roomy.limit_window(today)[0])

    def test_timesheet_shows_one_bar_per_capped_workplace(self):
        self._worked(self.tight, 9)
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("Courtlands", html)
        self.assertIn("over your limit at Courtlands", html)

    def test_filtering_the_timesheet_shows_only_that_workplaces_limit(self):
        self._worked(self.tight, 9)
        html = self.client.get(
            reverse("timeclock:timesheet"), {"workplace": self.roomy.pk}
        ).content.decode()
        self.assertNotIn("over your limit at Courtlands", html)


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

        # Yesterday: a shift form now refuses times that haven't happened yet,
        # so anchoring on today would fail whenever the suite runs before 4pm.
        self.start = (timezone.localtime() - timedelta(days=1)).replace(
            hour=8, minute=0, second=0, microsecond=0
        )
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


class ManualShiftEntryTests(TestCase):
    """
    Adding a day by hand, for when the clock never got started.

    A typed shift skips every guard the clock-in button applies, so these
    cover the ways an entry from memory goes wrong: a day already recorded,
    and a time that hasn't happened.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")
        self.client.force_login(self.user)

        # Two days back, well clear of "now" from any time of day.
        self.day = timezone.localtime() - timedelta(days=2)
        self.start = self.day.replace(hour=9, minute=0, second=0, microsecond=0)

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
        return self.client.post(reverse("timeclock:shift_create"), data)

    def test_a_forgotten_day_can_be_added_and_counts_towards_totals(self):
        resp = self._post()
        self.assertEqual(resp.status_code, 302)

        shift = Shift.objects.get(user=self.user)
        self.assertEqual(shift.status, Shift.Status.COMPLETED)
        self.assertEqual(shift.workplace, self.workplace)
        self.assertEqual(shift.worked_duration, timedelta(hours=8))
        self.assertEqual(timezone.localtime(shift.clock_in).date(), self.start.date())

    def test_breaks_can_be_entered_with_the_shift(self):
        self._post(**{
            "breaks-TOTAL_FORMS": "1",
            "breaks-0-break_start": (self.start + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M"),
            "breaks-0-break_end": (self.start + timedelta(hours=4, minutes=30)).strftime("%Y-%m-%dT%H:%M"),
        })
        shift = Shift.objects.get(user=self.user)
        self.assertEqual(shift.total_break, timedelta(minutes=30))
        self.assertEqual(shift.worked_duration, timedelta(hours=7, minutes=30))

    def test_no_clock_out_leaves_the_shift_running(self):
        # "I've been here since 6am and never clocked in" — the shift carries
        # on as the live one.
        started = timezone.localtime() - timedelta(hours=3)
        resp = self._post(clock_in=started.strftime("%Y-%m-%dT%H:%M"), clock_out="")
        self.assertEqual(resp.status_code, 302)

        shift = Shift.open_for(self.user)
        self.assertIsNotNone(shift)
        self.assertEqual(shift.status, Shift.Status.WORKING)

    def test_a_shift_over_one_already_recorded_is_refused(self):
        self._post()
        # Same day, same hours, entered twice — this is the mistake that
        # silently doubles a week's total.
        resp = self._post()
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "overlaps a shift you already have")
        self.assertEqual(Shift.objects.filter(user=self.user).count(), 1)

    def test_a_shift_touching_an_existing_one_end_to_end_is_allowed(self):
        self._post()
        resp = self._post(
            clock_in=(self.start + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M"),
            clock_out=(self.start + timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M"),
        )
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(Shift.objects.filter(user=self.user).count(), 2)

    def test_a_running_shift_blocks_adding_another_open_one(self):
        Shift.clock_in_now(self.user, self.workplace)
        resp = self._post(
            clock_in=(timezone.localtime() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"),
            clock_out="",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "overlaps a shift you already have")

    def test_a_future_shift_is_refused(self):
        ahead = timezone.localtime() + timedelta(days=1)
        resp = self._post(
            clock_in=ahead.strftime("%Y-%m-%dT%H:%M"),
            clock_out=(ahead + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M"),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "in the future")
        self.assertFalse(Shift.objects.filter(user=self.user).exists())

    def test_another_users_workplace_cannot_be_used(self):
        other = User.objects.create_user("other", password="pw")
        theirs = Workplace.objects.create(user=other, name="Not mine")

        resp = self._post(workplace=theirs.pk)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Shift.objects.filter(user=self.user).exists())

    def test_the_form_prefills_the_day_picked_on_the_calendar(self):
        day = (timezone.localtime() - timedelta(days=3)).date()
        resp = self.client.get(reverse("timeclock:shift_create"), {"day": day.isoformat()})
        self.assertEqual(resp.status_code, 200)

        initial = resp.context["form"].initial
        self.assertEqual(timezone.localtime(initial["clock_in"]).date(), day)
        self.assertEqual(initial["workplace"], self.workplace)

    def test_a_nonsense_day_in_the_url_does_not_break_the_page(self):
        for raw in ["not-a-date", (timezone.localdate() + timedelta(days=5)).isoformat()]:
            with self.subTest(day=raw):
                resp = self.client.get(reverse("timeclock:shift_create"), {"day": raw})
                self.assertEqual(resp.status_code, 200)
                # Never prefills a day that hasn't happened.
                self.assertLessEqual(
                    timezone.localtime(resp.context["form"].initial["clock_in"]).date(),
                    timezone.localdate(),
                )


class NavigationTests(TestCase):
    """
    The shell around every page: apps are switched from the app bar, the bottom
    bar carries only the features of the app you're in, and adding a forgotten
    day lives behind More rather than on the timesheet.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.workplace = Workplace.objects.create(
            user=self.user, name="Courtlands", hours_limit=40,
            limit_period=Workplace.Period.WEEK,
        )
        start = (timezone.localtime() - timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        self.shift = Shift.objects.create(
            user=self.user, workplace=self.workplace, clock_in=start,
            clock_out=start + timedelta(hours=8), status=Shift.Status.COMPLETED,
        )

    def test_every_page_renders_with_the_app_switcher_and_no_apps_tab(self):
        pages = [
            ("home", []),
            ("timeclock:dashboard", []),
            ("timeclock:timesheet", []),
            ("timeclock:calendar", []),
            ("timeclock:more", []),
            ("timeclock:workplaces", []),
            ("timeclock:workplace_create", []),
            ("timeclock:workplace_edit", [self.workplace.pk]),
            ("timeclock:preferences", []),
            ("timeclock:shift_create", []),
            ("timeclock:shift_detail", [self.shift.pk]),
            ("timeclock:shift_edit", [self.shift.pk]),
            ("plu:list", []),
            ("plu:photo_search", []),
        ]
        for name, args in pages:
            with self.subTest(page=name):
                resp = self.client.get(reverse(name, args=args))
                self.assertEqual(resp.status_code, 200)
                html = resp.content.decode()
                self.assertIn('id="app-switcher"', html)
                # The hub is its own app chooser and carries no tab bar.
                if name != "home":
                    self.assertIn('class="tabbar__inner"', html)
                # Switching apps is the app bar's job now, not a tab slot.
                self.assertNotIn(">Apps</span>", html)

    def test_the_timesheet_is_only_shifts(self):
        resp = self.client.get(reverse("timeclock:timesheet"))
        self.assertNotContains(resp, "Add a shift you forgot")
        # Its figures are still real, server-rendered numbers.
        self.assertContains(resp, "data-tally=")

    def test_days_collapse_with_the_newest_left_open(self):
        # A second, older day, so there is something to keep shut.
        older = (timezone.localtime() - timedelta(days=6)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        Shift.objects.create(
            user=self.user, workplace=self.workplace, clock_in=older,
            clock_out=older + timedelta(hours=4), status=Shift.Status.COMPLETED,
        )

        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertEqual(html.count('<details class="day"'), 2)
        # Only the newest starts open; a shut day still shows its own count.
        self.assertEqual(html.count('<details class="day" open>'), 1)
        self.assertIn('class="day__count"', html)

    def test_adding_a_past_shift_lives_behind_more(self):
        self.assertContains(self.client.get(reverse("timeclock:more")), "Add a past shift")
        self.assertNotContains(
            self.client.get(reverse("timeclock:dashboard")), "Forgot to clock in?"
        )

    def test_the_calendar_keeps_its_day_specific_shortcut(self):
        day = timezone.localtime(self.shift.clock_in).date()
        resp = self.client.get(reverse("timeclock:calendar"), {"day": day.isoformat()})
        self.assertContains(resp, "Add a shift on this day")


class CycleStartTests(TestCase):
    """
    Where each period begins. The week runs Sunday to Saturday out of the box,
    and every cycle's start can be moved to wherever the roster or pay slip
    puts it.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.workplace = Workplace.objects.create(user=self.user, name="Courtlands")

    def test_the_week_runs_sunday_to_saturday_by_default(self):
        # 2026-09-07 is a Monday; its week opened on Sunday the 6th.
        self.assertEqual(week_start(date(2026, 9, 7)), date(2026, 9, 6))
        # Saturday the 12th is the last day of that same week.
        self.assertEqual(week_start(date(2026, 9, 12)), date(2026, 9, 6))
        # Sunday the 13th opens the next one.
        self.assertEqual(week_start(date(2026, 9, 13)), date(2026, 9, 13))

    def test_the_week_can_start_on_any_day(self):
        monday = date(2026, 9, 7)
        self.assertEqual(week_start(monday, Weekday.MONDAY), monday)
        self.assertEqual(week_start(monday, Weekday.WEDNESDAY), date(2026, 9, 2))
        self.assertEqual(week_start(monday, Weekday.SATURDAY), date(2026, 9, 5))

    def test_a_month_cycle_can_open_mid_month(self):
        # Pay month opening on the 26th: the 25th still belongs to the cycle
        # that opened last month.
        self.assertEqual(month_start(date(2026, 3, 25), 26), date(2026, 2, 26))
        self.assertEqual(month_start(date(2026, 3, 26), 26), date(2026, 3, 26))
        self.assertEqual(next_month_start(date(2026, 3, 26), 26), date(2026, 4, 26))
        # Short months and year ends take care of themselves.
        self.assertEqual(month_start(date(2026, 1, 5), 28), date(2025, 12, 28))
        self.assertEqual(next_month_start(date(2026, 12, 31), 15), date(2027, 1, 15))

    def test_a_weekly_limit_is_measured_over_the_chosen_week(self):
        Workplace.objects.filter(pk=self.workplace.pk).update(
            hours_limit=20, limit_period=Workplace.Period.WEEK,
            week_starts_on=Weekday.SUNDAY,
        )
        w = Workplace.objects.get(pk=self.workplace.pk)
        start, end = w.limit_window(date(2026, 9, 9))
        self.assertEqual((start, end), (date(2026, 9, 6), date(2026, 9, 13)))

        Workplace.objects.filter(pk=self.workplace.pk).update(week_starts_on=Weekday.MONDAY)
        w = Workplace.objects.get(pk=self.workplace.pk)
        start, end = w.limit_window(date(2026, 9, 9))
        self.assertEqual((start, end), (date(2026, 9, 7), date(2026, 9, 14)))

    def test_a_monthly_limit_counts_only_its_own_cycle(self):
        Workplace.objects.filter(pk=self.workplace.pk).update(
            hours_limit=100, limit_period=Workplace.Period.MONTH, month_starts_on=26,
        )
        w = Workplace.objects.get(pk=self.workplace.pk)
        self.assertEqual(w.period_label, "month")
        self.assertEqual(
            w.limit_window(date(2026, 3, 25)), (date(2026, 2, 26), date(2026, 3, 26))
        )

    def test_the_cycle_starts_can_be_saved_from_the_forms(self):
        resp = self.client.post(reverse("timeclock:preferences"), {
            "week_starts_on": Weekday.MONDAY,
            "fortnight_anchor": "2026-09-07",
            "month_starts_on": "15",
        })
        self.assertEqual(resp.status_code, 302)

        pref = TimePreference.for_user(self.user)
        self.assertEqual(pref.week_starts_on, Weekday.MONDAY)
        self.assertEqual(pref.month_starts_on, 15)

        resp = self.client.post(
            reverse("timeclock:workplace_edit", args=[self.workplace.pk]),
            {
                "name": "Courtlands", "address": "", "hourly_rate": "",
                "hours_limit": "38", "limit_period": Workplace.Period.MONTH,
                "week_starts_on": Weekday.SUNDAY, "fortnight_anchor": "2026-09-06",
                "month_starts_on": "26",
            },
        )
        self.assertEqual(resp.status_code, 302)

        w = Workplace.objects.get(pk=self.workplace.pk)
        self.assertEqual(w.limit_period, Workplace.Period.MONTH)
        self.assertEqual(w.month_starts_on, 26)

    def test_a_month_start_outside_1_to_28_is_refused(self):
        resp = self.client.post(reverse("timeclock:preferences"), {
            "week_starts_on": Weekday.SUNDAY,
            "fortnight_anchor": "2026-09-06",
            "month_starts_on": "31",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(TimePreference.for_user(self.user).month_starts_on, 1)

    def test_the_calendar_grid_follows_the_week_start(self):
        html = self.client.get(reverse("timeclock:calendar")).content.decode()
        head = html.split('cal__grid--head', 1)[1].split("</div>", 1)[0]
        self.assertIn('title="Sunday"', head)
        # Sunday's column comes before Monday's.
        self.assertLess(head.index('title="Sunday"'), head.index('title="Monday"'))

        TimePreference.objects.update_or_create(
            user=self.user, defaults={"week_starts_on": Weekday.MONDAY}
        )
        html = self.client.get(reverse("timeclock:calendar")).content.decode()
        head = html.split('cal__grid--head', 1)[1].split("</div>", 1)[0]
        self.assertLess(head.index('title="Monday"'), head.index('title="Sunday"'))


class PayTests(TestCase):
    """
    What the hours came to, before and after tax.

    The numbers here are taken from a real fortnightly payslip, so a change
    that quietly breaks the arithmetic fails against something that actually
    landed in a bank account rather than against a made-up example.
    """

    # Asian United Food Service, period ending 26/08/2026.
    RATE = Decimal("33.25")
    HOURS = 51.78335
    GROSS = 1721.80
    TAX = 186.00
    NET = 1535.80
    # 186.00 / 1721.80 as a percentage, which is what the field asks for.
    WITHHELD_PCT = Decimal("10.80")

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.job = Workplace.objects.create(
            user=self.user, name="AUFS", hourly_rate=self.RATE, tax_rate=self.WITHHELD_PCT
        )

    def shift_of(self, hours, workplace=None, day=None):
        """One completed shift of `hours`, with no break."""
        start = timezone.now() - timedelta(days=day or 0, hours=hours)
        return Shift.objects.create(
            user=self.user,
            workplace=workplace or self.job,
            clock_in=start,
            clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    # ---- one shift -------------------------------------------------------

    def test_a_shift_carries_gross_tax_and_take_home(self):
        pay = self.shift_of(10).pay
        self.assertEqual(pay.gross, 332.50)
        self.assertEqual(pay.tax, 35.91)
        self.assertEqual(pay.net, 296.59)
        # The three always agree with each other.
        self.assertAlmostEqual(pay.gross - pay.tax, pay.net, places=2)

    def test_the_payslip_adds_up(self):
        pay = self.job.pay_for(self.HOURS)
        self.assertAlmostEqual(pay.gross, self.GROSS, delta=0.01)
        self.assertAlmostEqual(pay.tax, self.TAX, delta=0.50)
        self.assertAlmostEqual(pay.net, self.NET, delta=0.50)

    def test_no_rate_means_no_pay_rather_than_zero(self):
        unpaid = Workplace.objects.create(user=self.user, name="Volunteering")
        self.assertIsNone(self.shift_of(5, workplace=unpaid).pay)
        self.assertIsNone(self.shift_of(5, workplace=unpaid).estimated_pay)

    def test_no_tax_rate_leaves_take_home_equal_to_gross(self):
        job = Workplace.objects.create(user=self.user, name="Fresh Meat", hourly_rate=25)
        pay = self.shift_of(4, workplace=job).pay

        self.assertEqual(pay.gross, 100.00)
        self.assertEqual(pay.tax, 0.00)
        self.assertEqual(pay.net, 100.00)
        # And the screens can tell that apart from "nothing was withheld".
        self.assertFalse(job.withholds)
        self.assertTrue(self.job.withholds)

    def test_gross_is_still_what_estimated_pay_means(self):
        # The old name is still the gross figure the rest of the app reads.
        shift = self.shift_of(10)
        self.assertEqual(shift.estimated_pay, shift.pay.gross)

    def test_breaks_come_off_before_the_money(self):
        shift = self.shift_of(8)
        Break.objects.create(
            shift=shift,
            break_start=shift.clock_in + timedelta(hours=4),
            break_end=shift.clock_in + timedelta(hours=4, minutes=30),
        )
        # 7.5 paid hours, not 8.
        self.assertEqual(shift.pay.gross, round(7.5 * 33.25, 2))

    # ---- a period --------------------------------------------------------

    def test_the_timesheet_totals_the_fortnight(self):
        self.shift_of(6)
        self.shift_of(4, day=1)

        pay = self.client.get(reverse("timeclock:timesheet")).context["summary"]["fortnight_pay"]
        self.assertEqual(pay["pay"].gross, round(10 * 33.25, 2))
        self.assertEqual(pay["pay"].net, round(pay["pay"].gross - pay["pay"].tax, 2))
        self.assertTrue(pay["withheld"])

    def test_two_jobs_on_different_rates_add_up_rather_than_average(self):
        other = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=25, tax_rate=Decimal("20.00")
        )
        self.shift_of(2)                      # 66.50 gross, 7.18 tax
        self.shift_of(2, workplace=other)     # 50.00 gross, 10.00 tax

        pay = self.client.get(reverse("timeclock:timesheet")).context["summary"]["fortnight_pay"]
        self.assertEqual(pay["pay"].gross, 116.50)
        self.assertEqual(pay["pay"].tax, 17.18)
        self.assertEqual(pay["pay"].net, 99.32)

    def test_a_period_with_nothing_priced_shows_no_pay_at_all(self):
        unpaid = Workplace.objects.create(user=self.user, name="Volunteering")
        self.shift_of(5, workplace=unpaid)

        summary = self.client.get(reverse("timeclock:timesheet")).context["summary"]
        self.assertIsNone(summary["fortnight_pay"])

    def test_the_take_home_reaches_the_page(self):
        self.shift_of(10)
        resp = self.client.get(reverse("timeclock:timesheet"))

        self.assertContains(resp, "Take-home")
        self.assertContains(resp, "296.59")
        self.assertContains(resp, "332.50")

    def test_a_job_with_no_withholding_says_the_figure_is_before_tax(self):
        Workplace.objects.filter(pk=self.job.pk).update(tax_rate=None)
        self.shift_of(10)

        resp = self.client.get(reverse("timeclock:timesheet"))
        self.assertContains(resp, "This is before tax")
        self.assertNotContains(resp, "Take-home")


class ThursdayFortnightTests(TestCase):
    """
    Fortnights run Thursday to Wednesday — the cycle a real payslip here uses
    (period 13/08/2026 to 26/08/2026 is exactly that).
    """

    # Thursday, and the start of a real pay period.
    PAYSLIP_START = date(2026, 8, 13)

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)

    def test_the_payslip_period_is_thursday_to_wednesday(self):
        end = self.PAYSLIP_START + timedelta(days=13)
        self.assertEqual(self.PAYSLIP_START.strftime("%A"), "Thursday")
        self.assertEqual(end.strftime("%A"), "Wednesday")
        self.assertEqual(end, date(2026, 8, 26))

    def test_a_new_workplace_anchors_on_a_thursday(self):
        job = Workplace.objects.create(user=self.user, name="AUFS")
        self.assertEqual(job.fortnight_anchor.strftime("%A"), "Thursday")
        self.assertLessEqual(job.fortnight_anchor, timezone.localdate())

    def test_a_new_account_anchors_on_a_thursday(self):
        pref = TimePreference.for_user(self.user)
        self.assertEqual(pref.fortnight_anchor.strftime("%A"), "Thursday")

    def test_every_cycle_from_the_anchor_starts_on_a_thursday(self):
        # Six months of cycles: a fortnight repeats every 14 days, so the
        # weekday can never drift off the one the anchor set.
        for weeks in range(0, 26, 2):
            day = self.PAYSLIP_START + timedelta(weeks=weeks, days=3)
            start = fortnight_start(day, self.PAYSLIP_START)
            self.assertEqual(start.strftime("%A"), "Thursday")

    def test_a_wednesday_belongs_to_the_cycle_that_is_closing(self):
        # 26 Aug is the last day of the payslip period, not the first of the
        # next one — the off-by-one that would split a pay period in two.
        self.assertEqual(fortnight_start(date(2026, 8, 26), self.PAYSLIP_START), self.PAYSLIP_START)
        self.assertEqual(
            fortnight_start(date(2026, 8, 27), self.PAYSLIP_START), date(2026, 8, 27)
        )

    def test_the_timesheet_counts_the_fortnight_from_a_thursday(self):
        job = Workplace.objects.create(
            user=self.user, name="AUFS", hourly_rate=Decimal("33.25")
        )
        summary = self.client.get(reverse("timeclock:timesheet")).context["summary"]

        self.assertEqual(summary["fortnight_start"].strftime("%A"), "Thursday")
        self.assertEqual(summary["fortnight_end"].strftime("%A"), "Wednesday")
        self.assertEqual(job.fortnight_runs, "Thursday → Wednesday")

    def test_the_form_spells_out_which_days_the_cycle_runs(self):
        job = Workplace.objects.create(user=self.user, name="AUFS")
        form = WorkplaceForm(instance=job, user=self.user)
        self.assertIn("Thursday → Wednesday", form.fields["fortnight_anchor"].help_text)

    def test_the_label_follows_the_anchor_rather_than_being_told(self):
        # Move the anchor and the sentence moves with it — nothing to keep
        # in step by hand.
        job = Workplace.objects.create(
            user=self.user, name="Fresh Meat", fortnight_anchor=date(2026, 8, 17)
        )
        self.assertEqual(job.fortnight_runs, "Monday → Sunday")
