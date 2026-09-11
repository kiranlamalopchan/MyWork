"""
Where the dates come from.

The `holidays` package already knows every Australian public holiday and every
state's variations on them, so nothing here works any of that out. What this
file does is decide which jurisdiction each date belongs to, which the package
expresses by structure rather than by a field:

    holidays.Australia(years=y)                -> the national set
    holidays.Australia(years=y, subdiv="NSW")  -> the national set plus NSW's

So a date in the subdivision's list but not in the national one is that state's
own. That is the whole rule, and it is the package's own model of the country
rather than a table of exceptions maintained here that would go stale the first
time a state moved its show day.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date

import holidays as holidays_pkg
from django.db import transaction

from .models import PublicHoliday, State

# How far ahead a sync reaches by default. Three years is comfortably past any
# card's horizon and small enough that the whole table is a few hundred rows.
DEFAULT_YEARS_AHEAD = 2


@dataclass(frozen=True)
class Entry:
    """One row-to-be, before it is a row."""

    date: date
    name: str
    state: str


def years_from(today: date | None = None, ahead: int = DEFAULT_YEARS_AHEAD) -> list[int]:
    """This year and the next few."""
    start = (today or date.today()).year
    return list(range(start, start + ahead + 1))


def entries_for(years: list[int]) -> Iterator[Entry]:
    """
    Every holiday in `years`, each tagged with the jurisdiction it belongs to.

    National dates are yielded once. A state's are only the dates the national
    set does not already carry, which is what keeps Christmas Day one row
    instead of nine.
    """
    national = holidays_pkg.Australia(years=years)
    national_dates = set(national)

    for day, name in national.items():
        yield Entry(date=day, name=name, state=State.NATIONAL)

    for state in State.states():
        for day, name in holidays_pkg.Australia(years=years, subdiv=state).items():
            if day not in national_dates:
                yield Entry(date=day, name=name, state=state)


@transaction.atomic
def sync(years: list[int] | None = None) -> int:
    """
    Replace the stored holidays for `years` with what the package says today.
    Returns how many rows were written.

    Replace rather than merge, and in one transaction. A date that moves — a
    show day shifted, a one-off royal holiday withdrawn — leaves no orphan
    behind, and the table cannot be observed half-rebuilt by a request that
    lands mid-sync. Idempotent by construction: running it twice leaves exactly
    what running it once did.
    """
    years = years or years_from()
    rows = [
        PublicHoliday(date=entry.date, name=entry.name, state=entry.state)
        for entry in entries_for(years)
    ]

    PublicHoliday.objects.filter(date__year__in=years).delete()
    PublicHoliday.objects.bulk_create(rows, batch_size=500)
    return len(rows)
