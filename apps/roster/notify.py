"""
What the roster tells people about: a friend needing cover, and a shift of
yours being picked up. The reminder before a shift is not here — that one
is the phone's own alarm, set by the app, because it has to go off at five
in the morning whether or not anybody is using the site (see
mobile/src/roster/reminders.ts).
"""

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.accounts.avatars import display_name
from apps.accounts.models import Friendship
from apps.notifications.models import Kind
from apps.notifications.notify import notify, notify_many

# The clock page on the site, the roster in the app (mobile/src/nav/paths.ts).
ROSTER_URL = "/timesheet/?go=roster"


def when(shift):
    """ "Sat 14 Nov, 9:00 am – 5:00 pm", in the zone in force."""
    starts, ends = timezone.localtime(shift.starts), timezone.localtime(shift.ends)
    clock = lambda t: t.strftime("%-I:%M %p").lower()
    return f"{starts:%a %-d %b}, {clock(starts)} – {clock(ends)}"


def offered(shift):
    friends = get_user_model().objects.filter(pk__in=Friendship.ids_for(shift.user), is_active=True)
    return notify_many(
        friends, Kind.ROSTER, f"{display_name(shift.user)} needs a shift covered",
        body=f"{when(shift)} at {shift.place}.", url=ROSTER_URL, actor=shift.user,
        dedupe_key=f"roster:offer:{shift.pk}",
    )


def taken(shift, giver):
    return notify(
        giver, Kind.ROSTER, f"{display_name(shift.user)} took your shift",
        body=f"{when(shift)} at {shift.place} is off your roster.", url=ROSTER_URL, actor=shift.user,
        dedupe_key=f"roster:taken:{shift.pk}",
    )
