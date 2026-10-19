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
        # Read here rather than in base.py: base is imported before the .env
        # file is loaded, so a CONTACT_EMAIL kept in .env was never seen there.
        'CONTACT_EMAIL': os.environ.get('CONTACT_EMAIL', '') or os.environ.get('VAPID_CONTACT_EMAIL', ''),
    }
