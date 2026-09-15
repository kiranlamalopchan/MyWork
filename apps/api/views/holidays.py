"""Public holidays: the card, and the year ahead behind it."""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.holidays.models import HolidayPreference, PublicHoliday, State
from apps.holidays.services import HolidayCard, card_for_user, next_card


def _state(request):
    """The state asked for, or the person's own; None if it isn't one."""
    asked = request.GET.get("state")
    if asked and not State.is_state(asked):
        return None
    return asked.upper() if asked else HolidayPreference.state_for(request.user)


def _unknown():
    return Response({"detail": "Unknown state.", "states": State.states()}, status=400)


class Next(APIView):
    def get(self, request):
        state = _state(request)
        if state is None:
            return _unknown()
        card = next_card(state)
        return Response({"state": state, "holiday": card.as_payload() if card else None})


class Upcoming(APIView):
    def get(self, request):
        state = _state(request)
        if state is None:
            return _unknown()
        return Response({
            "state": state,
            "states": State.states(),
            "holidays": [HolidayCard.of(h).as_payload() for h in PublicHoliday.upcoming_for(state)],
        })
