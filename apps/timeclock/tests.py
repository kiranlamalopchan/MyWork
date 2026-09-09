import shutil
import tempfile
import zoneinfo
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .forms import WorkplaceForm
from . import payslip as payslip_reader
from .models import (
    Break,
    fortnight_start,
    PayCycle,
    Payment,
    Payslip,
    Shift,
    TimePreference,
    Weekday,
    Workplace,
    month_start,
    next_month_start,
    week_start,
)
from .views import _limit_for, _limits_for, _pay_state


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


class LimitResetOnPaymentTests(TestCase):
    """
    Being paid restarts the counting without forgetting the count.

    The figure on the cap is the hours worked since the money arrived, so the
    day you are paid it reads zero and the next stretch can be watched from a
    clean start. What it must never do is hand out a second allowance: a cap
    of 48 hours a fortnight is 48 whether or not somebody paid you halfway
    through it, so the hours before the line stay in the period's total and
    still turn the card red on their own.
    """

    CAP = 48

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.today = timezone.localdate()
        # A fortnight that opened three days ago, so there is room either side
        # of a payment no matter which day the suite runs on.
        self.job = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=26,
            hours_limit=self.CAP, limit_period=Workplace.Period.FORTNIGHT,
            fortnight_anchor=self.today - timedelta(days=3),
        )
        self.opens, _ = self.job.limit_window(self.today)

    def _day(self, offset):
        return self.opens + timedelta(days=offset)

    def _worked(self, hours, offset=0, at=9):
        start = timezone.make_aware(
            datetime.combine(self._day(offset), time(at)),
            timezone.get_current_timezone(),
        )
        return Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def _paid_at(self, offset, hours):
        """A payment drawing its line at midnight opening day `offset`."""
        return Payment.objects.create(
            workplace=self.job,
            covers_through=timezone.make_aware(
                datetime.combine(self._day(offset), time.min),
                timezone.get_current_timezone(),
            ),
            hours=hours,
        )

    def test_the_count_goes_back_to_zero_when_the_money_arrives(self):
        self._worked(5, offset=0)
        self.assertEqual(_limit_for(self.user, self.job)["since"], timedelta(hours=5))

        self._paid_at(1, hours=5)
        limit = _limit_for(self.user, self.job)
        self.assertEqual(limit["since"], timedelta())
        self.assertEqual(limit["settled"], timedelta(hours=5))

    def test_hours_worked_after_the_payment_count_again(self):
        self._worked(5, offset=0)
        self._paid_at(1, hours=5)
        self._worked(6, offset=1)

        limit = _limit_for(self.user, self.job)
        self.assertEqual(limit["since"], timedelta(hours=6))
        self.assertEqual(limit["used"], timedelta(hours=11))

    def test_the_period_keeps_the_hours_it_was_paid_for(self):
        # Over the cap, and then paid for. The breach does not go away.
        self._worked(30, offset=0, at=0)
        self._worked(20, offset=1, at=0)
        self._paid_at(2, hours=50)

        limit = _limit_for(self.user, self.job)
        self.assertEqual(limit["since"], timedelta())
        self.assertEqual(limit["used"], timedelta(hours=50))
        self.assertEqual(limit["state"], "over")
        self.assertEqual(limit["over"], timedelta(hours=2))

    def test_the_two_lengths_of_the_bar_add_up_to_the_whole(self):
        self._worked(12, offset=0)
        self._paid_at(1, hours=12)
        self._worked(6, offset=1)

        limit = _limit_for(self.user, self.job)
        self.assertEqual(limit["settled"] + limit["since"], limit["used"])
        self.assertAlmostEqual(
            limit["settled_percent"] + limit["since_percent"], limit["percent"], places=1
        )

    def test_a_payment_before_this_period_does_not_reset_it(self):
        self._worked(5, offset=0)
        self._paid_at(-7, hours=99)

        limit = _limit_for(self.user, self.job)
        self.assertIsNone(limit["paid_at"])
        self.assertEqual(limit["since"], limit["used"])

    def test_the_bar_says_what_the_reset_does_not_excuse(self):
        self._worked(5, offset=0)
        self._paid_at(1, hours=5)

        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("Counting again from your payment", html)
        # The reset is a place to count from, and the bar has to say so.
        self.assertIn("still counts toward this", html)
        self.assertIn("5h used so far", html)


