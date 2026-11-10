"""
The roster, for the app: the shifts you are due to work, the ones your
friends need covered, and handing one on. See apps/roster/models.py.
"""

from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.roster import notify
from apps.roster.models import PlannedShift
from apps.timeclock.models import Workplace
from apps.timeclock.views import hm_words

from .. import serialize
from .timeclock import workplace_brief


def planned(request, shift, viewer):
    starts, ends = timezone.localtime(shift.starts), timezone.localtime(shift.ends)
    clock = lambda t: t.strftime("%-I:%M %p").lower()
    mine = shift.user_id == viewer.pk
    return {
        "id": shift.pk,
        "starts": shift.starts.isoformat(),
        "ends": shift.ends.isoformat(),
        "day": starts.strftime("%a %-d %b"),
        "date": starts.date().isoformat(),
        "time": f"{clock(starts)} – {clock(ends)}",
        "length": hm_words(shift.duration),
        "place": shift.place,
        "workplace": workplace_brief(shift.workplace) if mine else None,
        "note": shift.note,
        "offered": shift.offered,
        "mine": mine,
        "owner": None if mine else serialize.person(request, shift.user, viewer),
        "given_by": serialize.person(request, shift.given_by, viewer) if mine and shift.given_by_id else None,
    }


def roster_page(request):
    me = request.user
    return {
        "mine": [planned(request, s, me) for s in PlannedShift.upcoming_for(me)],
        "offers": [planned(request, s, me) for s in PlannedShift.offers_for(me)],
        "workplaces": [workplace_brief(w) for w in Workplace.objects.filter(user=me)],
    }


def _when(value):
    """A date and time off the phone, which sends its own offset with it."""
    try:
        moment = parse_datetime(str(value or ""))
    except (TypeError, ValueError, OverflowError):
        return None
    if moment is None:
        return None
    return moment if timezone.is_aware(moment) else timezone.make_aware(moment)


def _fill(request, shift):
    """
    Put what the phone sent into `shift`. Returns {field: message} for
    anything that will not do, and nothing when it is ready to save.
    """
    data, errors = request.data, {}

    if "workplace" in data or shift.pk is None:
        raw = str(data.get("workplace") or "")
        pk = int(raw) if raw.isascii() and raw.isdigit() and len(raw) <= 18 else 0
        workplace = Workplace.objects.filter(user=request.user, pk=pk).first()
        if workplace is None:
            errors["workplace"] = ["Choose where the shift is."]
        else:
            shift.workplace = workplace
    for name in ("starts", "ends"):
        if name in data or shift.pk is None:
            moment = _when(data.get(name))
            if moment is None:
                errors[name] = ["Choose a date and a time."]
            else:
                setattr(shift, name, moment)
    if "note" in data:
        shift.note = str(data.get("note") or "").strip()[:200]

    if not errors:
        try:
            shift.clean()
        except ValidationError as why:
            errors.update(why.message_dict)
    if not errors and shift.ends <= timezone.now():
        errors["ends"] = ["That has already finished — the roster is for shifts still to come."]
    return errors


def _refused(errors):
    first = next(iter(errors.values()))[0]
    return Response({"detail": first, "fields": errors}, status=status.HTTP_400_BAD_REQUEST)


class Roster(APIView):
    def get(self, request):
        return Response(roster_page(request))

    def post(self, request):
        shift = PlannedShift(user=request.user)
        errors = _fill(request, shift)
        if errors:
            return _refused(errors)
        shift.save()
        return Response(roster_page(request), status=status.HTTP_201_CREATED)


class RosterShift(APIView):
    def _mine(self, request, pk):
        return get_object_or_404(PlannedShift, pk=pk, user=request.user)

    def patch(self, request, pk):
        shift = self._mine(request, pk)
        errors = _fill(request, shift)
        if errors:
            return _refused(errors)
        shift.save()
        return Response(roster_page(request))

    def delete(self, request, pk):
        self._mine(request, pk).delete()
        return Response(roster_page(request))


class RosterOffer(APIView):
    """POST puts your shift up for a friend to take; DELETE takes it back."""

    def post(self, request, pk):
        shift = get_object_or_404(PlannedShift, pk=pk, user=request.user)
        was = shift.offered
        try:
            shift.offer()
        except ValidationError as why:
            return Response({"detail": " ".join(why.messages)}, status=status.HTTP_400_BAD_REQUEST)
        if not was:
            notify.offered(shift)
        return Response(roster_page(request))

    def delete(self, request, pk):
        get_object_or_404(PlannedShift, pk=pk, user=request.user).withdraw()
        return Response(roster_page(request))


class RosterTake(APIView):
    def post(self, request, pk):
        try:
            shift, giver = PlannedShift.take(pk, request.user)
        except ValidationError as why:
            page = roster_page(request)
            page["detail"] = " ".join(why.messages)
            return Response(page, status=status.HTTP_409_CONFLICT)
        notify.taken(shift, giver)
        return Response(roster_page(request))
