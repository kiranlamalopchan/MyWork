"""Email recovery works without exposing accounts or granting a login session."""
from datetime import datetime, timedelta
from io import StringIO
import json
import re
from unittest import mock
from urllib.error import HTTPError, URLError

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command, CommandError
from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives
from django.test import Client, TestCase, SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.authtoken.models import Token

from .email_backend import BrevoEmailBackend, EmailDeliveryError


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                   DEFAULT_FROM_EMAIL='KaamKoRecord <support@example.com>',
                   PASSWORD_RESET_BASE_URL='https://accounts.example.com', PASSWORD_RESET_TIMEOUT=3600,
                   ALLOWED_HOSTS=['testserver', 'poison.example'])
class RecoveryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.person = get_user_model().objects.create_user('kiran', email='kiran@example.com', password='old-password-77')
        self.api = reverse('api:password_reset')
        self.web = reverse('password_reset')

    def tearDown(self):
        cache.clear()

    def request_link(self, email='kiran@example.com', **extra):
        return self.client.post(self.api, {'email': email}, **extra)

    def link(self):
        return re.search(r'https://accounts\.example\.com(/reset/\S+/)', mail.outbox[-1].body).group(1)

    def test_sign_in_offers_recovery_and_the_form_has_email_autofill(self):
        self.assertContains(self.client.get(reverse('login')), self.web)
        self.assertContains(self.client.get(self.web), 'autocomplete="email"')

    def test_api_sends_a_branded_single_use_link_without_returning_it(self):
        response = self.request_link(HTTP_AUTHORIZATION='Token expired-token')
        self.assertEqual(response.status_code, 202)
        self.assertNotIn('/reset/', response.content.decode())
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['kiran@example.com'])
        self.assertEqual(message.subject, 'Reset your KaamKoRecord password')
        self.assertIn('one hour', message.body)
        self.assertIn('kiran', message.body)
        self.assertIn('/reset/', message.alternatives[0].content)

    def test_existing_and_missing_addresses_get_the_same_answer(self):
        known = self.request_link().json()
        unknown = self.request_link('unknown@example.com').json()
        self.assertEqual(known, unknown)
        self.assertEqual(len(mail.outbox), 1)

    def test_inactive_and_unusable_accounts_receive_no_link(self):
        self.person.is_active = False
        self.person.save()
        self.assertEqual(self.request_link().status_code, 202)
        cache.clear()
        self.person.is_active = True
        self.person.set_unusable_password()
        self.person.save()
        self.assertEqual(self.request_link().status_code, 202)
        self.assertEqual(len(mail.outbox), 0)

    def test_invalid_email_is_explained_without_sending(self):
        response = self.request_link('not-an-email')
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json()['fields'])
        self.assertEqual(len(mail.outbox), 0)

    def test_web_and_api_share_a_case_insensitive_resend_cooldown(self):
        self.assertEqual(self.request_link().status_code, 202)
        response = self.client.post(self.web, {'email': ' KIRAN@example.com '})
        self.assertEqual(response.status_code, 429)
        self.assertContains(response, 'wait a minute', status_code=429)
        self.assertEqual(len(mail.outbox), 1)

    def test_many_addresses_from_one_ip_are_limited(self):
        for i in range(20):
            self.assertEqual(self.request_link(f'nobody{i}@example.com').status_code, 202)
        self.assertEqual(self.request_link('another@example.com').status_code, 429)

    def test_host_header_cannot_change_the_emailed_domain(self):
        self.request_link(HTTP_HOST='poison.example')
        self.assertIn('https://accounts.example.com/reset/', mail.outbox[0].body)
        self.assertNotIn('poison.example', mail.outbox[0].body)

    def test_web_request_reaches_the_same_email_flow(self):
        response = self.client.post(self.web, {'email': 'kiran@example.com'})
        self.assertRedirects(response, reverse('password_reset_done'))
        self.assertEqual(len(mail.outbox), 1)

    def test_emailed_link_resets_password_revokes_tokens_and_old_browser_sessions(self):
        old_browser = Client()
        old_browser.force_login(self.person)
        old_token = Token.objects.create(user=self.person).key
        self.request_link()
        link = self.link()
        page = self.client.get(link, follow=True)
        self.assertEqual(page['Referrer-Policy'], 'same-origin')
        target = page.redirect_chain[-1][0]
        response = self.client.post(target, {'new_password1': 'quokka-brunch-91', 'new_password2': 'quokka-brunch-91'})
        self.assertRedirects(response, reverse('password_reset_complete'))
        self.person.refresh_from_db()
        self.assertTrue(self.person.check_password('quokka-brunch-91'))
        self.assertFalse(Token.objects.filter(user=self.person).exists())
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertEqual(old_browser.get(reverse('accounts:profile')).status_code, 302)
        self.assertContains(self.client.get(link, follow=True), 'expired')
        old_api = Client(HTTP_AUTHORIZATION=f'Token {old_token}')
        self.assertEqual(old_api.get(reverse('api:me')).status_code, 401)

    def test_link_expires_and_offers_a_fresh_request(self):
        self.request_link()
        link = self.link()
        with mock.patch('django.contrib.auth.tokens.PasswordResetTokenGenerator._now', return_value=datetime.now() + timedelta(hours=2)):
            response = self.client.get(link, follow=True)
        self.assertContains(response, 'Get a new reset link')
        self.assertContains(response, 'expired')

    def test_weak_passwords_are_rejected_without_changing_the_account(self):
        self.request_link()
        page = self.client.get(self.link(), follow=True)
        response = self.client.post(page.redirect_chain[-1][0], {'new_password1': '123', 'new_password2': '123'})
        self.assertEqual(response.status_code, 200)
        self.person.refresh_from_db()
        self.assertTrue(self.person.check_password('old-password-77'))

    @override_settings(PASSWORD_RESET_BASE_URL='')
    def test_missing_configuration_is_honest_and_does_not_send(self):
        known = self.request_link()
        unknown = self.request_link('unknown@example.com')
        self.assertEqual(known.status_code, 503)
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(len(mail.outbox), 0)
        self.assertContains(self.client.get(self.web), 'being set up')

    @override_settings(DEBUG=False, PASSWORD_RESET_BASE_URL='http://accounts.example.com')
    def test_production_reset_origin_must_use_https(self):
        self.assertEqual(self.request_link().status_code, 503)
        self.assertEqual(len(mail.outbox), 0)

    def test_delivery_failure_does_not_leak_provider_secrets_or_account_existence(self):
        with mock.patch.object(EmailMultiAlternatives, 'send', side_effect=RuntimeError('private-reset-token')), self.assertLogs('apps.accounts.recovery', level='ERROR') as logs:
            response = self.request_link()
        self.assertEqual(response.status_code, 202)
        self.assertNotIn('private-reset-token', str(logs.output))
        self.assertNotIn('kiran@example.com', str(logs.output))
        self.assertNotIn('private-reset-token', response.content.decode())

    def test_registration_can_save_a_recovery_email_but_keeps_old_accounts_compatible(self):
        response = self.client.post(reverse('api:register'), {'username': 'new-person', 'password': 'quokka-brunch-91', 'email': 'new@example.com'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(get_user_model().objects.get(username='new-person').email, 'new@example.com')
        response = self.client.post(reverse('api:register'), {'username': 'no-email', 'password': 'quokka-brunch-91'})
        self.assertEqual(response.status_code, 201)


@override_settings(BREVO_API_KEY='private-api-key', EMAIL_TIMEOUT=10)
class BrevoBackendTests(SimpleTestCase):
    def message(self):
        message = EmailMultiAlternatives('Reset password', 'One-use link', 'KaamKoRecord <support@example.com>', ['Person <person@example.com>'])
        message.attach_alternative('<p>One-use link</p>', 'text/html')
        return message

    def test_backend_sends_text_and_html_over_https_and_honours_proxy_defaults(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch('apps.accounts.email_backend.build_opener') as opener:
            opener.return_value.open.return_value = response
            self.assertEqual(BrevoEmailBackend().send_messages([self.message()]), 1)
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.brevo.com/v3/smtp/email')
        self.assertEqual(request.get_header('Api-key'), 'private-api-key')
        data = json.loads(request.data)
        self.assertEqual(data['to'], [{'name': 'Person', 'email': 'person@example.com'}])
        self.assertEqual(data['sender'], {'name': 'KaamKoRecord', 'email': 'support@example.com'})
        self.assertIn('textContent', data)
        self.assertIn('htmlContent', data)
        self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 10)

    def test_http_errors_are_redacted_and_silent_mode_reports_no_delivery(self):
        error = HTTPError('https://api.brevo.com/v3/smtp/email', 403, 'private-api-key', {}, None)
        with mock.patch('apps.accounts.email_backend.build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(EmailDeliveryError) as raised:
                BrevoEmailBackend().send_messages([self.message()])
            self.assertNotIn('private-api-key', str(raised.exception))
            self.assertEqual(BrevoEmailBackend(fail_silently=True).send_messages([self.message()]), 0)

    def test_network_errors_are_redacted(self):
        with mock.patch('apps.accounts.email_backend.build_opener') as opener:
            opener.return_value.open.side_effect = URLError('private-api-key')
            with self.assertRaisesMessage(EmailDeliveryError, 'Could not connect'):
                BrevoEmailBackend().send_messages([self.message()])


@override_settings(EMAIL_BACKEND='apps.accounts.email_backend.BrevoEmailBackend',
                   BREVO_API_KEY='private-api-key', DEFAULT_FROM_EMAIL='KaamKoRecord <sender@gmail.com>',
                   PASSWORD_RESET_BASE_URL='https://example.pythonanywhere.com')
class RecoveryConfigurationTests(SimpleTestCase):
    def test_check_accepts_a_gmail_sender_without_sending_or_exposing_the_key(self):
        output = StringIO()
        with mock.patch.object(BrevoEmailBackend, 'send_messages') as send:
            call_command('check_password_recovery', stdout=output)
        send.assert_not_called()
        self.assertIn('settings are ready', output.getvalue())
        self.assertNotIn('private-api-key', output.getvalue())

    @override_settings(BREVO_API_KEY='')
    def test_missing_key_explains_the_setup(self):
        with self.assertRaisesMessage(CommandError, 'Set BREVO_API_KEY'):
            call_command('check_password_recovery')

    def test_malformed_origins_and_senders_are_refused(self):
        from .recovery import require_email_setup, RecoveryUnavailable
        for origin in ('https://example.com/reset/', 'https://user:secret@example.com',
                       'https://example.com?bad=1', 'https://example.com:bad'):
            with self.subTest(origin=origin), override_settings(PASSWORD_RESET_BASE_URL=origin):
                with self.assertRaises(RecoveryUnavailable):
                    require_email_setup()
        for sender in ('not-an-email', 'sender@gmail.com\nBcc:someone@example.com'):
            with self.subTest(sender=sender), override_settings(DEFAULT_FROM_EMAIL=sender):
                with self.assertRaises(RecoveryUnavailable):
                    require_email_setup()
