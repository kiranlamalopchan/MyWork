"""
Load Australian public holidays into the database.

    python manage.py sync_holidays              # this year and the next two
    python manage.py sync_holidays --years 2026 2027
    python manage.py sync_holidays --list NSW   # show what it stored

Run it once after deploying, and again each year — a scheduled task in
January, or by hand when somebody notices the card has run out. It is
idempotent, so running it more often costs nothing but a few hundred rows
rewritten inside one transaction.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.holidays.models import PublicHoliday, State
from apps.holidays.sync import sync, years_from


class Command(BaseCommand):
    help = "Refresh stored Australian public holidays from the holidays package."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--years", nargs="+", type=int, default=None,
            help="Which years to load. Defaults to this year and the next two.",
        )
        parser.add_argument(
            "--list", metavar="STATE", default=None,
            help="After syncing, print what a given state now sees.",
        )

    def handle(self, *args, **options) -> None:
        years = options["years"] or years_from()
        written = sync(years)

        national = PublicHoliday.objects.filter(state=State.NATIONAL).count()
        self.stdout.write(self.style.SUCCESS(
            f"{written} holidays stored for {', '.join(str(y) for y in years)} "
            f"({national} national, the rest state-specific)."
        ))

        asked = options["list"]
        if not asked:
            return

        if not State.is_state(asked):
            raise CommandError(
                f"Unknown state {asked!r}. One of: {', '.join(State.states())}"
            )

        state = asked.upper()
        self.stdout.write("")
        self.stdout.write(f"Next twelve months in {state}:")
        for holiday in PublicHoliday.upcoming_for(state):
            where = "national" if holiday.is_national else holiday.state
            self.stdout.write(
                f"  {holiday.date:%a %d %b %Y}  {holiday.name}  ({where})"
            )
