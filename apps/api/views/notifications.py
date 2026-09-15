"""The bell: what you have been told, and marking it read."""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.models import Notification
from apps.notifications.views import PAGE_SIZE

from .. import serialize


class Inbox(APIView):
    def get(self, request):
        page, meta = serialize.page_of(request, Notification.inbox(request.user), PAGE_SIZE)
        meta["results"] = [serialize.notification(request, n, request.user) for n in page.object_list]
        meta["unread"] = Notification.unread_count(request.user)
        return Response(meta)


class Unread(APIView):
    def get(self, request):
        return Response({"unread": Notification.unread_count(request.user)})


class ReadAll(APIView):
    def post(self, request):
        Notification.mark_all_read(request.user)
        return Response({"unread": 0})


class Read(APIView):
    """One notification dealt with: read, and where it points."""

    def post(self, request, pk):
        notification = get_object_or_404(Notification.objects.filter(recipient=request.user), pk=pk)
        if notification.is_unread:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response({
            "url": notification.url or "/",
            "unread": Notification.unread_count(request.user),
        })
