"""
Turning one holiday into one card.

Every string the card shows is built here and nowhere else. The API and the
template both render the same object, so the JSON a phone receives and the
HTML the dashboard draws can never disagree about what day Christmas falls on
or how many sleeps away it is.

Formatting on the server rather than the client is deliberate for this card.
"DEC", "25", "Friday" and "In 7 days" are four presentations of one date, and
a mobile client that derived them itself would need the locale rules, the
timezone and the definition of "days remaining" — and would get the last one
wrong, because it is a difference between calendar dates and not a difference
between instants.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from itertools import groupby

from django.utils import timezone

from .models import HolidayPreference, PublicHoliday, State


@dataclass(frozen=True)
class HolidayCard:
    """One upcoming holiday, in every form the card and the API need."""

    name: str
    day: date
    state: str

    # ---- the pieces the card is laid out from ---------------------------

    @property
    def month_short(self) -> str:
        """"DEC" — the block above the numeral."""
        return self.day.strftime("%b").upper()

    @property
    def day_number(self) -> str:
        """"25", never "05": a leading zero on a calendar tile reads as a
        timestamp rather than a date."""
        return str(self.day.day)

    @property
    def weekday(self) -> str:
        """"Friday" — which is half of why a public holiday matters."""
        return self.day.strftime("%A")

    @property
    def scope(self) -> str:
        """The pill: "NATIONAL", or the state's own short name."""
        return self.state

    @property
    def is_national(self) -> bool:
        return self.state == State.NATIONAL

    # ---- the countdown ---------------------------------------------------

    def days_remaining(self, today: date | None = None) -> int:
        """
        Whole days between today and the holiday, never negative.

        A difference of dates, not of times: "how many more times do I wake up
        before it" is what somebody reads off this, and an hours-based answer
        would say 0 days at breakfast on Christmas Eve.
        """
        return max((self.day - (today or timezone.localdate())).days, 0)

    def countdown(self, today: date | None = None) -> str:
        """The same number in words, because "In 0 days" is not a sentence."""
        remaining = self.days_remaining(today)
        if remaining == 0:
            return "Today"
        if remaining == 1:
            return "Tomorrow"
        return f"In {remaining} days"

    # ---- what goes down the wire -----------------------------------------

    def as_payload(self, today: date | None = None) -> dict[str, object]:
        """
        The card, as the mobile app receives it.

        ISO date included alongside the formatted pieces so a client that wants
        to do something else with it — diary it, sort by it — is not left
        parsing "DEC" back into a month.
        """
        return {
            "name": self.name,
            "date": self.day.isoformat(),
            "month_short": self.month_short,
            "day": self.day_number,
            "weekday": self.weekday,
            "days_remaining": self.days_remaining(today),
            "countdown": self.countdown(today),
            "scope": self.scope,
            "is_national": self.is_national,
        }

    @classmethod
    def of(cls, holiday: PublicHoliday) -> HolidayCard:
        return cls(name=holiday.name, day=holiday.date, state=holiday.state)


def next_card(state: str, today: date | None = None) -> HolidayCard | None:
    """The next holiday for `state` as a card, or None if nothing is stored."""
    holiday = PublicHoliday.next_for(state, today=today)
    return HolidayCard.of(holiday) if holiday else None


def card_for_user(user, today: date | None = None) -> tuple[str, HolidayCard | None]:
    """
    What the dashboard shows this person: their state, and its next holiday.

    Returns the state alongside the card so the page can name it even when
    there is nothing to show — "no holidays stored for VIC" is a useful thing
    to be told, where a blank space is not.
    """
    state = HolidayPreference.state_for(user)
    return state, next_card(state, today=today)


@dataclass(frozen=True)
class MonthGroup:
    """
    One month of the year ahead, the way the calendar page folds it.

    A flat list of a year's holidays is thirteen identical rows on a phone,
    which is a scroll rather than a calendar. Folded by month it becomes a
    dozen headings you can thumb past, each of which still says how many dates
    are hiding inside it while it is shut.
    """

    month: date  # the first of the month — the group's identity and its label
    cards: tuple[HolidayCard, ...]

    @property
    def label(self) -> str:
        """"October" — the year is shown beside it, not inside it."""
        return self.month.strftime("%B")

    @property
    def year(self) -> int:
        return self.month.year

    @property
    def count(self) -> int:
        return len(self.cards)


def by_month(cards: Iterable[HolidayCard]) -> list[MonthGroup]:
    """
    Fold cards into one group per month, in the order they arrive.

    The caller hands these over already sorted by date — PublicHoliday orders
    that way — so this is one pass and no month is ever seen twice. Months
    with nothing in them do not appear at all: an empty February is not worth
    a heading.
    """
    return [
        MonthGroup(month=month, cards=tuple(group))
        for month, group in groupby(cards, key=lambda card: card.day.replace(day=1))
    ]
