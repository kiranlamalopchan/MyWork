"""
Put something in somebody's inbox, on purpose.

Two jobs, and the second is the one that gets used. The first is checking
that push works on a server you have just set up: it says whether keys are
configured, how many devices the person has subscribed, and how many of them
the send actually reached.

The second is simply having something to look at. An inbox nobody has been
notified in is an empty state, and an empty state tells you nothing about how
the list reads — so `--demo` fills it with one of every kind, which is enough
to see the colours, the badges and the day grouping working.

    python manage.py test_notification wayne
    python manage.py test_notification wayne --demo
    python manage.py test_notification wayne --clear

Everything it makes, `--clear` takes away again: the rows are tagged, so it
removes its own and never touches a real notification.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.notifications import push
from apps.notifications.models import Kind, Notification, PushSubscription
from apps.notifications.notify import notify

# What marks a row as this command's doing, so --clear can find them again
# and nothing else is ever caught by it.
TAG = "demo:test_notification"


class Command(BaseCommand):
    help = "Send a test notification, fill an inbox to look at, or clear both."

    def add_arguments(self, parser):
        parser.add_argument("username", help="Who to notify.")
        parser.add_argument(
            "--demo", action="store_true",
            help="Fill the inbox with one of every kind, to see how it reads.",
        )
        parser.add_argument(
            "--clear", action="store_true",
            help="Remove everything this command has ever made for them.",
        )

    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.get(username=options["username"])
        except get_user_model().DoesNotExist:
            known = ", ".join(
                get_user_model().objects.values_list("username", flat=True)[:10]
            )
            raise CommandError(
                f"No user called {options['username']!r}. Try one of: {known}"
            )

        if options["clear"]:
            gone, _ = Notification.objects.filter(
                recipient=user, dedupe_key__startswith=TAG
            ).delete()
            self.stdout.write(self.style.SUCCESS(f"Removed {gone} demo notification(s)."))
            return

        self._report_push(user)

        if options["demo"]:
            self._demo(user)
        else:
            self._one(user)

    # ---- what it can tell you before it tries ---------------------------

    def _report_push(self, user):
        devices = PushSubscription.objects.filter(user=user).count()

        if not push.configured():
            self.stdout.write(self.style.WARNING(
                "Push is not configured — no VAPID keys. The notification will be "
                "recorded and shown on the bell, but nothing will reach a phone.\n"
                "  Fix: python manage.py vapid_keys, put the lines in .env, reload."
            ))
        elif devices == 0:
            self.stdout.write(self.style.WARNING(
                f"{user} has no subscribed devices. The notification will be "
                "recorded and shown on the bell, but there is nowhere to push it.\n"
                "  Fix: open the bell on the device, tap Turn on, accept the prompt."
            ))
        else:
            self.stdout.write(f"Push is configured; {user} has {devices} device(s).")

    # ---- the two things it makes ----------------------------------------

    def _one(self, user):
        made = notify(
            user, Kind.NOTICE, "Test notification",
            body="If this reached your phone, push is working.",
            url="/notices/",
            dedupe_key=f"{TAG}:one:{timezone.now().timestamp()}",
        )
        self.stdout.write(self.style.SUCCESS(f"Recorded: {made.title}"))

    def _demo(self, user):
        """
        One of every kind, spread over two days so the grouping shows.

        The actor is whoever else exists, because the colour of a row comes
        from the person behind it — a demo where every row is the same person
        would hide the one thing most worth looking at.
        """
        others = list(
            get_user_model().objects.filter(is_active=True).exclude(pk=user.pk)[:3]
        )
        if not others:
            self.stdout.write(self.style.WARNING(
                "Nobody else has an account, so every row will be the app's own. "
                "The per-person colours need a second person to show."
            ))

        def actor(n):
            return others[n % len(others)] if others else None

        rows = [
            (actor(0), Kind.NOTICE, "{who} posted a notice",
             "Fridge in the back room is fixed — you can use it again from this "
             "afternoon.", "", timedelta(minutes=4)),
            (actor(1), Kind.REPLY, "{who} replied to you",
             "This morning, before we open. I will leave the key under the tray.",
             "", timedelta(minutes=26)),
            (actor(2), Kind.REACTION, "{who} reacted to your notice",
             "Swapping my Friday shift if anyone wants it.", "❤️", timedelta(hours=2)),
            (None, Kind.TIMESHEET, "You're still clocked in",
             "12h 14m at work. Clock out if the shift has ended.", "",
             timedelta(hours=5)),
            (actor(0), Kind.COMMENT, "{who} commented on your notice",
             "Thanks for sorting that out.", "", timedelta(days=1, hours=2)),
        ]

        for n, (who, kind, title, body, emoji, ago) in enumerate(rows):
            name = who.get_username() if who else ""
            made = Notification.objects.create(
                recipient=user, actor=who, kind=kind,
                title=title.format(who=name), body=body, emoji=emoji,
                url="/notices/", dedupe_key=f"{TAG}:demo:{n}",
            )
            # Backdated after the fact: created_at is auto_now_add, so it can
            # only be moved by an update.
            Notification.objects.filter(pk=made.pk).update(
                created_at=timezone.now() - ago
            )

        self.stdout.write(self.style.SUCCESS(
            f"{len(rows)} demo notifications in {user}'s inbox. "
            "Open the bell to see them; they are marked read on the way out.\n"
            f"  Undo: python manage.py test_notification {user} --clear"
        ))
