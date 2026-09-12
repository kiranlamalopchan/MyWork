import os
import re
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
from .models import (
    Break,
    fortnight_anchor_for,
    fortnight_start,
    PaidIn,
    PayCycle,
    Payment,
    Shift,
    TimePreference,
    Weekday,
    Workplace,
    month_start,
    next_month_start,
    week_start,
)
from .views import SESSION_WORKPLACE, _limit_for, _limits_for, _midnight, _pay_state


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

    def test_removing_a_workplace_takes_its_shifts_with_it(self):
        w = Workplace.objects.create(user=self.user, name="A")
        Shift.objects.create(user=self.user, workplace=w, clock_in=timezone.now())

        w.remove()

        self.assertFalse(Workplace.objects.filter(name="A").exists())
        # Shifts point at a workplace with SET_NULL, so leaving them would
        # leave work done nowhere in particular. Removing the job removes it.
        self.assertEqual(Shift.objects.count(), 0)

    def test_removing_an_unused_workplace(self):
        w = Workplace.objects.create(user=self.user, name="A")
        w.remove()
        self.assertFalse(Workplace.objects.filter(pk=w.pk).exists())
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
        for name in ["timesheet", "workplaces", "workplace_create", "more"]:
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

    SYDNEY = zoneinfo.ZoneInfo("Australia/Sydney")

    def _stamp(self, moment):
        """
        Format a moment the way app.js does: the phone's own wall time with
        the phone's own UTC offset on the end.

        The offset comes from the zone rather than being written down, so this
        is right in August (+10:00) and in January (+11:00) alike.
        """
        return moment.astimezone(self.SYDNEY).isoformat()

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
        """
        09:00 in Sydney is 23:00 UTC the day before. The offset on the end of
        the string has to be read; taking the digits and calling them UTC
        files the shift ten hours out.

        Anchored to now rather than to a date written down. A fixed date is a
        test with a fuse in it: `_client_now` discards any stamp more than
        CLIENT_CLOCK_TOLERANCE_HOURS from the server's clock, so a written-down
        date silently stops testing the offset the day it goes stale, and
        starts testing the fallback instead — which is the next test's job.
        """
        moment = (timezone.now() - timedelta(minutes=5)).replace(microsecond=0)

        self.client.post(reverse("timeclock:clock_in"), {
            "workplace": self.workplace.pk,
            "client_time": self._stamp(moment),
            "client_tz": "Australia/Sydney",
        })

        shift = Shift.open_for(self.user)
        self.assertEqual(shift.clock_in, moment)

        # And emphatically not the wall-clock digits read as UTC, which is
        # where ignoring the offset lands you — ten or eleven hours away.
        local = moment.astimezone(self.SYDNEY)
        digits_as_utc = local.replace(tzinfo=zoneinfo.ZoneInfo("UTC"))
        self.assertNotEqual(shift.clock_in, digits_as_utc)

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

    def test_every_page_renders_with_the_tab_bar_and_the_profile_menu(self):
        pages = [
            ("home", []),
            ("timeclock:dashboard", []),
            ("timeclock:timesheet", []),
            ("timeclock:calendar", []),
            ("timeclock:more", []),
            ("timeclock:workplaces", []),
            ("timeclock:workplace_create", []),
            ("timeclock:workplace_edit", [self.workplace.pk]),
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
                # One tab bar for the whole app, the hub included.
                self.assertIn('class="tabbar__inner"', html)
                self.assertIn('class="tab__label">Home</span>', html)
                self.assertIn('class="tab__label">More</span>', html)
                # Alerts is the bell in the app bar, not a tab.
                self.assertNotIn('class="tab__label">Alerts</span>', html)
                self.assertIn('class="appbar__bell"', html)
                # The menu in the corner is yours alone; apps are not in it.
                self.assertIn('id="profile-menu"', html)
                self.assertNotIn('id="app-switcher"', html)
                self.assertNotIn(">Apps</div>", html)
                # PLU's own places are a segmented control on its pages.
                # The hub has no app and so no segments, and TimeSheet has
                # none either: its places are tabs of the dock.
                if name.startswith("plu:"):
                    self.assertIn('class="segments segments--places"', html)
                else:
                    self.assertNotIn('class="segments segments--places"', html)

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
            "fortnight_starts_on": Weekday.MONDAY, "fortnight_phase": "this",
            "month_starts_on": "15",
        })
        self.assertEqual(resp.status_code, 302)

        pref = TimePreference.for_user(self.user)
        self.assertEqual(pref.week_starts_on, Weekday.MONDAY)
        self.assertEqual(pref.month_starts_on, 15)
        self.assertEqual(pref.fortnight_anchor.weekday(), Weekday.MONDAY)

        resp = self.client.post(
            reverse("timeclock:workplace_edit", args=[self.workplace.pk]),
            {
                "name": "Courtlands", "address": "", "hourly_rate": "",
                "hours_limit": "38", "limit_period": Workplace.Period.MONTH,
                "week_starts_on": Weekday.SUNDAY,
                "fortnight_starts_on": Weekday.SUNDAY, "fortnight_phase": "this",
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
            "fortnight_starts_on": Weekday.SUNDAY, "fortnight_phase": "this",
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
        self.assertIn("Thursday → Wednesday", form.fields["fortnight_phase"].help_text)
        # And the fortnight is asked for as a weekday and a this-week-or-
        # last, never as a date: the date is the model's to keep.
        self.assertNotIn("fortnight_anchor", form.fields)
        self.assertEqual(form.fields["fortnight_starts_on"].initial, Weekday.THURSDAY)

    def test_the_fortnight_is_set_from_a_weekday_and_which_week_it_began(self):
        today = timezone.localdate()
        job = Workplace.objects.create(user=self.user, name="AUFS")

        def save(starts_on, phase):
            resp = self.client.post(
                reverse("timeclock:workplace_edit", args=[job.pk]),
                {
                    "name": "AUFS", "address": "", "hourly_rate": "",
                    "hours_limit": "48", "limit_period": Workplace.Period.FORTNIGHT,
                    "week_starts_on": Weekday.SUNDAY,
                    "fortnight_starts_on": starts_on, "fortnight_phase": phase,
                    "month_starts_on": "1",
                },
            )
            self.assertEqual(resp.status_code, 302)
            job.refresh_from_db()
            return job.fortnight_anchor

        this_monday = week_start(today, Weekday.MONDAY)
        # "Mondays, and the current one began this week": the fortnight open
        # today opened on the most recent Monday.
        self.assertEqual(save(Weekday.MONDAY, "this"), this_monday)
        self.assertEqual(job.limit_window(today)[0], this_monday)
        # "...began last week": the one before, so today is in its second
        # week and the count resets next Monday.
        self.assertEqual(save(Weekday.MONDAY, "last"), this_monday - timedelta(days=7))
        self.assertEqual(job.limit_window(today)[1], this_monday + timedelta(days=7))
        # Any weekday works the same way.
        self.assertEqual(save(Weekday.FRIDAY, "this").weekday(), Weekday.FRIDAY)

    def test_the_form_reads_the_choice_back_off_the_stored_date(self):
        today = timezone.localdate()
        this_thursday = week_start(today, Weekday.THURSDAY)
        job = Workplace.objects.create(
            user=self.user, name="AUFS", fortnight_anchor=this_thursday - timedelta(days=21)
        )
        # Anchored three weeks back: the fortnight open today began last
        # week, and that is what the form shows — not a date to work out.
        form = WorkplaceForm(instance=job, user=self.user)
        self.assertEqual(form.fields["fortnight_starts_on"].initial, Weekday.THURSDAY)
        self.assertEqual(form.fields["fortnight_phase"].initial, "last")
        job.fortnight_anchor = this_thursday - timedelta(days=28)
        self.assertEqual(
            WorkplaceForm(instance=job, user=self.user).fields["fortnight_phase"].initial, "this"
        )

    def test_the_cap_resets_on_its_own_when_the_next_fortnight_opens(self):
        today = timezone.localdate()
        job = Workplace.objects.create(
            user=self.user, name="AUFS", hours_limit=48,
            limit_period=Workplace.Period.FORTNIGHT,
            fortnight_anchor=fortnight_anchor_for(Weekday.THURSDAY, started_last_week=False, today=today),
        )
        start, end = job.limit_window(today)
        # Fourteen days on, the window is the next one, from the same weekday.
        later = job.limit_window(today + timedelta(days=14))
        self.assertEqual(later, (start + timedelta(days=14), end + timedelta(days=14)))
        self.assertEqual(later[0].weekday(), Weekday.THURSDAY)
        # And the card says so: the day the count starts again is on it.
        html = self.client.get(reverse("timeclock:dashboard")).content.decode()
        self.assertIn("resets " + end.strftime("%a %-d %b"), html)

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


class StatementTests(TestCase):
    """
    A stretch of the record as a PDF, laid out like a payslip.

    Being paid sets the running total back to zero, so the figure somebody
    wants to check against a bank line is gone by the time the line appears.
    The statement is that figure kept — for any dates, one job or all, asked
    for from the profile.
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

    def _get(self, **params):
        return self.client.get(reverse("timeclock:statement"), params)

    def test_the_period_downloads_as_a_pdf(self):
        response = self._get(**{"from": self.today.replace(day=1).isoformat(), "to": self.today.isoformat()})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF-"))
        self.assertTrue(response.content.rstrip().endswith(b"%%EOF"))

    def test_no_dates_means_this_month_so_far(self):
        response = self._get()
        first = self.today.replace(day=1)
        self.assertIn(
            f'filename="MyWork-statement-{first:%Y-%m-%d}-to-{self.today:%Y-%m-%d}.pdf"',
            response["Content-Disposition"],
        )

    def test_one_job_can_be_reconciled_on_its_own(self):
        response = self._get(workplace=self.job.pk)
        self.assertIn("fresh-meat", response["Content-Disposition"])

    def test_a_range_that_is_not_one_is_sent_back_to_the_profile(self):
        for params in [
            {"from": "2026-09-10", "to": "2026-09-01"},   # backwards
            {"from": "2020-01-01", "to": "2026-09-01"},   # years
            {"from": "the saturday", "to": "2026-09-01"},  # not a date
        ]:
            with self.subTest(params=params):
                response = self._get(**params)
                self.assertRedirects(response, reverse("accounts:profile"))

    def test_a_period_with_nothing_in_it_still_renders(self):
        response = self._get(**{"from": "2019-02-01", "to": "2019-02-28"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"%PDF-"))

    def test_it_cannot_be_pointed_at_someone_elses_job(self):
        other = User.objects.create_user("someone", password="pw")
        theirs = Workplace.objects.create(user=other, name="Theirs")

        response = self._get(workplace=theirs.pk)
        self.assertEqual(response.status_code, 404)

    def test_signing_out_closes_it(self):
        self.client.logout()
        response = self._get()
        self.assertEqual(response.status_code, 302)
        self.assertIn(settings.LOGIN_URL, response["Location"])

    def test_the_profile_carries_the_form_and_the_calendar_does_not(self):
        html = self.client.get(reverse("accounts:profile")).content.decode()
        self.assertIn('action="' + reverse("timeclock:statement") + '"', html)
        self.assertIn('name="from"', html)
        self.assertIn('name="to"', html)
        # One workplace: nothing to choose between.
        self.assertNotIn('name="workplace"', html)
        Workplace.objects.create(user=self.user, name="AUFS")
        html = self.client.get(reverse("accounts:profile")).content.decode()
        self.assertIn('name="workplace"', html)
        # And the calendar no longer offers the month: one place for it.
        calendar = self.client.get(reverse("timeclock:calendar")).content.decode()
        self.assertNotIn("as a PDF", calendar)
        self.assertNotIn(reverse("timeclock:statement"), calendar)

    def test_the_label_reads_as_a_month_or_a_span(self):
        from .views import _period_label
        self.assertEqual(_period_label(date(2026, 9, 1), date(2026, 9, 30)), "September 2026")
        self.assertEqual(_period_label(date(2026, 9, 6), date(2026, 9, 19)), "6 – 19 Sep 2026")
        self.assertEqual(_period_label(date(2026, 8, 28), date(2026, 9, 3)), "28 Aug – 3 Sep 2026")
        self.assertEqual(_period_label(date(2025, 12, 29), date(2026, 1, 4)), "29 Dec 2025 – 4 Jan 2026")


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

    def test_the_pay_card_asks_what_the_payment_covered_in_one_form(self):
        html = self.client.get(reverse("timeclock:payments")).content.decode()
        # One form per job: a list of what the money covered, with the date
        # box as one of its answers — not a button here and a page of other
        # ways there.
        self.assertEqual(html.count('data-settle="Fresh Meat"'), 1)
        self.assertIn('<option value="now"', html)
        self.assertIn('<option value="date">', html)
        self.assertIn('name="up_to"', html)
        self.assertIn("Paid up to and including", html)
        self.assertNotIn("payment_choose", html)
        self.assertNotIn("/covers/", html)

    def test_the_form_s_own_answers_draw_the_line(self):
        post = lambda **data: self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]), data, follow=True
        )
        # A day named: inclusive, as the box says.
        post(covers="date", up_to=self.days[2].isoformat())
        self.assertEqual(self._owed(), timedelta(hours=10))
        # "date" with the box empty is a form to reject, not a sweep to now.
        post(covers="date", up_to="")
        self.assertEqual(self._owed(), timedelta(hours=10))
        # Everything up to now.
        post(covers="now")
        self.assertEqual(self._owed(), timedelta())


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

    def test_the_card_lists_the_runs_as_the_answers_and_never_a_sweep_to_now(self):
        html = self.client.get(reverse("timeclock:payments")).content.decode()
        state = self._state()
        # Each run that is owed is an answer, oldest first — the order the
        # money arrives in — and a day can still be named outright.
        for run in state["due"]:
            self.assertIn(f'<option value="run:{run["end"].isoformat()}"', html)
        self.assertIn('<option value="date">', html)
        # But not "everything up to now": a job with runs has to name one.
        self.assertNotIn('<option value="now"', html)
        # And the runs are read out on the card, the open one with them.
        self.assertIn('class="runs"', html)
        self.assertIn("This fortnight", html)

    def test_a_run_answer_from_the_form_records_that_run(self):
        run = self._state()["due"][0]
        self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]),
            {"covers": f"run:{run['end'].isoformat()}"}, follow=True,
        )
        payment = Payment.objects.filter(workplace=self.job).latest("created_at")
        self.assertEqual(payment.covers_from, _midnight(run["start"]))
        self.assertEqual(payment.hours, round(run["hours"], 2))


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="mywork-remove-media-"))
class WorkplaceRemovalTests(TestCase):
    """
    Removing a workplace removes what was recorded at it.

    Every trace: the shifts, the breaks inside them, the payments drawn under
    them. Nothing
    is left pointing at a job that is gone, and nothing belonging to any other
    job is touched.
    """

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(settings.MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.going = Workplace.objects.create(
            user=self.user, name="Fresh Meat", hourly_rate=Decimal("26.00")
        )
        self.staying = Workplace.objects.create(user=self.user, name="AUFS")

        self.shift = self._worked(self.going, 5)
        self.shift.breaks.create(
            break_start=self.shift.clock_in + timedelta(hours=2),
            break_end=self.shift.clock_in + timedelta(hours=2, minutes=30),
        )
        self._worked(self.staying, 3)

        Payment.objects.create(
            workplace=self.going, covers_through=timezone.now(), hours=Decimal("5.00")
        )

    def _worked(self, workplace, hours):
        start = timezone.now() - timedelta(days=1, hours=hours)
        return Shift.objects.create(
            user=self.user, workplace=workplace,
            clock_in=start, clock_out=start + timedelta(hours=hours),
            status=Shift.Status.COMPLETED,
        )

    def _remove(self):
        return self.client.post(
            reverse("timeclock:workplace_delete", args=[self.going.pk]), follow=True
        )

    # ---- what goes -------------------------------------------------------

    def test_it_takes_the_shifts_the_breaks_and_the_payments(self):
        self._remove()

        self.assertFalse(Workplace.objects.filter(pk=self.going.pk).exists())
        self.assertFalse(Shift.objects.filter(workplace_id=self.going.pk).exists())
        self.assertEqual(Break.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)

    def test_no_shift_is_left_behind_with_no_workplace(self):
        # SET_NULL would otherwise leave the hours as work done nowhere.
        self._remove()
        self.assertEqual(Shift.objects.filter(workplace__isnull=True).count(), 0)

    def test_the_other_job_is_untouched(self):
        self._remove()

        self.assertTrue(Workplace.objects.filter(pk=self.staying.pk).exists())
        self.assertEqual(Shift.objects.filter(workplace=self.staying).count(), 1)

    def test_it_says_what_it_took(self):
        response = self._remove()
        self.assertContains(response, "Removed Fresh Meat and 1 shift")

    # ---- the screen in front of it ---------------------------------------

    def test_the_confirm_screen_counts_what_would_go(self):
        html = self.client.get(
            reverse("timeclock:workplace_confirm_delete", args=[self.going.pk])
        ).content.decode()

        self.assertIn("This cannot be undone", html)
        self.assertIn("What goes with it", html)
        self.assertIn("Payments marked received", html)

    def test_looking_at_the_screen_removes_nothing(self):
        self.client.get(
            reverse("timeclock:workplace_confirm_delete", args=[self.going.pk])
        )
        self.assertTrue(Workplace.objects.filter(pk=self.going.pk).exists())

    def test_the_list_sends_you_to_the_screen_rather_than_a_pop_up(self):
        html = self.client.get(reverse("timeclock:workplaces")).content.decode()
        self.assertIn(
            reverse("timeclock:workplace_confirm_delete", args=[self.going.pk]), html
        )

    # ---- what it refuses --------------------------------------------------

    def test_a_job_you_are_clocked_in_at_cannot_be_removed(self):
        Shift.objects.create(
            user=self.user, workplace=self.going,
            clock_in=timezone.now(), status=Shift.Status.WORKING,
        )
        response = self._remove()

        self.assertTrue(Workplace.objects.filter(pk=self.going.pk).exists())
        self.assertContains(response, "Clock out first")

    def test_somebody_elses_workplace_is_not_yours_to_remove(self):
        other = User.objects.create_user("someone", password="pw")
        theirs = Workplace.objects.create(user=other, name="Theirs")

        response = self.client.post(
            reverse("timeclock:workplace_delete", args=[theirs.pk])
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Workplace.objects.filter(pk=theirs.pk).exists())

    def test_the_default_is_handed_on_rather_than_dying_with_the_job(self):
        """Removing the job the clock offers first must leave another offered.

        It used to leave a person holding two jobs and no default at all, so
        the clock opened on nothing in particular.
        """
        Workplace.objects.filter(pk=self.going.pk).update(is_default=True)
        Workplace.objects.filter(pk=self.staying.pk).update(is_default=False)

        Workplace.objects.get(pk=self.going.pk).remove()

        self.assertTrue(Workplace.objects.get(pk=self.staying.pk).is_default)

    def test_the_last_job_of_all_can_still_be_removed(self):
        """With nothing to hand the default to, it simply goes."""
        Workplace.objects.filter(pk=self.staying.pk).delete()
        Workplace.objects.filter(pk=self.going.pk).update(is_default=True)

        Workplace.objects.get(pk=self.going.pk).remove()

        self.assertFalse(Workplace.objects.filter(user=self.user).exists())

    def test_a_removed_name_can_be_used_again(self):
        """Nothing keeps hold of the name once the job is gone.

        The uniqueness rule was once conditional on an archived flag, for when
        removing a job hid it instead of deleting it. Removing deletes now, so
        the name is free the moment it does.
        """
        self.going.remove()
        again = Workplace.objects.create(user=self.user, name="Fresh Meat")
        self.assertEqual(again.name, "Fresh Meat")

    def test_removing_it_forgets_it_as_the_clock_s_last_pick(self):
        # The clock remembers which job you picked. That one is gone.
        self.client.get(reverse("timeclock:dashboard"), {"workplace": self.going.pk})
        self.assertEqual(
            str(self.client.session.get(SESSION_WORKPLACE)), str(self.going.pk)
        )

        self._remove()
        self.assertIsNone(self.client.session.get(SESSION_WORKPLACE))


class SummaryFollowsThePayCycleTests(TestCase):
    """
    As many totals as you are paid over, and no more.

    Paid weekly, a fortnight's hours answer no question you have. Paid
    monthly, all three are steps on the way to the figure that arrives. A
    period you are never paid over is a number with nothing to check it
    against, so the cards stop where the pay cycle does.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)

    def _job(self, cycle, name="A"):
        job = Workplace.objects.create(
            user=self.user, name=name, hourly_rate=Decimal("30.00"), pay_cycle=cycle
        )
        start = timezone.now() - timedelta(hours=6)
        Shift.objects.create(
            user=self.user, workplace=job, clock_in=start,
            clock_out=start + timedelta(hours=5), status=Shift.Status.COMPLETED,
        )
        return job

    def _labels(self, workplace=None):
        params = {"workplace": workplace.pk} if workplace else {}
        html = self.client.get(reverse("timeclock:timesheet"), params).content.decode()
        return re.findall(r'summary-card__label">([^<]+)<', html)

    def test_paid_weekly_shows_the_week_alone(self):
        self._job(PayCycle.WEEK)
        self.assertEqual(self._labels(), ["This week"])

    def test_paid_fortnightly_shows_the_week_and_the_fortnight(self):
        self._job(PayCycle.FORTNIGHT)
        self.assertEqual(self._labels(), ["This week", "This fortnight"])

    def test_paid_monthly_shows_all_three(self):
        self._job(PayCycle.MONTH)
        self.assertEqual(self._labels(), ["This week", "This fortnight", "This month"])

    def test_a_job_with_no_cycle_counts_from_the_last_payment(self):
        # Neither a week nor a fortnight means anything at a job that pays
        # when it gets round to it. What is owed is the figure that matters,
        # and it is the one that goes to zero when the money turns up.
        self._job(PayCycle.IRREGULAR)
        self.assertEqual(self._labels(), ["Since you were paid"])

    def test_a_job_with_no_cycle_beside_one_that_has_it_shows_the_week(self):
        # Two jobs were last paid on two different days and cannot share a
        # starting line, so the shared page falls back to shared periods.
        self._job(PayCycle.IRREGULAR, name="Butcher")
        self._job(PayCycle.FORTNIGHT, name="AUFS")
        self.assertEqual(self._labels(), ["This week", "This fortnight"])

    def test_two_jobs_each_keep_their_own_periods_and_invent_none(self):
        weekly = self._job(PayCycle.WEEK, name="Weekly")
        fortnightly = self._job(PayCycle.FORTNIGHT, name="Fortnightly")

        # A week and a fortnight between them, and never a month.
        self.assertEqual(self._labels(), ["This week", "This fortnight"])
        self.assertEqual(self._labels(weekly), ["This week"])
        self.assertEqual(self._labels(fortnightly), ["This week", "This fortnight"])

    def test_a_job_that_pays_whenever_does_not_widen_the_page(self):
        # The pairing on this machine: one fortnightly job and one that pays
        # when it gets round to it. The second must not drag in a month card.
        self._job(PayCycle.FORTNIGHT, name="AUFS")
        self._job(PayCycle.IRREGULAR, name="Fresh Meat")

        self.assertEqual(self._labels(), ["This week", "This fortnight"])

    def test_the_grid_widens_to_however_many_are_left(self):
        self._job(PayCycle.WEEK)
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("summary-grid--1", html)

    def test_the_pay_breakdown_is_written_over_the_period_you_are_paid_in(self):
        job = self._job(PayCycle.WEEK)
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()

        self.assertIn("This week\u2019s pay", html)
        self.assertNotIn("This fortnight\u2019s pay", html)

    def test_a_monthly_job_is_totalled_by_the_month(self):
        self._job(PayCycle.MONTH)
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        self.assertIn("This month\u2019s pay", html)


class ClockScreenIsForClockingTests(TestCase):
    """
    The clock screen shows the clock, where you are, and the cap.

    A screen you open to press one button is not the place for figures you
    read: today's hours and the week's live on the timesheet, one tap away,
    and repeating them here made a clock into a dashboard. The cap is the
    exception, because it is the thing you want to know *before* pressing the
    button rather than after.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.job = Workplace.objects.create(
            user=self.user, name="Fresh Meat", is_default=True,
            hours_limit=48, limit_period=Workplace.Period.FORTNIGHT,
        )

    def _page(self):
        return self.client.get(reverse("timeclock:dashboard")).content.decode()

    def _clocked_in(self, hours_ago=4):
        return Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=hours_ago),
            status=Shift.Status.WORKING,
        )

    def test_the_three_buttons_are_all_there(self):
        self.assertIn(reverse("timeclock:clock_in"), self._page())

        self._clocked_in()
        working = self._page()
        self.assertIn(reverse("timeclock:start_break"), working)
        self.assertIn(reverse("timeclock:clock_out"), working)

    def test_the_totals_cards_are_gone(self):
        self._clocked_in()
        page = self._page()

        self.assertNotIn("summary-card", page)
        self.assertNotIn("This week", page)

    def test_the_shift_breakdown_row_is_gone(self):
        self._clocked_in()
        self.assertNotIn("metric-row", self._page())

    def test_the_cap_stays(self):
        self._clocked_in()
        page = self._page()

        self.assertIn("limit__track", page)
        self.assertIn("Fresh Meat · this fortnight", page)

    def test_the_break_total_moves_onto_the_dial(self):
        # It is the one figure the break button produces; losing it would
        # mean the button reported nothing.
        shift = self._clocked_in()
        shift.breaks.create(
            break_start=shift.clock_in + timedelta(hours=1),
            break_end=shift.clock_in + timedelta(hours=1, minutes=20),
        )
        page = self._page()

        self.assertIn('id="clock-break"', page)
        self.assertIn("20m", page)

    def test_a_shift_with_no_break_says_nothing_about_breaks(self):
        self._clocked_in()
        self.assertNotIn('id="clock-break"', self._page())


class CashInHandTests(TestCase):
    """
    Paid cash, there is no tax to take off.

    Not "we haven't been told the percentage" — nothing comes out at all. The
    two look the same on a screen that only knows whether a rate is set, so
    the job says which it is and every figure follows: no deduction invented,
    and no setting nagged for that has no answer.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.cash = Workplace.objects.create(
            user=self.user, name="Butcher", hourly_rate=Decimal("30.00"),
            paid_in=PaidIn.CASH, pay_cycle=PayCycle.WEEK,
        )
        self.banked = Workplace.objects.create(
            user=self.user, name="AUFS", hourly_rate=Decimal("33.25"),
            tax_rate=Decimal("10.80"), pay_cycle=PayCycle.WEEK,
        )

    def _worked(self, workplace, hours=5):
        start = timezone.now() - timedelta(hours=hours + 1)
        return Shift.objects.create(
            user=self.user, workplace=workplace, clock_in=start,
            clock_out=start + timedelta(hours=hours), status=Shift.Status.COMPLETED,
        )

    def test_cash_takes_nothing_out(self):
        pay = self.cash.pay_for(10)
        self.assertEqual(pay.gross, 300.00)
        self.assertEqual(pay.tax, 0)
        self.assertEqual(pay.net, pay.gross)

    def test_a_percentage_left_over_from_before_is_ignored(self):
        # Switched to cash with a rate already saved: what you are handed is
        # what you earned, whatever the row still says.
        Workplace.objects.filter(pk=self.cash.pk).update(tax_rate=Decimal("15.00"))
        job = Workplace.objects.get(pk=self.cash.pk)

        self.assertFalse(job.withholds)
        self.assertEqual(job.pay_for(10).tax, 0)

    def test_cash_is_not_the_same_as_a_rate_nobody_has_set(self):
        unset = Workplace.objects.create(user=self.user, name="Somewhere", hourly_rate=20)

        self.assertFalse(self.cash.withholds)
        self.assertFalse(unset.withholds)
        # But only one of them is a job with a tax answer.
        self.assertTrue(self.cash.in_cash)
        self.assertFalse(unset.in_cash)

    def test_the_shift_page_says_cash_in_hand_and_shows_no_tax(self):
        shift = self._worked(self.cash)
        html = self.client.get(
            reverse("timeclock:shift_detail", args=[shift.pk])
        ).content.decode()

        self.assertIn("Cash in hand", html)
        self.assertNotIn("Tax withheld", html)

    def test_a_cash_week_is_not_nagged_for_a_percentage(self):
        self._worked(self.cash)
        html = self.client.get(
            reverse("timeclock:timesheet"), {"workplace": self.cash.pk}
        ).content.decode()

        self.assertIn("no tax comes out", html)
        self.assertNotIn("This is before tax", html)

    def test_a_banked_week_still_shows_its_withholding(self):
        self._worked(self.banked)
        html = self.client.get(
            reverse("timeclock:timesheet"), {"workplace": self.banked.pk}
        ).content.decode()

        self.assertIn("Tax withheld", html)
        self.assertNotIn("no tax comes out", html)

    def test_saving_a_job_as_cash_clears_its_withholding(self):
        # The box is hidden the moment cash is picked, but a form can be sent
        # without ever seeing that, so the value is dropped server-side too.
        self.client.post(
            reverse("timeclock:workplace_edit", args=[self.banked.pk]),
            {
                "name": "AUFS", "address": "", "color": self.banked.color,
                "pay_cycle": PayCycle.WEEK, "paid_in": PaidIn.CASH,
                "hourly_rate": "33.25", "tax_rate": "10.80",
                "hours_limit": "", "limit_period": Workplace.Period.FORTNIGHT,
                "week_starts_on": Weekday.SUNDAY,
                "fortnight_starts_on": Weekday.THURSDAY, "fortnight_phase": "this",
                "month_starts_on": "1",
            },
        )
        self.banked.refresh_from_db()

        self.assertEqual(self.banked.paid_in, PaidIn.CASH)
        self.assertIsNone(self.banked.tax_rate)

    def test_a_form_that_never_saw_the_field_leaves_the_job_alone(self):
        self.client.post(
            reverse("timeclock:workplace_edit", args=[self.cash.pk]),
            {
                "name": "Butcher", "address": "", "hourly_rate": "30.00",
                "hours_limit": "", "limit_period": Workplace.Period.FORTNIGHT,
                "week_starts_on": Weekday.SUNDAY,
                "fortnight_starts_on": Weekday.THURSDAY, "fortnight_phase": "this",
                "month_starts_on": "1",
            },
        )
        self.cash.refresh_from_db()
        self.assertEqual(self.cash.paid_in, PaidIn.CASH)


class OneWayInTests(TestCase):
    """
    One link per thing.

    A workplace already carries how it pays, what it caps you at and which
    cycle it counts over, so a second page listing every workplace to say the
    same thing was a second way to reach one thing. The only setting that
    genuinely spanned every job moved to the foot of the list it belongs with.

    Same rule for the calendar: it is a second view of the timesheet, reached
    by the toggle that pairs them, so a tab as well would be two ways to one
    screen.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.workplace = Workplace.objects.create(user=self.user, name="AUFS")
        start = timezone.now() - timedelta(days=1)
        self.shift = Shift.objects.create(
            user=self.user, workplace=self.workplace, clock_in=start,
            clock_out=start + timedelta(hours=8), status=Shift.Status.COMPLETED,
        )

    def test_more_no_longer_offers_a_second_way_in(self):
        html = self.client.get(reverse("timeclock:more")).content.decode()
        titles = re.findall(r'menu-row__title">([^<]+)<', html)
        self.assertEqual(titles, ["Add a past shift", "Pay", "Workplaces"])

    def test_the_cycles_form_lives_on_workplaces(self):
        html = self.client.get(reverse("timeclock:workplaces")).content.decode()
        self.assertIn("My week &amp; cycles", html)
        self.assertIn(reverse("timeclock:preferences"), html)

    def test_the_retired_page_hands_you_to_the_one_that_took_it_on(self):
        response = self.client.get(reverse("timeclock:preferences"))
        self.assertRedirects(response, reverse("timeclock:workplaces"))

    def test_the_calendar_has_one_way_in_and_not_two(self):
        # The toggle on the timesheet, and nothing in the tab bar.
        sheet = self.client.get(reverse("timeclock:timesheet")).content.decode()
        clock = self.client.get(reverse("timeclock:dashboard")).content.decode()
        calendar = reverse("timeclock:calendar")

        self.assertEqual(sheet.count(f'href="{calendar}"'), 1)
        self.assertNotIn(f'href="{calendar}"', clock)

    def test_timesheet_is_three_tabs_of_the_dock_and_no_segments(self):
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        # Each tab appears twice — the app bar on wide screens and the dock
        # on phones, both from one template — and nowhere else: there is no
        # segmented control on a TimeSheet page any more.
        for label in ["Clock", "Timesheet", "More"]:
            self.assertEqual(html.count('class="tab__label">' + label + "</span>"), 2, label)
        self.assertNotIn('class="segments segments--places"', html)
        self.assertNotIn('class="tab__label">Board</span>', html)

    def lit(self, name, args=()):
        """The href of the dock tab lit on a page, and how many are lit."""
        html = self.client.get(reverse(name, args=args)).content.decode()
        # The dock only — the List / Calendar switch on the timesheet is a
        # pair of .tab links too, but it is the page's, not the app's.
        dock = html[html.index('class="tabbar__inner"'):]
        hrefs = re.findall(r'class="tab is-active"\s+href="([^"]+)"', dock)
        self.assertEqual(len(hrefs), 1, (name, hrefs))
        return hrefs[0]

    def test_each_timesheet_page_lights_one_tab(self):
        self.assertEqual(self.lit("timeclock:dashboard"), "/timesheet/")
        for name, args in [
            ("timeclock:timesheet", []), ("timeclock:calendar", []),
            ("timeclock:shift_create", []), ("timeclock:shift_detail", [self.shift.pk]),
        ]:
            self.assertEqual(self.lit(name, args), "/timesheet/shifts/", name)
        for name in ["timeclock:more", "timeclock:workplaces", "timeclock:payments"]:
            self.assertEqual(self.lit(name), "/timesheet/more/", name)

    def test_the_board_lights_home(self):
        self.assertEqual(self.lit("notices:board"), "/")
        self.assertEqual(self.lit("home"), "/")

    def test_the_cycles_still_save(self):
        response = self.client.post(reverse("timeclock:preferences"), {
            "week_starts_on": Weekday.MONDAY,
            "fortnight_starts_on": Weekday.MONDAY, "fortnight_phase": "this",
            "month_starts_on": "15",
        })
        self.assertRedirects(response, reverse("timeclock:workplaces"))
        self.assertEqual(TimePreference.for_user(self.user).week_starts_on, Weekday.MONDAY)


class SincePaidCardTests(TestCase):
    """
    The notepad, as a card.

    Paid whenever the employer gets round to it, there is no week or fortnight
    to total over — the only span that means anything is the one the payment
    button clears. The day the money arrives the figure reads zero and starts
    filling again, which is the whole of how a job like this is kept track of.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.today = timezone.localdate()
        self.job = Workplace.objects.create(
            user=self.user, name="Butcher", hourly_rate=Decimal("30.00"),
            paid_in=PaidIn.CASH, pay_cycle=PayCycle.IRREGULAR,
        )

    def _worked(self, days_ago, hours=5):
        start = timezone.make_aware(
            datetime.combine(self.today - timedelta(days=days_ago), time(9)),
            timezone.get_current_timezone(),
        )
        return Shift.objects.create(
            user=self.user, workplace=self.job, clock_in=start,
            clock_out=start + timedelta(hours=hours), status=Shift.Status.COMPLETED,
        )

    def _card(self):
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()
        label = re.search(r'summary-card__label">([^<]+)<', html)
        value = re.search(r'summary-card__value"[^>]*>([^<]+)<', html)
        sub = re.search(r'summary-card__sub">([^<]*)<', html)
        return (
            label.group(1) if label else None,
            value.group(1) if value else None,
            sub.group(1) if sub else None,
        )

    def _paid(self, **post):
        return self.client.post(
            reverse("timeclock:payment_record", args=[self.job.pk]), post, follow=True
        )

    def test_the_card_counts_from_the_last_payment(self):
        for days in (16, 13, 10):
            self._worked(days)
        label, value, _ = self._card()

        self.assertEqual(label, "Since you were paid")
        self.assertEqual(value, "15h")

    def test_it_says_so_when_nothing_has_been_paid_yet(self):
        self.assertEqual(self._card()[2], "nothing paid yet")

    def test_being_paid_puts_it_back_to_zero(self):
        self._worked(10)
        self._paid()
        self.assertEqual(self._card()[1], "0m")

    def test_and_it_starts_filling_again(self):
        self._worked(10)
        self._paid()

        # Clocked after the money arrived, so it is owed again.
        after = timezone.now()
        Shift.objects.create(
            user=self.user, workplace=self.job, clock_in=after,
            clock_out=after + timedelta(hours=6), status=Shift.Status.COMPLETED,
        )
        self.assertEqual(self._card()[1], "6h")

    def test_undoing_the_payment_puts_the_hours_back(self):
        self._worked(10)
        self._worked(8)
        self._paid()
        self.client.post(reverse("timeclock:payment_undo", args=[self.job.pk]))

        self.assertEqual(self._card()[1], "10h")

    def test_the_pay_breakdown_is_written_over_the_same_span(self):
        self._worked(10)
        html = self.client.get(reverse("timeclock:timesheet")).content.decode()

        self.assertIn("Owed since your last payment", html)
        self.assertNotIn("fortnight\u2019s pay", html)
        # Cash in hand, so no deduction is invented on it either.
        self.assertIn("no tax comes out", html)

    def test_a_second_job_gives_the_two_of_them_no_shared_starting_line(self):
        self._worked(10)
        Workplace.objects.create(
            user=self.user, name="AUFS", pay_cycle=PayCycle.FORTNIGHT
        )
        labels = re.findall(
            r'summary-card__label">([^<]+)<',
            self.client.get(reverse("timeclock:timesheet")).content.decode(),
        )
        self.assertEqual(labels, ["This week", "This fortnight"])

    def test_but_filtering_to_it_brings_the_card_back(self):
        self._worked(10)
        Workplace.objects.create(
            user=self.user, name="AUFS", pay_cycle=PayCycle.FORTNIGHT
        )
        html = self.client.get(
            reverse("timeclock:timesheet"), {"workplace": self.job.pk}
        ).content.decode()

        self.assertEqual(
            re.findall(r'summary-card__label">([^<]+)<', html), ["Since you were paid"]
        )


class ReminderTests(TestCase):
    """
    The two things TimeSheet notices on its own.

    Both are raised by a scheduled task rather than by a request, so both are
    tested the way that task runs them — and the thing worth testing about a
    task that runs every twenty minutes is that running it again changes
    nothing.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.job = Workplace.objects.create(user=self.user, name="Courtlands")

    # ---- a shift nobody clocked out of ----------------------------------

    def test_a_very_long_open_shift_raises_a_reminder(self):
        from apps.notifications.models import Kind, Notification
        from .notify import open_shift_reminders

        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=12),
        )

        open_shift_reminders()

        told = Notification.objects.get(recipient=self.user)
        self.assertEqual(told.kind, Kind.TIMESHEET)
        self.assertIn("still clocked in", told.title)
        self.assertIn("Courtlands", told.body)

    def test_an_ordinary_shift_is_left_alone(self):
        from apps.notifications.models import Notification
        from .notify import open_shift_reminders

        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=6),
        )

        open_shift_reminders()

        self.assertEqual(Notification.objects.count(), 0)

    def test_running_the_task_again_does_not_repeat_itself(self):
        from apps.notifications.models import Notification
        from .notify import open_shift_reminders

        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=12),
        )

        open_shift_reminders()
        open_shift_reminders()
        open_shift_reminders()

        self.assertEqual(Notification.objects.count(), 1)

    def test_a_closed_shift_is_not_still_clocked_in(self):
        from apps.notifications.models import Notification
        from .notify import open_shift_reminders

        start = timezone.now() - timedelta(hours=14)
        shift = Shift.objects.create(user=self.user, workplace=self.job, clock_in=start)
        shift.clock_out_now(when=start + timedelta(hours=13))

        open_shift_reminders()

        self.assertEqual(Notification.objects.count(), 0)

    # ---- a cap coming up ------------------------------------------------

    def _worked(self, hours, day=None):
        """A finished shift of `hours`, ending today unless told otherwise."""
        end = timezone.now() if day is None else day
        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=end - timedelta(hours=hours), clock_out=end,
            status=Shift.Status.COMPLETED,
        )

    def test_nothing_is_said_while_there_is_room_left(self):
        from apps.notifications.models import Notification
        from .notify import limit_reminders

        self.job.hours_limit = 38
        self.job.save()
        self._worked(10)

        limit_reminders()

        self.assertEqual(Notification.objects.count(), 0)

    def test_the_last_tenth_of_a_cap_is_worth_saying(self):
        from apps.notifications.models import Notification
        from .notify import limit_reminders

        self.job.hours_limit = 10
        self.job.save()
        self._worked(9.5)

        limit_reminders()

        told = Notification.objects.get(recipient=self.user)
        self.assertIn("Close to your", told.title)
        self.assertIn("Courtlands", told.title)

    def test_going_over_says_so_once_however_often_it_runs(self):
        from apps.notifications.models import Notification
        from .notify import limit_reminders

        self.job.hours_limit = 8
        self.job.save()
        self._worked(9)

        limit_reminders()
        limit_reminders()

        told = Notification.objects.get(recipient=self.user)
        self.assertIn("Over your", told.title)

    def test_crossing_from_close_to_over_is_a_second_thing_to_say(self):
        from apps.notifications.models import Notification
        from .notify import limit_reminders

        self.job.hours_limit = 10
        self.job.save()
        self._worked(9.5)
        limit_reminders()

        self._worked(1)
        limit_reminders()

        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 2)

    def test_a_workplace_with_no_cap_is_never_reminded(self):
        from apps.notifications.models import Notification
        from .notify import limit_reminders

        self._worked(60)

        limit_reminders()

        self.assertEqual(Notification.objects.count(), 0)

    # ---- the command itself ---------------------------------------------

    def test_the_management_command_runs_both(self):
        from io import StringIO

        from django.core.management import call_command

        from apps.notifications.models import Notification

        self.job.hours_limit = 8
        self.job.save()
        self._worked(9)
        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=12),
        )

        out = StringIO()
        call_command("timesheet_reminders", stdout=out)

        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 2)
        self.assertIn("2 reminder(s) raised", out.getvalue())


class ReminderSweepTests(TestCase):
    """
    The reminders running off the back of a page load, which is how they run
    at all on a host whose scheduler offers one task a day.
    """

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.job = Workplace.objects.create(user=self.user, name="Courtlands")
        self.client.force_login(self.user)

    def test_a_page_load_runs_the_reminders(self):
        from apps.notifications.models import Notification

        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=12),
        )

        self.client.get(reverse("home"))

        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 1)

    def test_the_next_page_load_does_not_run_them_again(self):
        from apps.notifications.models import Notification, Sweep

        Shift.objects.create(
            user=self.user, workplace=self.job,
            clock_in=timezone.now() - timedelta(hours=12),
        )

        for _ in range(5):
            self.client.get(reverse("home"))

        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 1)
        self.assertEqual(Sweep.objects.filter(name="timesheet-reminders").count(), 1)

    def test_a_broken_sweep_does_not_break_the_page(self):
        """
        The sweep hangs off every page in MyWork, so it has to fail quietly.
        """
        from unittest.mock import patch

        with patch("apps.timeclock.notify.run_all", side_effect=RuntimeError("boom")):
            with self.assertLogs("apps.timeclock.middleware", level="ERROR"):
                resp = self.client.get(reverse("home"))

        self.assertEqual(resp.status_code, 200)


class PayslipFillTests(TestCase):
    """
    The small button on the workplace form: a payslip in, the boxes filled.

    The reader works from the words on the slip, so most of this is the
    words — the layouts payroll systems actually print — and what the form
    is told from each. The endpoint is checked with a PDF made on the spot,
    since that is what nearly every payslip is.
    """

    FORTNIGHTLY = """Courtlands Aged Care Pty Ltd
ABN 12 345 678 901
PAYSLIP
Employee: Kiran Lama    Employee No: 1042
Pay Period: 27/08/2026 - 09/09/2026    Pay Date: 11/09/2026
Description            Hours    Rate      Amount     YTD
Ordinary Hours         62.50    32.4500   2,028.13   14,203.00
Saturday Loading       8.00     48.6750   389.40     2,100.00
Gross Pay                                  2,417.53   16,303.00
PAYG Tax                                   -412.00    2,780.00
Net Pay                                    2,005.53   13,523.00
"""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)

    def test_reads_rate_tax_and_fortnight_off_a_slip(self):
        from .payslip import parse

        slip = parse(self.FORTNIGHTLY)
        fields = slip.fields(today=date(2026, 9, 12))

        self.assertEqual(fields["hourly_rate"], "32.45")
        self.assertEqual(fields["tax_rate"], "17.04")  # 412 ÷ 2417.53 × 100
        self.assertEqual(fields["pay_cycle"], PayCycle.FORTNIGHT)
        self.assertEqual(fields["limit_period"], PayCycle.FORTNIGHT)
        self.assertEqual(fields["fortnight_starts_on"], 3)  # 27 Aug 2026 is a Thursday
        self.assertEqual(fields["fortnight_phase"], "this")  # the run from 10 Sep opened this week
        self.assertEqual(fields["name"], "Courtlands Aged Care Pty Ltd")
        # The ordinary line, not the loaded one; this pay, not the year's.
        self.assertEqual(slip.gross, Decimal("2417.53"))
        self.assertEqual(slip.tax, Decimal("412.00"))

    def test_a_rate_printed_on_its_own_and_a_weekly_period(self):
        from .payslip import parse

        fields = parse("""Woolworths Group Limited
Pay period 31 Aug 2026 to 6 Sep 2026
Hourly rate: $28.75
Gross $862.50    Tax $86.00   Net $776.50
""").fields(today=date(2026, 9, 12))

        self.assertEqual(fields["hourly_rate"], "28.75")
        self.assertEqual(fields["tax_rate"], "9.97")
        self.assertEqual(fields["pay_cycle"], PayCycle.WEEK)
        self.assertEqual(fields["week_starts_on"], 0)  # Monday

    def test_a_monthly_slip_with_no_gross_line(self):
        from .payslip import parse

        slip = parse("""Bunnings Group
Pay Period 1 September 2026 to 30 September 2026
Base salary 160.00 hrs @ 35.00 = 5600.00
Taxable income 5600.00
Tax withheld 1180.00
Net pay 4420.00
""")
        fields = slip.fields()

        self.assertEqual(slip.gross, Decimal("5600.00"))  # net + tax
        self.assertEqual(fields["hourly_rate"], "35.00")
        self.assertEqual(fields["tax_rate"], "21.07")
        self.assertEqual(fields["pay_cycle"], PayCycle.MONTH)
        self.assertEqual(fields["month_starts_on"], 1)

    def test_says_what_it_could_not_find(self):
        from .payslip import parse

        slip = parse("Some Shop\nGross 500.00\n")

        self.assertIsNone(slip.rate)
        self.assertTrue(any("hourly rate" in note for note in slip.notes))
        self.assertTrue(any("pay period" in note for note in slip.notes))

    def _pdf(self, lines):
        import io

        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas

        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        y = 800
        for line in lines.splitlines():
            pdf.drawString(40, y, line)
            y -= 16
        pdf.save()
        return SimpleUploadedFile("payslip.pdf", buffer.getvalue(), content_type="application/pdf")

    def test_the_button_gets_the_boxes_back_as_json(self):
        response = self.client.post(
            reverse("timeclock:workplace_payslip"), {"payslip": self._pdf(self.FORTNIGHTLY)}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["fields"]["hourly_rate"], "32.45")
        self.assertEqual(data["fields"]["tax_rate"], "17.04")
        self.assertEqual(data["fields"]["pay_cycle"], "FORTNIGHT")
        self.assertEqual(data["fields"]["fortnight_starts_on"], 3)
        labels = [item["label"] for item in data["read"]]
        self.assertIn("Hourly rate", labels)
        self.assertIn("Tax withheld", labels)
        self.assertIn("Pay period", labels)

    def test_a_pdf_with_no_words_is_turned_away_with_advice(self):
        response = self.client.post(
            reverse("timeclock:workplace_payslip"), {"payslip": self._pdf("")}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("screenshot", response.json()["error"])

    def test_a_slip_with_nothing_usable_is_a_400_not_an_empty_fill(self):
        response = self.client.post(
            reverse("timeclock:workplace_payslip"), {"payslip": self._pdf("Hello there, this is not a payslip at all, just some words on a page.")}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_no_file_and_not_signed_in(self):
        self.assertEqual(self.client.post(reverse("timeclock:workplace_payslip")).status_code, 400)
        self.client.logout()
        self.assertEqual(self.client.post(reverse("timeclock:workplace_payslip")).status_code, 302)

    def test_the_workplace_form_carries_the_button(self):
        response = self.client.get(reverse("timeclock:workplace_create"))

        self.assertContains(response, "Fill from a payslip")
        self.assertContains(response, reverse("timeclock:workplace_payslip"))
        # The file input has no name: it never travels with the form itself.
        self.assertNotRegex(response.content.decode(), r'<input type="file"[^>]*\bname=')
