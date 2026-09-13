"""
Take down every story whose day is up — files included.

A story stops showing the moment it expires whether or not this runs; this
is what gets the photo off the disk. Run it on a schedule (PythonAnywhere's
Tasks tab, once an hour is plenty).
"""

from django.core.management.base import BaseCommand

from ...models import Story


class Command(BaseCommand):
    help = "Delete stories older than 24 hours, and their photos."

    def handle(self, *args, **options):
        gone = Story.sweep()
        self.stdout.write(f"{gone} expired stor{'y' if gone == 1 else 'ies'} removed.")
