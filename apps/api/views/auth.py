"""Signing in and up. The only views anyone may reach without a token."""

from django.contrib.auth import authenticate
from apps.accounts.forms import RegistrationForm
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.models import Device
from apps.accounts.recovery import RecoveryForm, RecoveryLimited, RecoveryUnavailable, RESET_MESSAGE, request_reset

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
        form = RegistrationForm({
            "username": (request.data.get("username") or "").strip(),
            "email": request.data.get("email") or "",
            "password1": password,
            "password2": password,
        })
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        user = form.save()
        return Response(_signed_in(request, user), status=status.HTTP_201_CREATED)


class PasswordReset(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        form = RecoveryForm({'email': request.data.get('email', '')})
        if not form.is_valid():
            return Response(form_errors(form), status=status.HTTP_400_BAD_REQUEST)
        try:
            request_reset(form, request)
        except (RecoveryLimited, RecoveryUnavailable) as error:
            limited = isinstance(error, RecoveryLimited)
            return Response({'detail': str(error)}, status=429 if limited else 503,
                            headers={'Retry-After': '60'} if limited else None)
        return Response({'detail': RESET_MESSAGE}, status=status.HTTP_202_ACCEPTED)


class Logout(APIView):
    """
    Forget the token — and the phone, if the app says which. With
    `keep_token` the token stays: the app has put it behind the phone's
    own lock (Face ID, a fingerprint) to sign in with next time, and only
    the screen is signed out.
    """

    def post(self, request):
        expo_token = request.data.get("device")
        if expo_token:
            Device.objects.filter(user=request.user, expo_token=expo_token).delete()
        if not request.data.get("keep_token"):
            Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
