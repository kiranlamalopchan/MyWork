"""Google/Apple authorization codes are exchanged and verified only here."""
import base64
import hashlib
import re
import secrets
import time
import unicodedata
from functools import lru_cache

import jwt
import requests
from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import transaction
from django.urls import reverse

from .models import Profile, SocialIdentity

RETURN_URL = 'mywork://auth-complete'
PROVIDERS = {
    'google': {
        'authorize': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token': 'https://oauth2.googleapis.com/token',
        'keys': 'https://www.googleapis.com/oauth2/v3/certs',
        'issuers': ['https://accounts.google.com', 'accounts.google.com'],
    },
    'apple': {
        'authorize': 'https://appleid.apple.com/auth/authorize',
        'token': 'https://appleid.apple.com/auth/token',
        'keys': 'https://appleid.apple.com/auth/keys',
        'issuers': ['https://appleid.apple.com'],
    },
}
FAILURES = {
    'cancelled': 'Sign-in was cancelled. You can try again.',
    'email_exists': 'This email already has an account. Sign in to your existing account, then connect this provider in Settings.',
    'wrong_account': 'Choose the Google or Apple account connected to this profile.',
    'already_linked': 'That Google or Apple account is already connected to another profile.',
    'inactive': 'This account is unavailable. Contact support for help.',
    'failed': "We couldn't complete sign-in. Please try again.",
}


class SocialFailure(Exception):
    def __init__(self, reason='failed'):
        self.reason = reason
        super().__init__(FAILURES[reason])


def digest(value):
    return hashlib.sha256(value.encode('ascii')).hexdigest()


def challenge_for(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode()


def provider_config(provider):
    if provider not in PROVIDERS:
        return None
    prefix = f'SOCIAL_{provider.upper()}_'
    client_id = getattr(settings, prefix + 'CLIENT_ID', '')
    base = getattr(settings, 'SOCIAL_AUTH_BASE_URL', '')
    # Registered callbacks must be HTTPS and come from configuration, never Host headers.
    if not client_id or not base.startswith('https://'):
        return None
    if provider == 'google':
        secret = getattr(settings, prefix + 'CLIENT_SECRET', '')
        if not secret:
            return None
    elif not all(getattr(settings, prefix + field, '') for field in ['TEAM_ID', 'KEY_ID', 'PRIVATE_KEY']):
        return None
    return {**PROVIDERS[provider], 'client_id': client_id,
            'redirect_uri': base + reverse('api:social_callback', args=[provider])}


def client_secret(provider):
    if provider == 'google':
        return settings.SOCIAL_GOOGLE_CLIENT_SECRET
    now = int(time.time())
    return jwt.encode({
        'iss': settings.SOCIAL_APPLE_TEAM_ID, 'iat': now, 'exp': now + 300,
        'aud': 'https://appleid.apple.com', 'sub': settings.SOCIAL_APPLE_CLIENT_ID,
    }, settings.SOCIAL_APPLE_PRIVATE_KEY, algorithm='ES256',
        headers={'kid': settings.SOCIAL_APPLE_KEY_ID})


@lru_cache(maxsize=2)
def key_client(provider):
    return jwt.PyJWKClient(PROVIDERS[provider]['keys'], timeout=10)


def verify_identity(provider, token, nonce):
    config = provider_config(provider)
    if not config or not isinstance(token, str) or len(token) > 16000:
        raise SocialFailure()
    try:
        key = key_client(provider).get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=['RS256'], audience=config['client_id'],
                            issuer=config['issuers'], leeway=30,
                            options={'require': ['exp', 'iat', 'sub', 'iss', 'aud', 'nonce']})
    except jwt.PyJWTError as exc:
        raise SocialFailure() from exc
    if not isinstance(claims['nonce'], str) or not secrets.compare_digest(claims['nonce'], nonce):
        raise SocialFailure()
    if not isinstance(claims['sub'], str) or not 1 <= len(claims['sub']) <= 255:
        raise SocialFailure()
    if claims.get('azp') and claims['azp'] != config['client_id']:
        raise SocialFailure()
    if isinstance(claims['aud'], list) and len(claims['aud']) > 1 and not claims.get('azp'):
        raise SocialFailure()
    return claims


