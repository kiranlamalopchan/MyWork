"""Check email-reset settings without sending an email or displaying secrets."""
from django.core.management.base import BaseCommand, CommandError
from apps.accounts.recovery import require_email_setup, RecoveryUnavailable


class Command(BaseCommand):
    help = 'Check password recovery configuration without sending email.'

    def handle(self, **options):
        try:
            origin = require_email_setup()
        except RecoveryUnavailable:
            raise CommandError('Set BREVO_API_KEY, DEFAULT_FROM_EMAIL and PASSWORD_RESET_BASE_URL in the project .env. See docs/password-recovery.md.') from None
        self.stdout.write(self.style.SUCCESS(f'Password recovery settings are ready for {origin.netloc}.'))
        self.stdout.write('Verify the sender email in Brevo, then test delivery from Forgot password. No email was sent by this check.')
