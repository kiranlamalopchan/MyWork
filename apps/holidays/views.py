"""
The API the mobile app calls, and the page behind the card.

One endpoint and one screen. The endpoint answers the only question a
dashboard card has — what is next, where I am — and the screen is what "View
full calendar" opens when that answer is not enough.
"""

from __future__ import annotations

from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .models import HolidayPreference, PublicHoliday, State
from .services import HolidayCard, by_month, card_for_user, next_card


@require_GET
@login_required
def next_holiday(request: HttpRequest) -> JsonResponse:
    """
    GET /holidays/api/next/?state=NSW

    The immediate next public holiday for one state, pre-formatted.

    `state` is optional: without it the caller gets whatever the signed-in
    person has set, which is what the app's own dashboard wants. With it, it
    gets that state — so one endpoint serves both the card and a state picker
    without a second URL.

    An unknown state is a 400 naming the eight that exist, rather than a
    silent fallback to somewhere the person does not live.
    """
    asked = request.GET.get("state")

    if asked and not State.is_state(asked):
        return JsonResponse(
            {
                "error": f"Unknown state {asked!r}.",
                "states": State.states(),
            },
            status=400,
        )

    if asked:
        state = asked.upper()
        card = next_card(state)
    else:
        state, card = card_for_user(request.user)

    return JsonResponse({
        "state": state,
        "holiday": card.as_payload() if card else None,
    })


@login_required
def calendar(request: HttpRequest):
    """
    The year ahead, for whoever is looking — the page the card points at.

    `?state=` works here too, so the link the app opens and a person browsing
    another state land on the same screen.

    Folded into months before it reaches the template. A year is a dozen
    headings rather than fifteen identical rows, which on a phone is the
    difference between a calendar and a scroll.
    """
    asked = request.GET.get("state")
    state = asked.upper() if State.is_state(asked) else HolidayPreference.state_for(request.user)

    cards = [HolidayCard.of(holiday) for holiday in PublicHoliday.upcoming_for(state)]
    months = by_month(cards)

    return render(request, "holidays/calendar.html", {
        "state": state,
        "state_label": State(state).label,
        "months": months,
        "total": len(cards),
        "states": [(value, State(value).label) for value in State.states()],
        "section_title": "Public holidays",
    })
