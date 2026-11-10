"""
Who your "Friends only" posts and comments reach — the same rules and the
same rows as `apps.accounts.views.friends`, as data for the app.
"""

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import notify
from apps.accounts.models import FriendRequest, Friendship
from apps.accounts.views import _friends_context

from .. import serialize


class Friends(APIView):
    """
    Everything the Friends screen shows: your friends, your pending requests
    both ways, and the first few of everyone else you could ask — one call;
    the rest of everyone else is a search away rather than sent in full.
    """

    def get(self, request):
        me = request.user
        # The site's own lists, so the two cannot drift: "others" is only
        # the first few, with `others_total` saying how many there are and
        # ?q= reaching the rest.
        lists = _friends_context(me, request.GET.get("q"))
        return Response({
            "friends": [serialize.person(request, p, me) for p in lists["friend_list"]],
            "received": [
                {"id": r.pk, "person": serialize.person(request, r.from_user, me)}
                for r in lists["friends_received"]
            ],
            "sent": [
                {"id": r.pk, "person": serialize.person(request, r.to_user, me)}
                for r in lists["friends_sent"]
            ],
            "others": [serialize.person(request, p, me) for p in lists["friends_others"]],
            "others_total": lists["friends_others_total"],
        })


class FriendRequestSend(APIView):
    def post(self, request, username):
        me = request.user
        them = get_object_or_404(get_user_model(), username=username, is_active=True)

        if them.pk == me.pk:
            return Response({"detail": "You can't friend yourself."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.moderation.models import Block
        if Block.between(me, them):
            return Response({"detail": "That request can't be sent."}, status=status.HTTP_400_BAD_REQUEST)

        if Friendship.are_friends(me, them):
            return Response({"detail": "Already friends.", "status": "friends"})

        # A crossed pair — they already asked you — settles into a
        # friendship in one step rather than leaving two requests pending.
        theirs = FriendRequest.objects.filter(from_user=them, to_user=me).first()
        if theirs is not None:
            theirs.accept()
            notify.friend_accepted(me, them)
            return Response({"detail": "Now friends.", "status": "friends"})

        friend_request, created = FriendRequest.objects.get_or_create(from_user=me, to_user=them)
        if created:
            notify.friend_requested(friend_request)
        return Response(
            {"detail": "Request sent.", "status": "sent"},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FriendRequestAccept(APIView):
    def post(self, request, pk):
        friend_request = get_object_or_404(FriendRequest, pk=pk, to_user=request.user)
        friend_request.accept()
        notify.friend_accepted(request.user, friend_request.from_user)
        return Response({"status": "friends"})


class FriendRequestDecline(APIView):
    def post(self, request, pk):
        friend_request = get_object_or_404(
            FriendRequest.objects.filter(to_user=request.user)
            | FriendRequest.objects.filter(from_user=request.user),
            pk=pk,
        )
        friend_request.decline()
        return Response(status=status.HTTP_204_NO_CONTENT)


class FriendRemove(APIView):
    def post(self, request, username):
        them = get_object_or_404(get_user_model(), username=username)
        Friendship.unfriend(request.user, them)
        return Response(status=status.HTTP_204_NO_CONTENT)
