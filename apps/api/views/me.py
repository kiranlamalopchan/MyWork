"""You: what the app shows in its own corner, and lets you change."""

from django.contrib.auth.models import AnonymousUser
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.forms import PhotoForm, ProfileForm
from apps.accounts.models import Profile
from apps.accounts.views import delete_account
from apps.holidays.models import HolidayPreference, State
from apps.notifications.models import Device

from .. import serialize
from ..errors import form_errors


class Me(APIView):
    def get(self, request):
        return Response(serialize.me(request, request.user))

    def patch(self, request):
        """The words about you. Fields left out stay as they are."""
        profile = Profile.of(request.user)
        current = {
            "username": request.user.get_username(),
            "display_name": profile.display_name,
            "email": request.user.email,
            "phone": profile.phone,
            "address": profile.address,
        }
        current.update({k: v for k, v in request.data.items() if k in current})
        form = ProfileForm(current, instance=profile)
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        form.save()
        return Response(serialize.me(request, request.user))

    def delete(self, request):
        """
        The account and everything in it, behind the password — what the
        app's "Delete account" does (see apps/accounts/views.delete_account
        for what goes).
        """
        if not request.user.check_password(str(request.data.get("password", ""))):
            return Response({"detail": "That password isn't right."}, status=status.HTTP_400_BAD_REQUEST)
        delete_account(request.user)
        request._request.user = AnonymousUser()
        return Response(status=status.HTTP_204_NO_CONTENT)


class Photo(APIView):
    def post(self, request):
        form = PhotoForm(request.data, request.FILES)
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        Profile.of(request.user).set_photo(form.cleaned_data["photo"])
        return Response(serialize.me(request, request.user))

    def delete(self, request):
        Profile.of(request.user).clear_photo()
        return Response(serialize.me(request, request.user))


class HolidayState(APIView):
    def put(self, request):
        state = (request.data.get("state") or "").upper()
        if not State.is_state(state):
            return Response(
                {"detail": "Choose one of the states.", "states": State.states()},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pref, _ = HolidayPreference.objects.get_or_create(user=request.user)
        pref.state = state
        pref.save(update_fields=["state"])
        return Response(serialize.me(request, request.user))


class Devices(APIView):
    """The phone this app is on, so it can be buzzed."""

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        if not token:
            return Response({"detail": "A push token is needed."}, status=status.HTTP_400_BAD_REQUEST)
        Device.store(
            request.user, token,
            platform=request.data.get("platform") or "",
            name=request.data.get("name") or "",
        )
        return Response({"ok": True}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        token = (request.data.get("token") or "").strip()
        Device.objects.filter(user=request.user, expo_token=token).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class Activity(APIView):
    """
    The profile page's other two panels: what you have done in MyWork, and
    where the statement form opens — the same figures accounts.views gathers.
    """

    def get(self, request):
        from datetime import timedelta

        from django.utils import timezone

        from apps.accounts.views import _activity
        from apps.timeclock.models import Workplace

        today = timezone.localdate()
        last_month_end = today.replace(day=1) - timedelta(days=1)
        return Response({
            **_activity(request.user),
            "statement": {
                "this_month": [today.replace(day=1).isoformat(), today.isoformat()],
                "last_month": [last_month_end.replace(day=1).isoformat(), last_month_end.isoformat()],
                "today": today.isoformat(),
                "workplaces": [{"id": w.pk, "name": w.name} for w in Workplace.objects.filter(user=request.user)],
            },
        })
