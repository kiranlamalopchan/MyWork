"""
The next public holiday: which one it is, and how it reads.

Two things are worth guarding here. One is the rule that decides whose holiday
a date is — national once, state-specific per state — because it is the only
place this app makes a judgement rather than repeating what the `holidays`
package says. The other is the formatting, because every string on the card is
built on the server and a mobile client has no way to correct it.
"""

from datetime import date, datetime, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import HolidayPreference, PublicHoliday, State
from .services import HolidayCard, by_month, card_for_user, next_card
from .sync import entries_for, sync


class SyncTests(TestCase):
    """Pulling the year's dates in, and which jurisdiction each belongs to."""

    def test_a_national_holiday_is_stored_once(self):
        sync([2026])

        christmas = PublicHoliday.objects.filter(date=date(2026, 12, 25))
        self.assertEqual(christmas.count(), 1)
        self.assertEqual(christmas.get().state, State.NATIONAL)

    def test_a_state_holiday_is_stored_against_that_state_alone(self):
        sync([2026])

        # Melbourne Cup Day is Victoria's and nobody else's.
        cup = PublicHoliday.objects.filter(name__icontains="Melbourne Cup")
        self.assertEqual([h.state for h in cup], [State.VIC])

    def test_every_state_gets_something_of_its_own(self):
        sync([2026])

        for state in State.states():
            with self.subTest(state=state):
                self.assertTrue(
                    PublicHoliday.objects.filter(state=state).exists(),
                    f"{state} has no holidays of its own",
                )

    def test_running_it_twice_changes_nothing(self):
        first = sync([2026])
        before = set(PublicHoliday.objects.values_list("date", "name", "state"))

        second = sync([2026])

        self.assertEqual(first, second)
        self.assertEqual(
            before, set(PublicHoliday.objects.values_list("date", "name", "state"))
        )

    def test_a_date_that_stops_being_a_holiday_does_not_linger(self):
        sync([2026])
        PublicHoliday.objects.create(
            date=date(2026, 7, 1), name="Invented Day", state=State.NSW
        )

        sync([2026])

        self.assertFalse(
            PublicHoliday.objects.filter(name="Invented Day").exists(),
            "a re-sync should rebuild the year rather than merge into it",
        )

    def test_syncing_one_year_leaves_another_alone(self):
        sync([2026])
        sync([2027])

        self.assertTrue(PublicHoliday.objects.filter(date__year=2026).exists())
        self.assertTrue(PublicHoliday.objects.filter(date__year=2027).exists())

    def test_the_national_set_is_not_repeated_per_state(self):
        entries = list(entries_for([2026]))
        christmas = [e for e in entries if e.date == date(2026, 12, 25)]

        self.assertEqual(len(christmas), 1)
        self.assertEqual(christmas[0].state, State.NATIONAL)


class NextHolidayTests(TestCase):
    """Choosing the one to show."""

    def setUp(self):
        sync([2026, 2027])

    def test_it_is_the_soonest_one_not_merely_a_near_one(self):
        # Two days before Christmas, in a state with nothing of its own between.
        found = PublicHoliday.next_for(State.NSW, today=date(2026, 12, 23))

        self.assertEqual(found.date, date(2026, 12, 25))
        self.assertEqual(found.name, "Christmas Day")

    def test_today_counts_as_upcoming(self):
        found = PublicHoliday.next_for(State.NSW, today=date(2026, 12, 25))

        self.assertEqual(found.date, date(2026, 12, 25))

    def test_a_state_sees_its_own(self):
        # Melbourne Cup Day, 3 November 2026 — Victoria's alone.
        found = PublicHoliday.next_for(State.VIC, today=date(2026, 11, 1))

        self.assertEqual(found.name, "Melbourne Cup Day")

    def test_a_state_does_not_see_another_states(self):
        found = PublicHoliday.next_for(State.NSW, today=date(2026, 11, 1))

        self.assertNotEqual(found.name, "Melbourne Cup Day")

    def test_it_rolls_into_the_following_year(self):
        found = PublicHoliday.next_for(State.NSW, today=date(2026, 12, 29))

        self.assertEqual(found.date, date(2027, 1, 1))

    def test_finding_it_is_a_single_query(self):
        """
        The card renders on the hub, which is the most-visited page in MyWork.
        One indexed query is the budget.
        """
        with self.assertNumQueries(1):
            PublicHoliday.next_for(State.NSW, today=date(2026, 12, 23))

    def test_default_date_uses_the_active_timezone(self):
        PublicHoliday.objects.create(
            date=date(2026, 12, 24), name="Christmas Eve", state=State.NATIONAL
        )

        with timezone.override("Australia/Darwin"):
            with patch(
                "django.utils.timezone.now",
                return_value=datetime(2026, 12, 24, 14, 30, tzinfo=dt_timezone.utc),
            ):
                found = PublicHoliday.next_for(State.NSW)

        self.assertEqual(found.date, date(2026, 12, 25))


