"""Messages between friends, for the app. See apps/chat/models.py."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chat import notify
from apps.chat.models import MAX_LENGTH, Message
from apps.moderation.models import Block

from .. import serialize

# A screenful and a bit; older ones are asked for as the thread is scrolled up.
PAGE = 30


def message_json(message, viewer):
    sent = timezone.localtime(message.created_at)
    return {
        "id": message.pk,
        "body": message.body,
        "mine": message.sender_id == viewer.pk,
        "at": message.created_at.isoformat(),
        "day": sent.strftime("%a %-d %b"),
        "time": sent.strftime("%-I:%M %p").lower(),
        "read": message.read_at is not None,
    }


class Threads(APIView):
    """Everyone you have a conversation with, newest first, and how many lines are unread."""

    def get(self, request):
        me = request.user
        threads = Message.threads_for(me)
        return Response({
            "threads": [
                {
                    "person": serialize.person(request, other, me),
                    "last": message_json(last, me),
                    "unread": unread,
                }
                for other, last, unread in threads
            ],
            "unread": sum(unread for _, _, unread in threads),
        })


class Unread(APIView):
    def get(self, request):
        return Response({"unread": Message.unread_count(request.user)})


class Thread(APIView):
    """
    GET: the newest page of a conversation (or the page before ?before=<id>),
    oldest first, and their lines marked read. POST {body}: say something.
    """

    def _other(self, request, username):
        other = get_object_or_404(get_user_model(), username=username, is_active=True)
        # Somebody blocked is somebody who is not there.
        if other.pk == request.user.pk or Block.between(request.user, other):
            return None
        return other

    def get(self, request, username):
        me, other = request.user, self._other(request, username)
        if other is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        rows = Message.between(me, other)
        before = str(request.GET.get("before") or "")
        if before.isascii() and before.isdigit() and len(before) <= 18:
            rows = rows.filter(pk__lt=int(before))
        page = list(rows[: PAGE + 1])
        more = len(page) > PAGE
        page = page[:PAGE]
        Message.mark_read(me, other)
        return Response({
            "person": serialize.person(request, other, me),
            "can_send": Message.can_talk(me, other),
            "max_length": MAX_LENGTH,
            "messages": [message_json(m, me) for m in reversed(page)],
            "more": more,
        })

    def post(self, request, username):
        me, other = request.user, self._other(request, username)
        if other is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            message = Message.send(me, other, request.data.get("body"))
        except ValidationError as why:
            return Response({"detail": " ".join(why.messages)}, status=status.HTTP_400_BAD_REQUEST)
        notify.message_sent(message)
        return Response(message_json(message, me), status=status.HTTP_201_CREATED)
