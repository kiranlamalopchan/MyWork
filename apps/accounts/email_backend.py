"""Django email over HTTPS, including PythonAnywhere's free-tier proxy."""
import json
from email.utils import parseaddr
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class EmailDeliveryError(Exception):
    """A deliberately redacted provider error: no addresses, tokens or keys."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BrevoEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages or []:
            if not message.recipients():
                continue
            try:
                self._send(message)
            except EmailDeliveryError:
                if not self.fail_silently:
                    raise
            else:
                sent += 1
        return sent

    def _send(self, message):
        key = settings.BREVO_API_KEY
        if not key or not message.from_email:
            raise EmailDeliveryError('Email delivery is not configured.')
        def address(value):
            name, email = parseaddr(value)
            return {'email': email, **({'name': name} if name else {})}

        payload = {
            'sender': address(message.from_email),
            'to': [address(value) for value in message.to],
            'subject': message.subject, 'textContent': message.body,
        }
        for field in ('cc', 'bcc'):
            if getattr(message, field):
                payload[field] = [address(value) for value in getattr(message, field)]
        if message.reply_to:
            payload['replyTo'] = address(message.reply_to[0])
        for body, mimetype in getattr(message, 'alternatives', []):
            if mimetype == 'text/html':
                payload['htmlContent'] = body
        request = Request('https://api.brevo.com/v3/smtp/email',
                          data=json.dumps(payload).encode(), method='POST', headers={
                              'api-key': key,
                              'Content-Type': 'application/json',
                              'User-Agent': 'KaamKoRecord/1.0',
                          })
        # build_opener retains urllib's environment-aware proxy handler.
        # Redirects are refused so credentials cannot follow another host.
        try:
            with build_opener(NoRedirect()).open(request, timeout=settings.EMAIL_TIMEOUT) as response:
                if not 200 <= response.status < 300:
                    raise EmailDeliveryError('Email provider rejected the request.')
        except HTTPError as error:
            raise EmailDeliveryError(f'Email provider rejected the request ({error.code}).') from None
        except (URLError, OSError):
            raise EmailDeliveryError('Could not connect to the email provider.') from None
