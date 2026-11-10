"""Browser OAuth with a one-time, proof-bound handoff to the mobile app."""
import json
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import SocialLoginAttempt
from apps.accounts.social import (
    FAILURES, RETURN_URL, SocialFailure, challenge_for, digest,
    exchange_provider_code, provider_config, reauth_receipt, resolve_identity,
)
from ..observability import report_exception
from .auth import _signed_in


class SocialThrottle(SimpleRateThrottle):
    scope = 'social_auth'
    rate = '20/min'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class SocialStart(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SocialThrottle]

    def post(self, request, provider):
        if provider not in ('google', 'apple'):
            return Response({'detail': 'Choose Google or Apple to continue.'}, status=400)
        config = provider_config(provider)
        if not config:
            return Response({'detail': "This sign-in option isn't available yet. Use your username and password for now."}, status=400)
        challenge = request.data.get('challenge', '')
        purpose = request.data.get('purpose', 'login')
        if not isinstance(challenge, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge):
            return Response({'detail': 'Please restart sign-in and try again.'}, status=400)
        if purpose not in ('login', 'link', 'reauth'):
            return Response({'detail': 'Please restart sign-in and try again.'}, status=400)
        if purpose != 'login' and not request.user.is_authenticated:
            return Response({'detail': 'Please sign in again to continue.'}, status=401)
        now = timezone.now()
        SocialLoginAttempt.objects.filter(expires_at__lt=now).delete()
        state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        SocialLoginAttempt.objects.create(
            state_hash=digest(state), provider=provider, purpose=purpose,
            user=request.user if purpose != 'login' else None, challenge=challenge,
            nonce=nonce, provider_verifier=verifier, expires_at=now + timedelta(minutes=10))
        params = {'client_id': config['client_id'], 'redirect_uri': config['redirect_uri'],
                  'response_type': 'code', 'state': state, 'nonce': nonce,
                  'scope': 'openid email profile' if provider == 'google' else 'name email'}
        if provider == 'google':
            params.update(code_challenge=challenge_for(verifier), code_challenge_method='S256', prompt='select_account')
        else:
            params['response_mode'] = 'form_post'
        return Response({'url': config['authorize'] + '?' + urlencode(params), 'return_url': RETURN_URL})


@csrf_exempt  # Apple posts cross-site; unpredictable, one-use state replaces cookie CSRF.
@sensitive_post_parameters('code', 'id_token', 'user')
@require_http_methods(['GET', 'POST'])
def callback(request, provider):
    data = request.POST if request.method == 'POST' else request.GET
    state = data.get('state', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', state):
        return HttpResponse('Please return to the app and try signing in again.', status=400)
    attempt = SocialLoginAttempt.objects.filter(state_hash=digest(state), provider=provider,
                                               expires_at__gt=timezone.now(), claimed=False).first()
    if not attempt or not SocialLoginAttempt.objects.filter(pk=attempt.pk, claimed=False).update(claimed=True):
        return HttpResponse('Please return to the app and try signing in again.', status=400)
    attempt.claimed = True
    try:
        if data.get('error'):
            raise SocialFailure('cancelled' if data['error'] == 'access_denied' else 'failed')
        code = data.get('code', '')
        if not code or len(code) > 4096:
            raise SocialFailure()
        claims, refresh_token = exchange_provider_code(attempt, code)
        # Apple supplies a name once, beside the token, on the first consent.
        # It is display text only; the verified token determines the identity.
        if provider == 'apple' and len(data.get('user', '')) <= 2048:
            try:
                name = json.loads(data.get('user', '{}')).get('name', {})
                parts = [name.get('firstName', ''), name.get('lastName', '')]
                if all(isinstance(part, str) for part in parts):
                    claims = {**claims, 'name': ' '.join(parts).strip()[:40]}
            except (ValueError, AttributeError, TypeError):
                pass
        attempt.user = resolve_identity(attempt, claims, refresh_token)
    except SocialFailure as exc:
        attempt.failure = exc.reason
    except IntegrityError:
        # A concurrent first sign-in must not attach an identity to another user.
        attempt.failure = 'failed'
    except Exception as exc:
        # Provider faults are reported without URLs, tokens, codes, or response bodies.
        report_exception(exc, request)
        attempt.failure = 'failed'
    handoff = secrets.token_urlsafe(32)
    attempt.handoff_hash = digest(handoff)
    attempt.provider_verifier = ''
    attempt.nonce = ''
    attempt.expires_at = timezone.now() + timedelta(minutes=2)
    attempt.save()
    response = HttpResponse(status=302)
    response['Location'] = RETURN_URL + '?' + urlencode({'code': handoff})
    response['Cache-Control'] = 'no-store'
    response['Referrer-Policy'] = 'no-referrer'
    return response


class SocialExchange(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SocialThrottle]

    @transaction.atomic
    def post(self, request):
        code, verifier = request.data.get('code', ''), request.data.get('verifier', '')
        if (not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', code)
                or not isinstance(verifier, str) or not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', verifier)):
            return Response({'detail': 'Please restart sign-in and try again.'}, status=400)
        attempt = SocialLoginAttempt.objects.select_for_update().filter(
            handoff_hash=digest(code), expires_at__gt=timezone.now()).first()
        if not attempt or not secrets.compare_digest(challenge_for(verifier), attempt.challenge):
            return Response({'detail': 'That sign-in has expired. Please try again.'}, status=400)
        # A conditional delete also enforces single use on databases without row locks.
        if not SocialLoginAttempt.objects.filter(pk=attempt.pk).delete()[0]:
            return Response({'detail': 'That sign-in has expired. Please try again.'}, status=400)
        if attempt.failure:
            return Response({'detail': FAILURES.get(attempt.failure, FAILURES['failed'])}, status=400)
        user = attempt.user
        if not user or not user.is_active:
            return Response({'detail': FAILURES['inactive']}, status=400)
        if attempt.purpose == 'reauth':
            return Response({'reauth_token': reauth_receipt(user)})
        return Response(_signed_in(request, user))