class CardTests(TestCase):
    """The strings the phone is handed."""

    def setUp(self):
        self.card = HolidayCard(
            name="Christmas Day", day=date(2026, 12, 25), state=State.NATIONAL
        )

    def test_the_pieces_of_the_date(self):
        self.assertEqual(self.card.month_short, "DEC")
        self.assertEqual(self.card.day_number, "25")
        self.assertEqual(self.card.weekday, "Friday")

    def test_a_single_digit_day_carries_no_leading_zero(self):
        card = HolidayCard(name="Labour Day", day=date(2026, 3, 9), state=State.VIC)

        self.assertEqual(card.day_number, "9")
        self.assertEqual(card.month_short, "MAR")

    def test_the_countdown_counts_days_not_hours(self):
        self.assertEqual(self.card.days_remaining(date(2026, 12, 18)), 7)
        self.assertEqual(self.card.countdown(date(2026, 12, 18)), "In 7 days")

    def test_the_countdown_has_words_for_the_small_numbers(self):
        self.assertEqual(self.card.countdown(date(2026, 12, 25)), "Today")
        self.assertEqual(self.card.countdown(date(2026, 12, 24)), "Tomorrow")

    def test_a_holiday_in_the_past_never_counts_backwards(self):
        self.assertEqual(self.card.days_remaining(date(2026, 12, 26)), 0)

    def test_default_countdown_uses_the_active_timezone(self):
        with timezone.override("Australia/Darwin"):
            with patch(
                "django.utils.timezone.now",
                return_value=datetime(2026, 12, 24, 14, 30, tzinfo=dt_timezone.utc),
            ):
                self.assertEqual(self.card.countdown(), "Today")

    def test_the_payload_is_what_the_app_needs(self):
        payload = self.card.as_payload(today=date(2026, 12, 18))

        self.assertEqual(payload, {
            "name": "Christmas Day",
            "date": "2026-12-25",
            "month_short": "DEC",
            "day": "25",
            "weekday": "Friday",
            "days_remaining": 7,
            "countdown": "In 7 days",
            "scope": "NATIONAL",
            "is_national": True,
        })

    def test_a_state_holiday_says_whose_it_is(self):
        card = HolidayCard(
            name="Melbourne Cup Day", day=date(2026, 11, 3), state=State.VIC
        )

        self.assertEqual(card.scope, "VIC")
        self.assertFalse(card.is_national)


class PreferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        sync([2026, 2027])

    def test_somebody_with_no_preference_gets_the_default(self):
        self.assertEqual(HolidayPreference.state_for(self.user), State.NT)

    def test_reading_the_default_writes_nothing(self):
        HolidayPreference.state_for(self.user)

        self.assertEqual(HolidayPreference.objects.count(), 0)

    def test_a_stored_preference_is_used(self):
        HolidayPreference.objects.create(user=self.user, state=State.VIC)
        self.user.refresh_from_db()

        state, card = card_for_user(self.user, today=date(2026, 11, 1))

        self.assertEqual(state, State.VIC)
        self.assertEqual(card.name, "Melbourne Cup Day")


class ApiTests(TestCase):
    """The endpoint the mobile app calls."""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        sync([2026, 2027])

    def test_it_answers_for_the_state_it_is_asked_about(self):
        resp = self.client.get(reverse("holidays:api_next"), {"state": "VIC"})

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["state"], "VIC")
        self.assertIn("month_short", body["holiday"])
        self.assertIn("days_remaining", body["holiday"])

    def test_a_lowercase_state_is_still_a_state(self):
        resp = self.client.get(reverse("holidays:api_next"), {"state": "nsw"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["state"], "NSW")

    def test_an_unknown_state_is_refused_and_says_what_exists(self):
        resp = self.client.get(reverse("holidays:api_next"), {"state": "XYZ"})

        self.assertEqual(resp.status_code, 400)
        self.assertIn("NSW", resp.json()["states"])

    def test_without_a_state_it_uses_the_signed_in_persons(self):
        HolidayPreference.objects.create(user=self.user, state=State.WA)

        resp = self.client.get(reverse("holidays:api_next"))

        self.assertEqual(resp.json()["state"], "WA")

    def test_it_needs_a_login(self):
        self.client.logout()

        resp = self.client.get(reverse("holidays:api_next"))

        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login/", resp["Location"])

    def test_nothing_stored_is_a_null_rather_than_an_error(self):
        PublicHoliday.objects.all().delete()

        resp = self.client.get(reverse("holidays:api_next"), {"state": "NSW"})

        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["holiday"])


