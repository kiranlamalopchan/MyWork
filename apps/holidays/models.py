"""
Australian public holidays, and which of them apply where.

The table is a cache, not a source of truth. Everything in it comes from the
`holidays` package (see `sync.py`), refreshed by a management command, and can
be thrown away and rebuilt at any time without losing anything. It exists so
that the question the dashboard asks — "what is the next one?" — is one
indexed query rather than a library call and a sort on every page load.

A national holiday is stored **once**, not once per state. Christmas Day is one
row, not eight, and a state's list is the national rows plus its own: that is
what `PublicHoliday.next_for` ORs together. Storing the national set against
every state would make the table eight times larger and every write eight
times more work, to answer exactly the same question.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q, QuerySet

# How far ahead "upcoming" reaches on the calendar page. A year is enough that
# the list always has something in it and short enough that it stays a list
# rather than an almanac.
HORIZON = timedelta(days=365)


class State(models.TextChoices):
    """
    Where a holiday applies.

    NATIONAL is a place in the same sense the others are: it is the answer to
    "whose holiday is this?", and keeping it in the same field is what lets one
    query cover both without a second column or a nullable join.
    """

    NATIONAL = "NATIONAL", "National"
    ACT = "ACT", "Australian Capital Territory"
    NSW = "NSW", "New South Wales"
    NT = "NT", "Northern Territory"
    QLD = "QLD", "Queensland"
    SA = "SA", "South Australia"
    TAS = "TAS", "Tasmania"
    VIC = "VIC", "Victoria"
    WA = "WA", "Western Australia"

    @classmethod
    def states(cls) -> list[str]:
        """The eight real ones — everything a person can actually be in."""
        return [value for value in cls.values if value != cls.NATIONAL]

    @classmethod
    def is_state(cls, value: str | None) -> bool:
        """Whether `value` names somewhere a person can be. Case-insensitive,
        because it arrives off a query string."""
        return bool(value) and value.upper() in cls.states()


class PublicHoliday(models.Model):
    """One holiday, on one date, for one jurisdiction."""

    date = models.DateField()
    name = models.CharField(max_length=120)
    state = models.CharField(max_length=8, choices=State.choices)

    class Meta:
        ordering = ["date", "name"]
        # The two shapes of question ever asked of this table: "the next one
        # for NSW" (state + date, which the OR below runs twice) and "what is
        # coming up" (date alone).
        indexes = [
            models.Index(fields=["state", "date"], name="holiday_state_date"),
            models.Index(fields=["date"], name="holiday_date"),
        ]
        constraints = [
            # The uniqueness the brief asked for as `unique_together`, in the
            # spelling this project already uses everywhere else (see
            # noticeboard.Reaction) and the one Django now prefers.
            #
            # Name is part of the key rather than date+state alone: two
            # holidays can and do fall on one day in one place — Easter
            # Saturday beside a state's own show day — and a constraint that
            # forbids it would drop the second one on the floor at sync time.
            models.UniqueConstraint(
                fields=["date", "name", "state"], name="one_holiday_per_day_per_place"
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.state}) on {self.date}"

    @property
    def is_national(self) -> bool:
        return self.state == State.NATIONAL

    # ---- asking about them ----------------------------------------------

    @classmethod
    def visible_to(cls, state: str) -> QuerySet[PublicHoliday]:
        """
        Everything somebody in `state` observes: the national set and their
        own, and nobody else's.
        """
        return cls.objects.filter(Q(state=State.NATIONAL) | Q(state=state.upper()))

    @classmethod
    def next_for(cls, state: str, today: date | None = None) -> PublicHoliday | None:
        """
        The very next holiday for `state`, or None if the table has not been
        synced far enough ahead.

        Today counts as upcoming. A public holiday you are standing in is the
        most relevant answer there is, and a card that skipped to the next one
        would be the only thing on the phone that did not know it was Christmas.
        """
        today = today or date.today()
        return (
            cls.visible_to(state)
            .filter(date__gte=today)
            .order_by("date", "name")
            .first()
        )

    @classmethod
    def upcoming_for(
        cls, state: str, today: date | None = None, horizon: timedelta = HORIZON
    ) -> QuerySet[PublicHoliday]:
        """The next year of them, for the full calendar behind the card."""
        today = today or date.today()
        return (
            cls.visible_to(state)
            .filter(date__gte=today, date__lte=today + horizon)
            .order_by("date", "name")
        )


class HolidayPreference(models.Model):
    """
    Which state somebody's dashboard card is about.

    Its own row rather than a field on the profile, following TimePreference:
    where you work is a setting of this feature, not part of how you appear in
    MyWork, and keeping it here means the accounts app never learns what a
    public holiday is.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="holiday_pref"
    )
    state = models.CharField(
        max_length=8,
        choices=[(value, label) for value, label in State.choices if value != State.NATIONAL],
        # The Territory, because that is where this project's clock is set
        # (settings.TIME_ZONE is Australia/Darwin). Somebody elsewhere changes
        # it once and it is remembered.
        default=State.NT,
    )

    def __str__(self) -> str:
        return f"{self.user} watches {self.state} holidays"

    @classmethod
    def state_for(cls, user) -> str:
        """
        The state to show `user`, without writing a row to find out.

        get_or_create on every dashboard render would be a write on a read
        path; the default is the same either way, so an absent row simply
        means the default.
        """
        pref = getattr(user, "holiday_pref", None)
        return pref.state if pref else State.NT
