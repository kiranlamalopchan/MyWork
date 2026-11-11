"""Real signature checks plus the browser-to-app proof and account boundaries."""
import secrets
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.authtoken.models import Token

from apps.accounts.models import SocialIdentity, SocialLoginAttempt
from apps.accounts.social import SocialFailure, challenge_for, cipher, verify_identity, reauth_receipt

CONFIG = {
    'SOCIAL_AUTH_BASE_URL': 'https://work.example',
    'SOCIAL_GOOGLE_CLIENT_ID': 'google-client', 'SOCIAL_GOOGLE_CLIENT_SECRET': 'google-secret',
    'SOCIAL_APPLE_CLIENT_ID': 'apple-service', 'SOCIAL_APPLE_TEAM_ID': 'team',
    'SOCIAL_APPLE_KEY_ID': 'key', 'SOCIAL_APPLE_PRIVATE_KEY': 'configured-in-tests',
}


@override_settings(**CONFIG)
class SocialAuthTests(TestCase):
    def setUp(self):
        cache.clear()
        self.verifier = secrets.token_urlsafe(32)
        self.user = User.objects.create_user('existing', email='existing@example.test', password='a-long-password')
        self.token = Token.objects.create(user=self.user)

    def start(self, provider='google', purpose='login', authenticated=False):
        headers = {'HTTP_AUTHORIZATION': 'Token ' + self.token.key} if authenticated else {}
        response = self.client.post(reverse('api:social_start', args=[provider]), {
            'challenge': challenge_for(self.verifier), 'purpose': purpose,
        }, **headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['return_url'], 'mywork://auth-complete')
        params = parse_qs(urlsplit(response.json()['url']).query)
        return params['state'][0], params

    def finish(self, state, *, provider='google', claims=None, error=None):
        claims = claims or {'sub': 'provider-person', 'email': 'new@example.test', 'email_verified': True, 'name': 'New Person'}
        with patch('apps.api.views.social_auth.exchange_provider_code', return_value=(claims, '')):
            response = self.client.get(reverse('api:social_callback', args=[provider]),
                                       {'state': state, **({'error': error} if error else {'code': 'provider-code'})})
        self.assertEqual(response.status_code, 302, response.content)
        location = response['Location']
        self.assertNotIn('token', location)
        self.assertEqual(response['Cache-Control'], 'no-store')
        return parse_qs(urlsplit(location).query)['code'][0]

    def exchange(self, code, verifier=None):
        return self.client.post(reverse('api:social_exchange'), {'code': code, 'verifier': verifier or self.verifier})

    def test_google_login_issues_session_and_is_single_use(self):
        state, params = self.start()
        self.assertEqual(params['redirect_uri'], ['https://work.example/api/v1/auth/social/google/callback/'])
        self.assertEqual(params['code_challenge_method'], ['S256'])
        self.assertNotIn('client_secret', params)
        code = self.finish(state)
        response = self.exchange(code)
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email='new@example.test')
        self.assertFalse(user.has_usable_password())
        self.assertEqual(response.json()['me']['name'], 'New Person')
        self.assertEqual(user.username, 'newperson')
        self.assertEqual(response.json()['me']['social_providers'], ['google'])
        self.assertFalse(response.json()['me']['has_password'])
        self.assertEqual(Token.objects.get(user=user).key, response.json()['token'])
        self.assertEqual(self.exchange(code).status_code, 400)
        repeated = self.client.get(reverse('api:social_callback', args=['google']), {'state': state, 'code': 'same'})
        self.assertEqual(repeated.status_code, 400)

    def test_intercepted_handoff_without_the_app_proof_cannot_sign_in(self):
        state, _ = self.start()
        code = self.finish(state)
        self.assertEqual(self.exchange(code, secrets.token_urlsafe(32)).status_code, 400)
        self.assertEqual(self.exchange(code).status_code, 200)

    def test_expired_and_unknown_callbacks_do_not_redirect(self):
        state, _ = self.start()
        SocialLoginAttempt.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        for candidate in (state, secrets.token_urlsafe(32), '<invalid>'):
            response = self.client.get(reverse('api:social_callback', args=['google']), {'state': candidate, 'code': 'code'})
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('Location', response)

    def test_expired_handoff_is_rejected(self):
        state, _ = self.start()
        code = self.finish(state)
        SocialLoginAttempt.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.exchange(code).status_code, 400)

    def test_state_cannot_be_used_for_a_different_provider(self):
        state, _ = self.start()
        self.assertEqual(self.client.get(reverse('api:social_callback', args=['apple']), {'state': state}).status_code, 400)

    def test_declining_consent_returns_a_friendly_error_without_an_account(self):
        state, _ = self.start()
        response = self.exchange(self.finish(state, error='access_denied'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('cancelled', response.json()['detail'])
        self.assertEqual(User.objects.count(), 1)

    def test_provider_failure_does_not_expose_provider_response_or_secrets(self):
        state, _ = self.start()
        with patch('apps.api.views.social_auth.exchange_provider_code', side_effect=RuntimeError('secret-provider-token')):
            with patch('apps.api.views.social_auth.report_exception') as report:
                response = self.client.get(reverse('api:social_callback', args=['google']), {'state': state, 'code': 'secret-code'})
        report.assert_called_once()
        code = parse_qs(urlsplit(response['Location']).query)['code'][0]
        response = self.exchange(code)
        self.assertEqual(response.json()['detail'], "We couldn't complete sign-in. Please try again.")

    def test_existing_email_is_not_silently_linked(self):
        state, _ = self.start()
        code = self.finish(state, claims={'sub': 'unlinked', 'email': self.user.email, 'email_verified': True})
        self.assertEqual(self.exchange(code).status_code, 400)
        self.assertFalse(SocialIdentity.objects.exists())
        self.assertEqual(User.objects.count(), 1)

    def test_unverified_email_cannot_create_an_account(self):
        state, _ = self.start()
        code = self.finish(state, claims={'sub': 'unverified', 'email': 'new@example.test', 'email_verified': False})
        self.assertEqual(self.exchange(code).status_code, 400)
        self.assertEqual(User.objects.count(), 1)

    def test_linking_requires_a_session_and_preserves_the_existing_account(self):
        response = self.client.post(reverse('api:social_start', args=['google']), {'challenge': challenge_for(self.verifier), 'purpose': 'link'})
        self.assertEqual(response.status_code, 401)
        state, _ = self.start(purpose='link', authenticated=True)
        response = self.exchange(self.finish(state))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['me']['username'], 'existing')
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialIdentity.objects.get().user, self.user)

    def test_one_provider_account_cannot_be_linked_to_two_profiles(self):
        other = User.objects.create_user('other')
        SocialIdentity.objects.create(user=other, provider='google', subject='provider-person')
        state, _ = self.start(purpose='link', authenticated=True)
        self.assertEqual(self.exchange(self.finish(state)).status_code, 400)
        self.assertEqual(SocialIdentity.objects.get().user, other)

    def test_existing_subject_signs_in_without_requiring_email_again(self):
        SocialIdentity.objects.create(user=self.user, provider='apple', subject='provider-person')
        state, _ = self.start(provider='apple')
        response = self.exchange(self.finish(state, provider='apple', claims={'sub': 'provider-person'}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['me']['username'], 'existing')

    def test_inactive_accounts_cannot_sign_in(self):
        self.user.is_active = False
        self.user.save()
        SocialIdentity.objects.create(user=self.user, provider='google', subject='provider-person')
        state, _ = self.start()
        self.assertEqual(self.exchange(self.finish(state)).status_code, 400)

    def test_a_new_username_comes_from_the_name_else_the_email_and_is_numbered_if_taken(self):
        from apps.accounts.social import username_for
        User.objects.create_user('kiranlama')
        User.objects.create_user('KiranLama_2')
        self.assertEqual(username_for('Kiran Lama', 'k@example.test'), 'kiranlama_3')
        self.assertEqual(username_for('José Núñez', 'j@example.test'), 'josenunez')
        # No usable name (Apple sends none after the first time, or a name in another script).
        self.assertEqual(username_for('', 'sita.rai@example.test'), 'sita.rai')
        self.assertEqual(username_for('किरण', 'x7k2q9@privaterelay.appleid.com'), 'x7k2q9')
        self.assertEqual(username_for('', ''), 'user')
        self.assertEqual(username_for('Al', ''), 'aluser')
        self.assertNotRegex(username_for('Somebody With A Very Long Name Indeed', ''), r'^.{25,}$')

    def test_random_usernames_from_before_are_renamed_once(self):
        from importlib import import_module
        from django.apps import apps as live_apps
        from apps.accounts.models import Profile
        rename = import_module('apps.accounts.migrations.0008_plain_social_usernames').rename
        old = User.objects.create_user('user_' + 'a1' * 10, email='sita.rai@example.test')
        named = User.objects.create_user('user_' + 'b2' * 10, email='x@example.test')
        Profile.objects.filter(user=named).update(display_name='Kiran Lama')
        User.objects.create_user('kiranlama')
        chosen = User.objects.create_user('user_custom', email='c@example.test')
        rename(live_apps, None)
        self.assertEqual(User.objects.get(pk=old.pk).username, 'sita.rai')
        self.assertEqual(User.objects.get(pk=named.pk).username, 'kiranlama_2')
        self.assertEqual(User.objects.get(pk=chosen.pk).username, 'user_custom')

    def test_apple_form_post_accepts_state_without_session_cookies(self):
        state, params = self.start(provider='apple')
        self.assertEqual(params['response_mode'], ['form_post'])
        with patch('apps.api.views.social_auth.exchange_provider_code', return_value=(
                {'sub': 'apple-person', 'email': 'relay@privaterelay.appleid.com', 'email_verified': 'true'}, 'private-refresh')):
            response = Client(enforce_csrf_checks=True).post(reverse('api:social_callback', args=['apple']),
                                                            {'state': state, 'code': 'apple-code', 'user': '{"name":{"firstName":"Apple","lastName":"Person"}}'})
        self.assertEqual(response.status_code, 302)
        identity = SocialIdentity.objects.get(provider='apple')
        self.assertNotIn('private-refresh', identity.encrypted_refresh_token)
        self.assertEqual(cipher().decrypt(identity.encrypted_refresh_token.encode()).decode(), 'private-refresh')
        self.assertEqual(identity.user.profile.display_name, 'Apple Person')

    def test_reauthentication_is_bound_to_the_current_user_and_can_delete_without_password(self):
        SocialIdentity.objects.create(user=self.user, provider='google', subject='provider-person')
        self.user.set_unusable_password()
        self.user.save()
        state, _ = self.start(purpose='reauth', authenticated=True)
        response = self.exchange(self.finish(state))
        self.assertEqual(set(response.json()), {'reauth_token'})
        deleted = self.client.delete(reverse('api:me'), {'social_reauth': response.json()['reauth_token']},
                                     content_type='application/json', HTTP_AUTHORIZATION='Token ' + self.token.key)
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())

    def test_wrong_provider_account_cannot_reauthenticate(self):
        state, _ = self.start(purpose='reauth', authenticated=True)
        response = self.exchange(self.finish(state))
        self.assertEqual(response.status_code, 400)
        self.assertIn('connected to this profile', response.json()['detail'])

    def test_forged_or_other_users_receipt_cannot_delete_an_account(self):
        other = User.objects.create_user('another')
        for receipt in ('forged', reauth_receipt(other)):
            response = self.client.delete(reverse('api:me'), {'social_reauth': receipt},
                                          content_type='application/json', HTTP_AUTHORIZATION='Token ' + self.token.key)
            self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_deletion_revokes_apple_consent_before_removing_the_account(self):
        SocialIdentity.objects.create(user=self.user, provider='apple', subject='apple-person',
                                      encrypted_refresh_token=cipher().encrypt(b'refresh-secret').decode())
        with patch('apps.accounts.social.client_secret', return_value='signed-client-secret'):
            with patch('apps.accounts.social.requests.post') as post:
                post.return_value.raise_for_status.return_value = None
                response = self.client.delete(reverse('api:me'), {'password': 'a-long-password'},
                                              content_type='application/json', HTTP_AUTHORIZATION='Token ' + self.token.key)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(post.call_args.args[0], 'https://appleid.apple.com/auth/revoke')
        self.assertEqual(post.call_args.kwargs['data']['token'], 'refresh-secret')
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())

    @override_settings(SOCIAL_GOOGLE_CLIENT_SECRET='')
    def test_unconfigured_provider_is_explained_without_a_browser_redirect(self):
        response = self.client.post(reverse('api:social_start', args=['google']), {'challenge': challenge_for(self.verifier)})
        self.assertEqual(response.status_code, 400)
        self.assertIn("isn't available yet", response.json()['detail'])
        self.assertFalse(SocialLoginAttempt.objects.exists())


