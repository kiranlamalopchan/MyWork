"""Signing in and up. The only views anyone may reach without a token."""

from django.contrib.auth import authenticate
from django.contrib.auth.forms import UserCreationForm
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.models import Device

from .. import serialize
from ..errors import form_errors


def _signed_in(request, user):
    token, _ = Token.objects.get_or_create(user=user)
    return {"token": token.key, "me": serialize.me(request, user)}


class Login(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        user = authenticate(
            request,
            username=(request.data.get("username") or "").strip(),
            password=request.data.get("password") or "",
        )
        if user is None:
            return Response(
                {"detail": "That username and password don't match."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(_signed_in(request, user))


class Register(APIView):
    """The same form the site's /register/ uses, so the same rules apply."""

    permission_classes = [AllowAny]

    def post(self, request):
        password = request.data.get("password") or ""
        form = UserCreationForm({
            "username": (request.data.get("username") or "").strip(),
            "password1": password,
            "password2": password,
        })
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        user = form.save()
        return Response(_signed_in(request, user), status=status.HTTP_201_CREATED)


class Logout(APIView):
    """Forget the token — and the phone, if the app says which."""

    def post(self, request):
        expo_token = request.data.get("device")
        if expo_token:
            Device.objects.filter(user=request.user, expo_token=expo_token).delete()
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
