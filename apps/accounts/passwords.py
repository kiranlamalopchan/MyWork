"""Password changes and recovery links share Django's signed, one-use tokens.

Email recovery (recovery.py) delivers links to saved addresses over HTTPS.
Admins can still issue a link for an account with no email, after verifying
who is asking. Links expire after one hour and become invalid when the
password changes. Completing a reset also revokes native app tokens.
"""

from django.contrib.auth.tokens import default_token_generator
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


def reset_path(user):
    """
    The site-relative link that lets `user` set a new password.

    Relative because the caller knows which host it is answering on and this
    does not — see `reset_url`, which is what the staff page shows.
    """
    return reverse(
        "password_reset_confirm",
        kwargs={
            "uidb64": urlsafe_base64_encode(force_bytes(user.pk)),
            "token": default_token_generator.make_token(user),
        },
    )


def reset_url(request, user):
    """The same link, whole, ready to be copied and sent to somebody."""
    return request.build_absolute_uri(reset_path(user))


def revoke_app_tokens(user):
    """
    Sign `user`'s phones out of the app, and say whether there were any.

    One token per account rather than one per phone (it is a OneToOneField in
    DRF), so this is all of them at once — which is the point. The site's own
    session is a separate thing and is not touched here: `update_session_auth_hash`
    is what keeps the browser doing the changing signed in, and the reset page
    has no session to keep.
    """
    from rest_framework.authtoken.models import Token

    removed, _ = Token.objects.filter(user=user).delete()
    return bool(removed)
