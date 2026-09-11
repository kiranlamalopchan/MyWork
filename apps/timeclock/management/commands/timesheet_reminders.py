"""
The scheduled half of notifications.

Everything else MyWork notifies about happens because somebody pressed
something, and can be raised in the request that pressed it. A forgotten
clock-out is the opposite: nothing happens, and that is the thing worth
saying. So it needs something outside a request to notice, which on a host
like PythonAnywhere is a scheduled task running:

    python manage.py timesheet_reminders

every twenty minutes or so. Running it more often is harmless — each reminder
is keyed to the shift or the period it is about, so a second run rewrites the
line it already sent rather than sending another one.
"""

from django.core.management.base import BaseCommand

from apps.timeclock.notify import run_all


class Command(BaseCommand):
    help = "Raise timesheet reminders: forgotten clock-outs and hours caps."

    def add_arguments(self, parser):
        parser.add_argument(
            "--quiet",
            action="store_true",
            help="Say nothing unless something was raised — for a cron log.",
        )

    def handle(self, *args, **options):
        made = run_all()

        if not made:
            if not options["quiet"]:
                self.stdout.write("Nothing to remind anyone about.")
            return

        for notification in made:
            self.stdout.write(
                f"{notification.recipient}: {notification.title} — {notification.body}"
            )
        self.stdout.write(self.style.SUCCESS(f"{len(made)} reminder(s) raised."))