class MonthStatementTests(TestCase):
    """
    A month as a PDF, to hold next to the money.

    Being paid sets the running total back to zero, so the figure somebody
    wants to check against a bank line is gone by the time the line appears.
    The statement is that figure kept.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.today = timezone.localdate()
        self.job = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=26, tax_rate=15
        )
        start = timezone.now() - timedelta(hours=6)
        self.shift = Shift.objects.create(
            user=self.user, workplace=self.job, clock_in=start,
            clock_out=start + timedelta(hours=5), status=Shift.Status.COMPLETED,
        )

    def _url(self, day=None):
        day = day or self.today
        return reverse("timeclock:statement", args=[day.year, day.month])

    def test_the_month_downloads_as_a_pdf(self):
        response = self.client.get(self._url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF-"))
        self.assertTrue(response.content.rstrip().endswith(b"%%EOF"))

    def test_the_filename_sorts_by_month(self):
        response = self.client.get(self._url())
        self.assertIn(
            f'filename="MyWork-statement-{self.today:%Y-%m}.pdf"',
            response["Content-Disposition"],
        )

    def test_one_job_can_be_reconciled_on_its_own(self):
        response = self.client.get(self._url(), {"workplace": self.job.pk})
        self.assertIn("fresh-meat", response["Content-Disposition"])

    def test_a_month_that_is_not_a_month_is_not_found(self):
        self.assertEqual(self.client.get("/timesheet/pay/statement/2026/13/").status_code, 404)

    def test_a_month_with_nothing_in_it_still_renders(self):
        response = self.client.get(self._url(date(2019, 2, 1)))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"%PDF-"))

    def test_it_cannot_be_pointed_at_someone_elses_job(self):
        other = User.objects.create_user("someone", password="pw")
        theirs = Workplace.objects.create(user=other, name="Theirs")

        response = self.client.get(self._url(), {"workplace": theirs.pk})
        self.assertEqual(response.status_code, 404)

    def test_signing_out_closes_it(self):
        self.client.logout()
        response = self.client.get(self._url())
        self.assertEqual(response.status_code, 302)
        self.assertIn(settings.LOGIN_URL, response["Location"])


# A real payslip's shape: a "this pay" column beside a year-to-date one, with
# the period and the payment day printed on the same line as each other.
SAMPLE_SLIP = """
ASIAN UNITED FOOD SERVICE PTY LTD        ABN 12 345 678 901
Employee: KIRAN LAMA
Pay Period: 13/08/2026 to 26/08/2026      Payment Date: 26/08/2026