@override_settings(**CONFIG)
class ProviderVerificationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def claims(self, **changes):
        return {**{'iss': 'https://accounts.google.com', 'aud': 'google-client', 'sub': 'stable-person',
                   'nonce': 'expected-nonce', 'iat': int(time.time()), 'exp': int(time.time()) + 300}, **changes}

    def verify(self, claims, provider='google', key=None, algorithm='RS256'):
        token = jwt.encode(claims, key or self.private_key, algorithm=algorithm, headers={'kid': 'test'})
        client = Mock()
        client.get_signing_key_from_jwt.return_value = SimpleNamespace(key=self.private_key.public_key())
        with patch('apps.accounts.social.key_client', return_value=client):
            return verify_identity(provider, token, 'expected-nonce')

    def test_valid_google_and_apple_signatures(self):
        self.assertEqual(self.verify(self.claims())['sub'], 'stable-person')
        self.assertEqual(self.verify(self.claims(iss='https://appleid.apple.com', aud='apple-service'), provider='apple')['sub'], 'stable-person')

    def test_signature_issuer_audience_expiry_nonce_and_subject_are_all_checked(self):
        for changes in ({'iss': 'https://attacker.example'}, {'aud': 'another-app'}, {'exp': int(time.time()) - 120},
                        {'nonce': 'wrong'}, {'sub': ''}, {'azp': 'another-client'}, {'aud': ['google-client', 'other-client']}):
            with self.subTest(changes=changes), self.assertRaises(SocialFailure):
                self.verify(self.claims(**changes))
        with self.assertRaises(SocialFailure):
            self.verify(self.claims(), key=rsa.generate_private_key(public_exponent=65537, key_size=2048))
        with self.assertRaises(SocialFailure):
            self.verify(self.claims(), key='not-a-real-provider-secret-long-enough', algorithm='HS256')

    def test_missing_nonce_is_rejected(self):
        claims = self.claims()
        del claims['nonce']
        with self.assertRaises(SocialFailure):
            self.verify(claims)
