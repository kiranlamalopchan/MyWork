"""
Changing a password, and the one way back in when it has been forgotten.

MyWork cannot send email. The host's free tier carries no outbound mail, and
five of the six accounts have no address on them at all — signing up never
asks for one. So "email me a link", the flow every other site uses, is not
one this site can offer: it would lock most people out of their own accounts
while looking like it worked.

What stands in for it is a link an admin makes by hand and passes on, in
person or over whatever they already use to talk to each other. The link
itself is Django's own and nothing here invents a token: it is signed, it
carries the account's current password hash and last-login time, and it dies
the moment either changes. That is what makes it single-use — setting a new
password with it is itself what stops it working a second time — and what
makes handing one over no worse than handing over a password, since it
expires on its own (PASSWORD_RESET_TIMEOUT, three days by default).

Both ways in end the same way: the phones signed into the app are signed out.
A password that has just changed is a password the sessions behind it should
not outlive.
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
