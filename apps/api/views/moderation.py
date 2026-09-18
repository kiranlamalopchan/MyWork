"""Blocking a person and reporting a post — the app's side of apps.moderation."""

from django.contrib.auth import get_user_model
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.moderation.models import Block, Kind, Reason, Report

from .. import serialize

User = get_user_model()


class BlockPerson(APIView):
    """POST blocks `username`; DELETE unblocks. Either answers with where things stand."""

    def post(self, request, username):
        them = get_object_or_404(User, username=username, is_active=True)
        if them.pk == request.user.pk:
            return Response({"detail": "You can't block yourself."}, status=status.HTTP_400_BAD_REQUEST)
        Block.block(request.user, them)
        return Response({"blocked": True, "detail": f"{them.get_username()} is blocked. You won't see each other's posts."})

    def delete(self, request, username):
        them = get_object_or_404(User, username=username)
        Block.unblock(request.user, them)
        return Response({"blocked": False, "detail": f"{them.get_username()} is unblocked."})


class Blocked(APIView):
    """Everyone you have blocked — the list under Profile."""

    def get(self, request):
        rows = Block.objects.filter(blocker=request.user).select_related("blocked", "blocked__profile")
        return Response({
            "people": [
                {"person": serialize.person(request, b.blocked, request.user), "since": b.created_at.strftime("%-d %b %Y")}
                for b in rows
            ],
        })


def _target(kind, pk):
    from apps.noticeboard.models import Comment, Notice
    from apps.stories.models import Story
    model = {Kind.NOTICE: Notice, Kind.COMMENT: Comment, Kind.STORY: Story, Kind.USER: User}.get(kind)
    if model is None:
        raise Http404
    return get_object_or_404(model, pk=pk)


class ReportThing(APIView):
    """
    POST {kind, id, reason, note?}: flag a notice, comment, story or person.
    Answers with the reasons it knows about too, so a screen can offer them
    without a second call (GET gives the same list on its own).
    """

    def get(self, request):
        return Response({"reasons": [{"value": v, "label": l} for v, l in Reason.choices]})

    def post(self, request):
        kind = request.data.get("kind") or ""
        pk = str(request.data.get("id") or "")
        if kind not in Kind.values or not pk.isdigit():
            return Response({"detail": "Nothing to report."}, status=status.HTTP_400_BAD_REQUEST)
        target = _target(kind, int(pk))
        who = target if kind == Kind.USER else getattr(target, "author", None)
        if who is not None and who.pk == request.user.pk:
            return Response({"detail": "You can't report your own."}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get("reason") or Reason.OTHER
        if reason not in Reason.values:
            reason = Reason.OTHER
        Report.file(request.user, kind, target, reason, request.data.get("note") or "")
        return Response(
            {"detail": "Thanks — it's been reported and will be reviewed within 24 hours."},
            status=status.HTTP_201_CREATED,
        )