class PagesTests(TestCase):
    """The card on the hub, and the calendar behind it."""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        sync([2026, 2027])

    def test_the_hub_carries_the_card(self):
        resp = self.client.get(reverse("home"))

        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "holiday__date")
        self.assertIsNotNone(resp.context["holiday"])

    def test_the_hub_is_fine_with_nothing_stored(self):
        PublicHoliday.objects.all().delete()

        resp = self.client.get(reverse("home"))

        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.context["holiday"])
        self.assertNotContains(resp, "holiday__date")

    def test_the_calendar_lists_the_year_ahead(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "VIC"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.context["state"], "VIC")
        self.assertContains(resp, "Melbourne Cup Day")

    def test_the_calendar_shows_only_that_states_own(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "NSW"})

        self.assertNotContains(resp, "Melbourne Cup Day")
        self.assertContains(resp, "Christmas Day")


class ConstraintTests(TestCase):
    def test_the_same_holiday_cannot_be_stored_twice_for_one_place(self):
        from django.db import IntegrityError

        PublicHoliday.objects.create(
            date=date(2026, 12, 25), name="Christmas Day", state=State.NATIONAL
        )

        with self.assertRaises(IntegrityError):
            PublicHoliday.objects.create(
                date=date(2026, 12, 25), name="Christmas Day", state=State.NATIONAL
            )

    def test_two_different_holidays_may_share_a_day(self):
        PublicHoliday.objects.create(
            date=date(2026, 4, 4), name="Easter Saturday", state=State.NSW
        )
        PublicHoliday.objects.create(
            date=date(2026, 4, 4), name="Something Else Day", state=State.NSW
        )

        self.assertEqual(PublicHoliday.objects.filter(date=date(2026, 4, 4)).count(), 2)


class MonthFoldTests(TestCase):
    """Folding the year ahead into the months the calendar page collapses."""

    @staticmethod
    def card(day: date, name: str = "A Holiday") -> HolidayCard:
        return HolidayCard(name=name, day=day, state=State.NATIONAL)

    def test_nothing_folds_to_nothing(self):
        self.assertEqual(by_month([]), [])

    def test_one_group_per_month_in_order(self):
        groups = by_month([
            self.card(date(2026, 10, 5)),
            self.card(date(2026, 12, 25)),
            self.card(date(2026, 12, 26)),
            self.card(date(2027, 1, 1)),
        ])

        self.assertEqual(
            [(g.label, g.year, g.count) for g in groups],
            [("October", 2026, 1), ("December", 2026, 2), ("January", 2027, 1)],
        )

    def test_the_same_month_of_two_years_stays_apart(self):
        groups = by_month([
            self.card(date(2026, 12, 25)),
            self.card(date(2027, 12, 25)),
        ])

        self.assertEqual([g.year for g in groups], [2026, 2027])

    def test_a_group_keeps_its_own_dates(self):
        groups = by_month([
            self.card(date(2026, 12, 25), "Christmas Day"),
            self.card(date(2026, 12, 26), "Boxing Day"),
        ])

        self.assertEqual(
            [c.name for c in groups[0].cards], ["Christmas Day", "Boxing Day"]
        )


class CalendarFoldTests(TestCase):
    """What the folded calendar page actually renders."""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        sync([2026, 2027])

    def test_one_fold_per_month(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "NSW"})

        months = resp.context["months"]
        self.assertTrue(months)
        self.assertEqual(resp.content.decode().count('<details class="hmonth"'), len(months))

    def test_only_the_nearest_month_starts_open(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "NSW"})

        # One `open`, and it is the first — the month holding the next holiday,
        # which is the one the hub card was already talking about.
        body = resp.content.decode()
        self.assertEqual(body.count('<details class="hmonth" open>'), 1)
        self.assertLess(
            body.index('<details class="hmonth" open>'),
            body.index('<details class="hmonth">'),
        )

    def test_a_shut_month_still_says_how_many(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "NSW"})

        self.assertContains(resp, "hmonth__count")
        self.assertContains(resp, "dates ahead")

    def test_every_date_is_in_the_page_even_while_folded(self):
        resp = self.client.get(reverse("holidays:calendar"), {"state": "NSW"})

        # Folding is display, not filtering: a shut December still carries
        # Christmas, so find-in-page and screen readers reach it.
        upcoming = PublicHoliday.upcoming_for("NSW").count()
        self.assertEqual(resp.context["total"], upcoming)
        self.assertEqual(sum(g.count for g in resp.context["months"]), upcoming)
        self.assertContains(resp, "Christmas Day")