Description          Units      Rate     This Pay        YTD
Ordinary Hours     51.78335    33.25     1,721.80     18,940.20
Gross                                    1,721.80     18,940.20
PAYG Withholding                           186.00      2,046.00
NET PAY                                  1,535.80     16,894.20
Superannuation                             198.01      2,178.11
"""


class PayslipReadingTests(TestCase):
    """
    Getting the figures off the paper.

    A payslip almost always prints two columns, and the label sits on a line
    with both of them. Nothing here trusts column position: the reading that
    gets believed is the one where gross − tax actually comes to net, which is
    the same check a person does with a thumb on the page.
    """

    def test_a_two_column_slip_reads_this_pay_not_the_year(self):
        read = payslip_reader.parse(SAMPLE_SLIP)

        self.assertEqual(read["gross"], Decimal("1721.80"))
        self.assertEqual(read["tax"], Decimal("186.00"))
        self.assertEqual(read["net"], Decimal("1535.80"))
        self.assertTrue(read["balanced"])

    def test_the_year_to_date_column_printed_first_changes_nothing(self):
        read = payslip_reader.parse("""
            Period: 13/08/2026 to 26/08/2026
                              YTD        This Pay
            Gross         18940.20        1721.80
            Tax            2046.00         186.00
            Net           16894.20        1535.80
        """)
        # Both columns balance. A payslip's own pay is never larger than its
        # year to date, and that is what settles it.
        self.assertEqual(read["gross"], Decimal("1721.80"))
        self.assertEqual(read["net"], Decimal("1535.80"))

    def test_a_line_labelled_year_to_date_is_left_out_of_it(self):
        read = payslip_reader.parse("""
            Week Ending 26/08/2026
            Gross 1263.50
            Tax Withheld 154.00
            YTD Gross 18940.20 Tax 2046.00
        """)
        self.assertEqual(read["gross"], Decimal("1263.50"))
        self.assertEqual(read["tax"], Decimal("154.00"))

    def test_a_missing_third_figure_is_worked_out_from_the_other_two(self):
        read = payslip_reader.parse(
            "Week Ending 26/08/2026\nGross Pay 1263.50\nTax Withheld 154.00"
        )
        self.assertEqual(read["net"], Decimal("1109.50"))
        self.assertTrue(read["balanced"])

    def test_the_period_and_the_payment_day_share_a_line(self):
        read = payslip_reader.parse(SAMPLE_SLIP)

        self.assertEqual(read["period_start"], date(2026, 8, 13))
        self.assertEqual(read["period_end"], date(2026, 8, 26))
        self.assertEqual(read["paid_on"], date(2026, 8, 26))

    def test_a_date_with_nothing_saying_what_it_is_is_ignored(self):
        # An ABN registration date is not a pay period.
        read = payslip_reader.parse(
            "Registered 01/07/1998\nGross 100.00\nTax 10.00\nNet 90.00"
        )
        self.assertIsNone(read["period_start"])
        self.assertIsNone(read["period_end"])

    def test_hours_and_rate_come_off_an_earnings_line(self):
        read = payslip_reader.parse(
            "Ordinary Earnings 51.7834 hrs @ $33.2500 $1,721.80\n"
            "Taxable Earnings 1721.80\nPAYG Tax 186.00\nNET PAY 1535.80"
        )
        self.assertEqual(read["hours"], Decimal("51.7834"))
        self.assertEqual(read["rate"], Decimal("33.2500"))
        self.assertTrue(read["hours_check"])

    def test_the_withheld_share_is_what_the_tax_field_asks_for(self):
        self.assertEqual(
            payslip_reader.withheld_percent(Decimal("1721.80"), Decimal("186.00")),
            Decimal("10.80"),
        )

    def test_nothing_legible_is_not_a_payslip(self):
        with self.assertRaises(payslip_reader.Unreadable):
            payslip_reader.text_from(
                SimpleUploadedFile("blank.png", b"", content_type="image/png")
            )


def _slip_pdf(text):
    """A one-page PDF carrying `text`, the way payroll would email one."""
    from io import BytesIO

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buffer = BytesIO()
    page = canvas.Canvas(buffer, pagesize=A4)
    page.setFont("Courier", 10)
    y = 780
    for line in text.strip().splitlines():
        page.drawString(40, y, line)
        y -= 15
    page.save()
    return buffer.getvalue()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="mywork-test-media-"))
class PayslipFlowTests(TestCase):
    """
    Upload a payslip, read it, check it, and let the job learn from it.

    The order matters: nothing a machine read off a file counts anywhere else
    in MyWork until a person who can see the paper has confirmed it.
    """

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(settings.MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.job = Workplace.objects.create(
            user=self.user, name="AUFS", hourly_rate=Decimal("30.00")
        )

    def _upload(self, content=None, name="payslip.pdf", kind="application/pdf"):
        return self.client.post(
            reverse("timeclock:payslip_upload", args=[self.job.pk]),
            {"file": SimpleUploadedFile(
                name, content if content is not None else _slip_pdf(SAMPLE_SLIP),
                content_type=kind,
            )},
            follow=True,
        )

    def _worked(self, hours, day):
        start = timezone.make_aware(
            datetime.combine(day, time(9)), timezone.get_current_timezone()
        )
        Shift.objects.create(
            user=self.user, workplace=self.job, clock_in=start,
            clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    # ---- reading ---------------------------------------------------------

    def test_uploading_a_payslip_reads_its_figures(self):
        self._upload()
        slip = Payslip.objects.get()

        self.assertEqual(slip.gross, Decimal("1721.80"))
        self.assertEqual(slip.tax, Decimal("186.00"))
        self.assertEqual(slip.net, Decimal("1535.80"))
        self.assertEqual(slip.period_start, date(2026, 8, 13))
        self.assertEqual(slip.source, Payslip.Source.PDF)
        self.assertTrue(slip.adds_up)

    def test_the_take_home_figure_comes_off_the_slip(self):
        self._upload()
        self.assertEqual(Payslip.objects.get().take_home, Decimal("1535.80"))

    def test_nothing_is_trusted_until_a_person_confirms_it(self):
        response = self._upload()
        slip = Payslip.objects.get()

        self.assertFalse(slip.confirmed)
        self.assertTrue(slip.needs_checking)
        self.assertContains(response, "check every figure against the paper")

    def test_confirming_the_figures_marks_it_checked(self):
        self._upload()
        slip = Payslip.objects.get()

        self.client.post(reverse("timeclock:payslip_detail", args=[slip.pk]), {
            "period_start": "2026-08-13", "period_end": "2026-08-26",
            "paid_on": "2026-08-26", "hours": "51.7834", "rate": "33.25",
            "gross": "1721.80", "tax": "186.00", "net": "1535.80",
            "super_amount": "198.01",
        })
        slip.refresh_from_db()

        self.assertTrue(slip.confirmed)
        self.assertFalse(slip.needs_checking)

    def test_a_correction_sticks(self):
        self._upload()
        slip = Payslip.objects.get()

        self.client.post(reverse("timeclock:payslip_detail", args=[slip.pk]), {
            "period_start": "2026-08-13", "period_end": "2026-08-26",
            "gross": "1800.00", "tax": "200.00", "net": "1600.00",
        })
        slip.refresh_from_db()
        self.assertEqual(slip.gross, Decimal("1800.00"))

    # ---- checking it against your own record -----------------------------

    def test_it_is_checked_against_the_hours_you_recorded(self):
        self._upload()
        slip = Payslip.objects.get()
        # Two eight-hour days inside the period the slip covers.
        self._worked(8, date(2026, 8, 14))
        self._worked(8, date(2026, 8, 15))

        html = self.client.get(
            reverse("timeclock:payslip_detail", args=[slip.pk])
        ).content.decode()

        self.assertIn("Against your timesheet", html)
        self.assertIn("You recorded", html)
        self.assertIn("16h", html)

    def test_being_paid_for_less_than_you_worked_is_said_plainly(self):
        self._upload()
        slip = Payslip.objects.get()
        for day in range(13, 27):
            self._worked(8, date(2026, 8, day))

        html = self.client.get(
            reverse("timeclock:payslip_detail", args=[slip.pk])
        ).content.decode()
        self.assertIn("You recorded more than they paid for", html)

    # ---- teaching the job ------------------------------------------------

    def test_applying_writes_the_withholding_onto_the_job(self):
        self._upload()
        slip = Payslip.objects.get()

        self.client.post(reverse("timeclock:payslip_apply", args=[slip.pk]))
        self.job.refresh_from_db()

        self.assertEqual(self.job.tax_rate, Decimal("10.80"))
        self.assertEqual(self.job.hourly_rate, Decimal("33.25"))
        # And from then on every figure for this job is after tax.
        self.assertTrue(self.job.withholds)

    def test_applying_twice_changes_nothing_the_second_time(self):
        self._upload()
        slip = Payslip.objects.get()
        self.client.post(reverse("timeclock:payslip_apply", args=[slip.pk]))
        self.client.post(reverse("timeclock:payslip_apply", args=[slip.pk]))

        self.job.refresh_from_db()
        self.assertEqual(self.job.tax_rate, Decimal("10.80"))

    # ---- what may go wrong ------------------------------------------------

    def test_a_file_that_is_not_a_payslip_is_refused(self):
        response = self._upload(b"hello", name="notes.txt", kind="text/plain")

        self.assertEqual(Payslip.objects.count(), 0)
        self.assertContains(response, "has to be a PDF or a photo")

    def test_a_file_nothing_can_be_read_from_is_kept_anyway(self):
        # Losing somebody's payslip because a photo came out badly would be a
        # worse answer than keeping it with empty boxes to type into.
        self._upload(_slip_pdf("."), name="blurry.pdf")

        slip = Payslip.objects.get()
        self.assertIsNone(slip.gross)
        self.assertTrue(slip.file)

    # ---- whose it is ------------------------------------------------------

    def test_a_stranger_cannot_reach_the_page_or_the_file(self):
        self._upload()
        slip = Payslip.objects.get()

        self.client.force_login(User.objects.create_user("someone", password="pw"))
        self.assertEqual(
            self.client.get(reverse("timeclock:payslip_detail", args=[slip.pk])).status_code, 404
        )
        self.assertEqual(
            self.client.get(reverse("timeclock:payslip_file", args=[slip.pk])).status_code, 404
        )

    def test_the_file_is_served_to_its_owner(self):
        self._upload()
        slip = Payslip.objects.get()

        response = self.client.get(reverse("timeclock:payslip_file", args=[slip.pk]))
        self.assertEqual(response.status_code, 200)

    def test_signing_out_closes_the_lot(self):
        self._upload()
        slip = Payslip.objects.get()
        self.client.logout()

        for name, args in (
            ("timeclock:payslips", []),
            ("timeclock:payslip_detail", [slip.pk]),
            ("timeclock:payslip_file", [slip.pk]),
            ("timeclock:payslip_upload", [self.job.pk]),
        ):
            response = self.client.get(reverse(name, args=args))
            self.assertEqual(response.status_code, 302, name)

    def test_removing_it_takes_the_file_with_it(self):
        self._upload()
        slip = Payslip.objects.get()

        self.client.post(reverse("timeclock:payslip_delete", args=[slip.pk]))
        self.assertEqual(Payslip.objects.count(), 0)


class LiveFilterTests(TestCase):
    """
    Switching jobs on the timesheet swaps what's below the filter, not the
    filter itself.

    The swap is done in the browser, so what is guaranteed here is the shape
    the script relies on: a marked region holding everything the filter
    decides, a marked chip row sitting outside it, and a server that answers
    the chip's own URL with exactly the page a full load would have given.
    Break any of those and the enhancement has to fall back — which it does,
    to an ordinary link, which is why these are links.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.capped = Workplace.objects.create(
            user=self.user, name="AUFS Meats", hourly_rate=Decimal("33.25"),
            hours_limit=48, limit_period=Workplace.Period.FORTNIGHT,
        )
        self.other = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=Decimal("26.50")
        )
        self._worked(self.capped, 8)
        self._worked(self.other, 5)

    def _worked(self, workplace, hours):
        start = timezone.localtime(timezone.now()).replace(
            hour=9, minute=0, second=0, microsecond=0
        ) - timedelta(days=1)
        Shift.objects.create(
            user=self.user, workplace=workplace,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def _page(self, workplace=None):
        params = {"workplace": workplace.pk} if workplace else {}
        return self.client.get(reverse("timeclock:timesheet"), params).content.decode()

    def _swapped(self, html):
        """The part the script replaces — everything the filter decides."""
        return html[html.index('id="sheet"'):html.index("</main>")]

    def test_the_page_carries_the_two_marks_the_swap_needs(self):
        html = self._page()
        self.assertIn('id="sheet"', html)
        self.assertIn('data-live-filter="sheet"', html)

    def test_the_filter_sits_outside_the_part_that_gets_replaced(self):
        # If the chips were inside it they would vanish mid-swap, which is
        # the whole thing this is meant to stop.
        html = self._page()
        before = html[html.index("data-live-filter"):html.index('id="sheet"')]
        self.assertNotIn("chip--link", self._swapped(html))
        self.assertIn("chip--link", before)

    def test_exactly_one_job_is_marked_as_chosen(self):
        for page in (self._page(), self._page(self.capped), self._page(self.other)):
            self.assertEqual(page.count("chip--link is-on"), 1)

    def test_each_job_answers_with_only_its_own_work(self):
        mine = self._swapped(self._page(self.capped))
        theirs = self._swapped(self._page(self.other))

        self.assertIn("AUFS Meats", mine)
        self.assertNotIn("Fresh Meat", mine)
        self.assertIn("Fresh Meat", theirs)
        self.assertNotIn("AUFS Meats", theirs)

    def test_a_cap_follows_the_filter_it_belongs_to(self):
        self.assertIn("limit at AUFS Meats", self._swapped(self._page(self.capped)))
        self.assertNotIn("limit at AUFS Meats", self._swapped(self._page(self.other)))

    def test_a_chips_url_is_a_page_in_its_own_right(self):
        # Without JavaScript the chip is followed, so it has to be a whole
        # page and not only a fragment.
        response = self.client.get(
            reverse("timeclock:timesheet"), {"workplace": self.capped.pk}
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "<title>")
        self.assertContains(response, "id=\"sheet\"")


class LiveClockPickerTests(TestCase):
    """
    The clock's workplace picker drives what depends on it.

    Choosing a job here used to change nothing until you clocked in, so the
    hours cap under the dial went on describing whichever job you had been
    looking at before — which looks like an answer rather than like a stale
    one. Now the picker stays put and the part beneath it follows.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.capped = Workplace.objects.create(
            user=self.user, name="AUFS Meats", is_default=True,
            hours_limit=48, limit_period=Workplace.Period.FORTNIGHT,
        )
        self.free = Workplace.objects.create(user=self.user, name="Fresh Meat")

    def _page(self, workplace=None):
        params = {"workplace": workplace.pk} if workplace else {}
        return self.client.get(reverse("timeclock:dashboard"), params).content.decode()

    def _swapped(self, html):
        return html[html.index('id="clock-detail"'):html.index("</main>")]

    def test_the_picker_and_the_region_it_drives_are_both_marked(self):
        html = self._page()
        self.assertIn('data-live-filter="clock-detail"', html)
        self.assertIn('id="clock-detail"', html)

    def test_the_picker_sits_outside_the_part_that_gets_replaced(self):
        # Swapping the picker away mid-choice is the one thing this must not do.
        self.assertNotIn("data-live-filter", self._swapped(self._page()))

    def test_the_cap_follows_the_job_you_picked(self):
        self.assertIn("limit at AUFS Meats", self._swapped(self._page(self.capped)))
        self.assertNotIn("AUFS Meats", self._swapped(self._page(self.free)))

    def test_picking_one_is_remembered_for_next_time(self):
        self.client.get(reverse("timeclock:dashboard"), {"workplace": self.free.pk})
        self.assertNotIn("AUFS Meats", self._swapped(self._page()))

    def test_a_running_shift_has_no_picker_to_drive_it(self):
        # The job is settled the moment you clock in; there is nothing to pick.
        Shift.objects.create(
            user=self.user, workplace=self.capped,
            clock_in=timezone.now() - timedelta(hours=1),
            status=Shift.Status.WORKING,
        )
        html = self._page()
        self.assertNotIn("data-live-filter", html)
        self.assertIn('id="clock-detail"', html)

    def test_one_workplace_needs_no_picker_either(self):
        Workplace.objects.filter(pk=self.free.pk).delete()
        self.assertNotIn("data-live-filter", self._page())


class PaidUpToADateTests(TestCase):
    """
    Naming the date the money stopped at.

    Wages are remembered as "he paid me up to the Saturday" far more often
    than as a number of hours, so a date is a thing somebody can actually
    answer. Everything worked on or before it stops being owed, the count
    starts again from zero the next day, and the timesheet behind the line is
    untouched — which is why the line can be rubbed out again.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.today = timezone.localdate()
        self.job = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=Decimal("26.00")
        )
        # Five hours a day, every other day, for a week and a half.
        self.days = [self.today - timedelta(days=n) for n in (9, 7, 5, 3, 1)]
        for day in self.days:
            self._worked(day)

    def _worked(self, day, hours=5, at=9):
        start = timezone.make_aware(
            datetime.combine(day, time(at)), timezone.get_current_timezone()
        )
        return Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def _owed(self):
        job = Workplace.objects.prefetch_related("payments").get(pk=self.job.pk)
        return _pay_state(job)["worked"]

    def _paid_up_to(self, day):
        return self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"up_to": day.isoformat()}, follow=True,
        )

    def test_the_date_is_inclusive(self):
        # Paid up to the middle day settles that day too, leaving the two
        # after it. Off by one here clears a shift nobody paid for.
        self._paid_up_to(self.days[2])
        self.assertEqual(self._owed(), timedelta(hours=10))

    def test_the_count_starts_again_from_zero_the_next_day(self):
        self._paid_up_to(self.days[-1])
        self.assertEqual(self._owed(), timedelta())

        self._worked(self.today)
        self.assertEqual(self._owed(), timedelta(hours=5))

    def test_the_shifts_behind_the_line_are_untouched(self):
        self._paid_up_to(self.days[2])
        self.assertEqual(Shift.objects.filter(workplace=self.job).count(), 5)

    def test_it_can_be_taken_back(self):
        before = self._owed()
        self._paid_up_to(self.days[2])
        self.client.post(reverse("timeclock:payment_undo", args=[self.job.pk]))
        self.assertEqual(self._owed(), before)

    def test_a_date_with_nothing_before_it_says_so(self):
        response = self._paid_up_to(self.today - timedelta(days=60))

        self.assertEqual(self._owed(), timedelta(hours=25))
        self.assertContains(response, "Nothing unpaid at Fresh Meat on or before")

    def test_a_date_that_is_not_a_date_changes_nothing(self):
        self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"up_to": "the saturday"}, follow=True,
        )
        self.assertEqual(self._owed(), timedelta(hours=25))

    def test_the_screen_offers_a_date_box(self):
        html = self.client.get(
            reverse("timeclock:payment_choose", args=[self.job.pk])
        ).content.decode()
        self.assertIn('name="up_to"', html)
        self.assertIn("Paid up to and including", html)


