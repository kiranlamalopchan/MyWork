"""
The notice board: read by everyone, and only ever your own to change.

Every rule is the site's — the views call the same forms, model methods and
notify functions the HTML views do, so a notice posted from a phone is
notified, folded and owned exactly like one posted from the board.
"""

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.noticeboard import notify
from apps.noticeboard.forms import CommentForm, NoticeForm
from apps.noticeboard.models import Comment, CommentReaction, Notice, Reaction
from apps.noticeboard.views import PER_PAGE, PROFILE_LIMIT

from .. import serialize
from ..errors import form_errors


class Notices(APIView):
    def get(self, request):
        page, meta = serialize.page_of(request, Notice.visible(), PER_PAGE)
        meta["results"] = [serialize.notice(request, n, request.user) for n in page.object_list]
        return Response(meta)

    def post(self, request):
        form = NoticeForm(request.data)
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        notice = form.save(commit=False)
        notice.author = request.user
        notice.save()
        # After the save, never inside it — see noticeboard.views.notice_create.
        notify.notice_posted(notice)
        return Response(_fresh(request, notice.pk), status=status.HTTP_201_CREATED)


def _fresh(request, pk, folded=False):
    """A notice re-read with everything prefetched, after a change to it."""
    return serialize.notice(request, Notice.visible().get(pk=pk), request.user, folded=folded)


class NoticeDetail(APIView):
    def get(self, request, pk):
        notice = get_object_or_404(Notice.visible(), pk=pk)
        return Response(serialize.notice(request, notice, request.user, folded=False))

    def patch(self, request, pk):
        # Only ever your own — someone else's is a 404, not a 403.
        notice = get_object_or_404(Notice.editable_by(request.user), pk=pk)
        form = NoticeForm(request.data, instance=notice)
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        form.save()
        return Response(_fresh(request, pk))

    def delete(self, request, pk):
        notice = get_object_or_404(Notice.editable_by(request.user), pk=pk)
        notice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoticeReact(APIView):
    def post(self, request, pk):
        notice = get_object_or_404(Notice.visible_for_react(), pk=pk)
        left = Reaction.toggle(notice, request.user, request.data.get("emoji", ""))
        notify.notice_reacted(notice, request.user, left)
        notice = Notice.visible_for_react().get(pk=pk)
        return Response(serialize.reactions(notice, request.user))


class NoticeReactors(APIView):
    def get(self, request, pk):
        notice = get_object_or_404(Notice.visible(), pk=pk)
        return Response(serialize.reactors(request, notice, request.user))


class Comments(APIView):
    def post(self, request, pk):
        notice = get_object_or_404(Notice, pk=pk)
        parent = Comment.under(notice, request.data.get("parent"))
        form = CommentForm(request.data)
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        comment = form.save(commit=False)
        comment.notice = notice
        comment.parent = parent
        comment.author = request.user
        comment.save()
        notify.comment_posted(comment)
        return Response(_fresh(request, notice.pk), status=status.HTTP_201_CREATED)


def _comment(pk):
    return Comment.objects.select_related("notice", "author", "author__profile").prefetch_related("reactions__user")


class CommentDetail(APIView):
    def delete(self, request, pk):
        comment = get_object_or_404(Comment.editable_by(request.user), pk=pk)
        notice_pk = comment.notice_id
        # Its replies go with it, as on the site.
        comment.delete()
        return Response(_fresh(request, notice_pk))


class CommentReact(APIView):
    def post(self, request, pk):
        comment = get_object_or_404(_comment(pk), pk=pk)
        left = CommentReaction.toggle(comment, request.user, request.data.get("emoji", ""))
        notify.comment_reacted(comment, request.user, left)
        comment = _comment(pk).get(pk=pk)
        return Response(serialize.reactions(comment, request.user))


class CommentReactors(APIView):
    def get(self, request, pk):
        comment = get_object_or_404(_comment(pk), pk=pk)
        return Response(serialize.reactors(request, comment, request.user))


class Person(APIView):
    """Somebody's page: who they are on the board and what they have posted."""

    def get(self, request, username):
        people = get_user_model().objects.annotate(
            notice_count=Count("notices", distinct=True),
            comment_count=Count("comments", distinct=True),
        )
        user = get_object_or_404(people, username=username)
        notices = list(Notice.visible().filter(author=user)[:PROFILE_LIMIT])
        return Response({
            "person": serialize.person(request, user, request.user),
            "notice_count": user.notice_count,
            "comment_count": user.comment_count,
            "received": (
                Reaction.objects.filter(notice__author=user).count()
                + CommentReaction.objects.filter(comment__author=user).count()
            ),
            "given": (
                Reaction.objects.filter(user=user).count()
                + CommentReaction.objects.filter(user=user).count()
            ),
            "notices": [serialize.notice(request, n, request.user) for n in notices],
        })
