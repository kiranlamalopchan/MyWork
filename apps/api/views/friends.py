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

from .. import serialize


class Friends(APIView):
    """
    Everything the Friends screen shows: your friends, your pending requests
    both ways, and everyone else you could ask — one call, since a
    workplace's user list is small enough that a screen doesn't need to
    split "find people" from "manage your list" into calls of their own.
    """

    def get(self, request):
        me = request.user
        friend_ids = Friendship.ids_for(me)
        received = list(
            FriendRequest.objects.filter(to_user=me).select_related(
                "from_user", "from_user__profile"
            )
        )
        sent = list(
            FriendRequest.objects.filter(from_user=me).select_related(
                "to_user", "to_user__profile"
            )
        )
        pending_to = {r.to_user_id for r in sent}
        pending_from = {r.from_user_id for r in received}

        from apps.moderation.models import Block
        people = get_user_model().objects.filter(is_active=True).exclude(pk=me.pk).exclude(pk__in=Block.ids_for(me))
        query = (request.GET.get("q") or "").strip()
        if query:
            people = people.filter(username__icontains=query)
        people = list(people.select_related("profile").order_by("username"))

        return Response({
            "friends": [
                serialize.person(request, p, me) for p in people if p.pk in friend_ids
            ],
            "received": [
                {"id": r.pk, "person": serialize.person(request, r.from_user, me)}
                for r in received
            ],
            "sent": [
                {"id": r.pk, "person": serialize.person(request, r.to_user, me)}
                for r in sent
            ],
            "others": [
                serialize.person(request, p, me) for p in people
                if p.pk not in friend_ids and p.pk not in pending_to and p.pk not in pending_from
            ],
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