class PaidUpToADateOnACycleTests(TestCase):
    """
    The same date, on a job whose pay runs in fortnights.

    Its run buttons settle a whole run, which is right when a whole run is
    what was paid for. When the money stopped somewhere inside one — up to the
    Saturday of a fortnight that runs to the Wednesday — the date has to be
    sayable outright, and saying it settles whatever it covers however many
    runs that spans.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.today = timezone.localdate()
        self.job = Workplace.objects.create(
            user=self.user, name="AUFS", hourly_rate=Decimal("33.25"),
            pay_cycle=PayCycle.FORTNIGHT,
            fortnight_anchor=self.today - timedelta(days=self.today.weekday() + 18),
        )
        for n in range(1, 22, 2):
            self._worked(self.today - timedelta(days=n))

    def _worked(self, day, hours=4):
        start = timezone.make_aware(
            datetime.combine(day, time(9)), timezone.get_current_timezone()
        )
        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def _state(self):
        job = Workplace.objects.prefetch_related("payments").get(pk=self.job.pk)
        return _pay_state(job)

    def test_a_date_settles_everything_before_it_whatever_run_it_lands_in(self):
        cutoff = self.today - timedelta(days=6)
        self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"up_to": cutoff.isoformat()}, follow=True,
        )

        left = [
            shift for shift in Shift.objects.filter(workplace=self.job)
            if timezone.localtime(shift.clock_in).date() > cutoff
        ]
        self.assertEqual(
            self._state()["worked"],
            sum((shift.worked_duration for shift in left), timedelta()),
        )

    def test_a_run_button_still_records_a_run_and_not_a_sweep(self):
        # The two must stay different: a run says where it started, so paying
        # a later fortnight first cannot swallow an earlier unpaid one.
        run = self._state()["due"][0]
        self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"through": run["end"].isoformat()}, follow=True,
        )
        payment = Payment.objects.filter(workplace=self.job).latest("created_at")
        self.assertIsNotNone(payment.covers_from)

    def test_a_date_records_a_sweep(self):
        self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"up_to": (self.today - timedelta(days=6)).isoformat()}, follow=True,
        )
        payment = Payment.objects.filter(workplace=self.job).latest("created_at")
        self.assertIsNone(payment.covers_from)

    def test_the_screen_is_open_to_a_job_on_a_cycle(self):
        response = self.client.get(
            reverse("timeclock:payment_choose", args=[self.job.pk])
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'name="up_to"')
        # But not the one-tap sweep: a job with runs has to name what it means.
        self.assertNotContains(response, "Everything up to now")
