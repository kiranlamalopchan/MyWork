"""Email recovery configuration, loaded after the environment file."""
import os


def mail_settings():
    return {
        'EMAIL_BACKEND': 'apps.accounts.email_backend.BrevoEmailBackend',
        'BREVO_API_KEY': os.environ.get('BREVO_API_KEY', ''),
        'DEFAULT_FROM_EMAIL': os.environ.get('DEFAULT_FROM_EMAIL', ''),
        'PASSWORD_RESET_BASE_URL': os.environ.get('PASSWORD_RESET_BASE_URL', '').rstrip('/'),
        'EMAIL_TIMEOUT': 10,
        'PASSWORD_RESET_TIMEOUT': 3600,
    }
