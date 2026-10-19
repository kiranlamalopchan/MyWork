"""Shared web/native email reset: Django tokens, bounded requests, fixed origin."""
import logging
from email.utils import parseaddr
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.forms import PasswordResetForm
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils.crypto import salted_hmac

logger = logging.getLogger(__name__)
RESET_MESSAGE = 'If an account uses that email, a password reset link will arrive shortly.'


class RecoveryUnavailable(Exception):
    pass


class RecoveryLimited(Exception):
    pass


def recovery_origin():
    try:
        origin = urlsplit(getattr(settings, 'PASSWORD_RESET_BASE_URL', ''))
        if (not origin.hostname or origin.username or origin.password or origin.query
                or origin.fragment or origin.path not in ('', '/')
                or origin.scheme not in (('https', 'http') if settings.DEBUG else ('https',))):
            raise ValueError
        origin.port  # Validate malformed ports, too.
        return origin
    except ValueError:
        raise RecoveryUnavailable('Email reset is not available yet. Please ask an admin for a reset link.') from None


def require_email_setup():
    origin = recovery_origin()
    backend = settings.EMAIL_BACKEND
    try:
        validate_email(parseaddr(settings.DEFAULT_FROM_EMAIL)[1])
        if '\n' in settings.DEFAULT_FROM_EMAIL or '\r' in settings.DEFAULT_FROM_EMAIL:
            raise ValidationError('Invalid sender')
    except ValidationError:
        raise RecoveryUnavailable('Email reset is not available yet. Please ask an admin for a reset link.') from None
    if (not settings.DEFAULT_FROM_EMAIL
            or (backend == 'apps.accounts.email_backend.BrevoEmailBackend' and not settings.BREVO_API_KEY)
            or backend in ('django.core.mail.backends.dummy.EmailBackend',
                           'django.core.mail.backends.console.EmailBackend')):
        raise RecoveryUnavailable('Email reset is not available yet. Please ask an admin for a reset link.')
    return origin


def request_reset(form, request):
    origin = require_email_setup()
    email = form.cleaned_data['email'].strip().casefold()
    ip = request.META.get('REMOTE_ADDR', '')
    # Hash identifiers rather than putting email addresses in cache keys.
    address_key = 'recovery:email:' + salted_hmac('recovery-email', email).hexdigest()
    ip_key = 'recovery:ip:' + salted_hmac('recovery-ip', ip).hexdigest()
    cache.add(ip_key, 0, 900)
    try:
        requests = cache.incr(ip_key)
    except ValueError:
        cache.set(ip_key, 1, 900)
        requests = 1
    if requests > 20:
        raise RecoveryLimited('Too many requests. Please try again in 15 minutes.')
    if not cache.add(address_key, True, 60):
        raise RecoveryLimited('Please wait a minute before requesting another link.')
    form.save(
        request=request, domain_override=origin.netloc, use_https=origin.scheme == 'https',
        from_email=settings.DEFAULT_FROM_EMAIL,
        subject_template_name='registration/password_reset_subject.txt',
        email_template_name='registration/password_reset_email.txt',
        html_email_template_name='registration/password_reset_email.html',
        extra_email_context={'site_name': 'KaamKoRecord'},
    )


class RecoveryForm(PasswordResetForm):
    def send_mail(self, subject_template_name, email_template_name, context, from_email,
                  to_email, html_email_template_name=None):
        # Django keeps unknown/inactive accounts indistinguishable. Its mail
        # helper also catches delivery failures; avoid logging provider secrets
        # or reset URLs when reporting those failures.
        from django.core.mail import EmailMultiAlternatives
        from django.template.loader import render_to_string
        subject = ''.join(render_to_string(subject_template_name, context).splitlines())
        body = render_to_string(email_template_name, context)
        message = EmailMultiAlternatives(subject, body, from_email, [to_email])
        if html_email_template_name:
            message.attach_alternative(render_to_string(html_email_template_name, context), 'text/html')
        try:
            if not message.send():
                logger.error('Password recovery email was not accepted for delivery.')
        except Exception:
            logger.error('Password recovery email could not be delivered. Check email provider configuration.')