def exchange_provider_code(attempt, code):
    config = provider_config(attempt.provider)
    if not config:
        raise SocialFailure()
    data = {'grant_type': 'authorization_code', 'code': code,
            'client_id': config['client_id'], 'client_secret': client_secret(attempt.provider),
            'redirect_uri': config['redirect_uri']}
    if attempt.provider == 'google':
        data['code_verifier'] = attempt.provider_verifier
    response = requests.post(config['token'], data=data, timeout=10)
    response.raise_for_status()
    tokens = response.json()
    claims = verify_identity(attempt.provider, tokens.get('id_token'), attempt.nonce)
    return claims, tokens.get('refresh_token', '')


def cipher():
    # Rotating SECRET_KEY requires reconnecting Apple before consent can be revoked.
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()))


def username_for(name, email):
    """
    A plain username for a new Google/Apple account, from the person's name
    ("Kiran Lama" → kiranlama), else the start of their email address, with
    an underscore and number added only when it is
    taken (kiranlama_2). Never the provider's
    ID: a username is shown to friends and typed into search.
    """
    User = get_user_model()

    def plain(text):
        text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
        return re.sub(r'[^a-z0-9._]', '', text).strip('._')[:24]

    base = plain(name) or plain((email or '').split('@')[0]) or 'user'
    if len(base) < 3:
        base = f'{base}user'
    taken = set(User.objects.filter(username__iregex=rf'^{re.escape(base)}(_[0-9]+)?$')
                .values_list('username', flat=True))
    taken = {t.lower() for t in taken}
    if base not in taken:
        return base
    n = 2
    while f'{base}_{n}' in taken:
        n += 1
    return f'{base}_{n}'


@transaction.atomic
def resolve_identity(attempt, claims, refresh_token=''):
    User = get_user_model()
    identity = SocialIdentity.objects.select_related('user').filter(
        provider=attempt.provider, subject=claims['sub']).first()
    if attempt.purpose == 'reauth':
        if not identity or identity.user_id != attempt.user_id:
            raise SocialFailure('wrong_account')
    elif attempt.purpose == 'link':
        if identity and identity.user_id != attempt.user_id:
            raise SocialFailure('already_linked')
        other = SocialIdentity.objects.filter(user_id=attempt.user_id, provider=attempt.provider).first()
        if other and (not identity or other.pk != identity.pk):
            raise SocialFailure('already_linked')
        if not identity:
            identity = SocialIdentity.objects.create(user_id=attempt.user_id, provider=attempt.provider, subject=claims['sub'])
    elif not identity:
        # Email addresses are not account identifiers. Never merge a password
        # account merely because a provider asserts the same address.
        email = claims.get('email', '')
        verified = claims.get('email_verified') in (True, 'true')
        if not verified or not isinstance(email, str) or len(email) > 254 or '@' not in email:
            raise SocialFailure()
        if User.objects.filter(email__iexact=email).exists():
            raise SocialFailure('email_exists')
        name = claims.get('name', '')
        user = User.objects.create_user(
            username=username_for(name if isinstance(name, str) else '', email), email=email, password=None)
        if isinstance(name, str) and name.strip():
            Profile.objects.filter(user=user).update(display_name=name.strip()[:40])
        identity = SocialIdentity.objects.create(user=user, provider=attempt.provider, subject=claims['sub'])
    if not identity.user.is_active:
        raise SocialFailure('inactive')
    if refresh_token and attempt.provider == 'apple':
        identity.encrypted_refresh_token = cipher().encrypt(refresh_token.encode()).decode()
        identity.save(update_fields=['encrypted_refresh_token'])
    return identity.user


def reauth_receipt(user):
    return signing.dumps({'user': user.pk}, salt='social-account-reauth')


def valid_reauth(user, receipt):
    if not isinstance(receipt, str) or len(receipt) > 1000:
        return False
    try:
        return signing.loads(receipt, salt='social-account-reauth', max_age=300).get('user') == user.pk
    except signing.BadSignature:
        return False


def revoke_apple(user):
    for identity in user.social_identities.filter(provider='apple').exclude(encrypted_refresh_token=''):
        response = requests.post('https://appleid.apple.com/auth/revoke', data={
            'client_id': settings.SOCIAL_APPLE_CLIENT_ID, 'client_secret': client_secret('apple'),
            'token': cipher().decrypt(identity.encrypted_refresh_token.encode()).decode(),
            'token_type_hint': 'refresh_token',
        }, timeout=10)
        response.raise_for_status()
