"""The hub, as data: what the app's first tab draws."""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.holidays.services import card_for_user
from apps.noticeboard.views import recent_for_hub
from apps.notifications.models import Notification
from apps.stories.views import tray_for

from .. import serialize


class Home(APIView):
    def get(self, request):
        user = request.user
        notices, total = recent_for_hub(user)
        state, card = card_for_user(user)
        return Response({
            "holiday": {"state": state, "holiday": card.as_payload() if card else None},
            "stories": [serialize.tray_row(request, row, user) for row in tray_for(user)],
            "notices": [serialize.notice(request, n, user) for n in notices],
            "notice_total": total,
            "unread": Notification.unread_count(user),
            "emoji": serialize.emoji_choices(),
        })
