"""The hub, as data: what the app's first tab draws."""

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.holidays.services import card_for_user
from apps.holidays.whereabouts import guess_state
from apps.noticeboard.models import Notice
from apps.noticeboard.views import HUB_LIMIT
from apps.notifications.models import Notification
from apps.stories.views import tray_for
from mywork.daily import daily
from mywork.seasons import home_festival_banner
from django.templatetags.static import static

from .. import serialize


class Home(APIView):
    def get(self, request):
        user = request.user

        # Not `recent_for_hub()` — that decorates for the *site's* board
        # partial (see noticeboard.views.decorate), which stashes
        # `comment_total` as a plain number for the template. `serialize.
        # notice()` below calls it as the method it still is on a plain,
        # undecorated notice, so the two must not share objects.
        visible = Notice.visible(user)
        notices = list(visible[:HUB_LIMIT])
        total = visible.count()

        banner = home_festival_banner()
        if banner:
            banner = {**banner, 'image_url': request.build_absolute_uri(banner.get('uploaded_art') or static(banner['art']))}
        state, card = card_for_user(user, guess=guess_state(request))
        return Response({
            "festival": banner,
            "holiday": {"state": state, "holiday": card.as_payload() if card else None},
            "stories": [serialize.tray_row(request, row, user) for row in tray_for(user)],
            "notices": [serialize.notice(request, n, user) for n in notices],
            "notice_total": total,
            "unread": Notification.unread_count(user),
            "emoji": serialize.emoji_choices(),
            # The wide hub's extras: today's date in words, a thought for the
            # day and a little laugh — the same for everyone until midnight.
            "today": timezone.localdate().strftime("%A, %-d %B"),
            "daily": daily(timezone.localdate()),
        })
