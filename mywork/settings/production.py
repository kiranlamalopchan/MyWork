"""A server.

Every value that would be dangerous to guess is read from the environment and
absent from the repository. The two that cannot be defaulted safely — the
secret key and the list of hosts allowed to serve the site — raise on import
rather than falling back, so a misconfigured deployment fails at start-up
where somebody is watching, instead of at the first request.
"""

import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import BASE_DIR


def load_env_file(path):
    """Read KEY=value lines into the environment, if the file is there.

    The web app and a console are different processes. Variables exported in
    one are invisible to the other, and the server's WSGI file is read only by
    the web app — so secrets set there leave `manage.py migrate` unable to
    start, which is exactly the wall this was written to remove. A file beside
    the code is read by both.

    A real environment variable always wins: setdefault, not assignment. That
    keeps a host that injects its own configuration in charge, and makes this
    a fallback rather than an override.

    Deliberately about ten lines and no dependency. It understands KEY=value,
    blank lines, # comments and surrounding quotes, which is the whole of what
    a file like this ever holds.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


# Never committed — see .gitignore.
load_env_file(BASE_DIR / ".env")


def required(name):
    """An environment variable with no sensible default."""
    try:
        return os.environ[name]
    except KeyError:
        raise ImproperlyConfigured(
            f"{name} is not set. Put it in {BASE_DIR / '.env'} as\n"
            f"    {name}=...\n"
            f"or export it, to run with mywork.settings.production."
        ) from None


SECRET_KEY = required('DJANGO_SECRET_KEY')

DEBUG = False

# Comma-separated, e.g. "mywork.example.com,www.mywork.example.com".
ALLOWED_HOSTS = [h.strip() for h in required('DJANGO_ALLOWED_HOSTS').split(',') if h.strip()]

# Django needs the scheme as well as the host to validate a POST's Origin.
CSRF_TRUSTED_ORIGINS = [f'https://{host}' for host in ALLOWED_HOSTS if '*' not in host]


# --------------------------------------------------------------------------
# Database
#
# Postgres when it is configured, and the file-backed database otherwise —
# which is a real deployment for an app this size, on one box, with the file
# on a backed-up volume. It is a deliberate choice either way rather than an
# accident: set POSTGRES_DB to move.
# --------------------------------------------------------------------------
if os.environ.get('POSTGRES_DB'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ['POSTGRES_DB'],
            'USER': os.environ.get('POSTGRES_USER', 'mywork'),
            'PASSWORD': required('POSTGRES_PASSWORD'),
            'HOST': os.environ.get('POSTGRES_HOST', 'localhost'),
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
            # One connection held open per worker rather than opened per
            # request; the handshake costs more than the query on most pages.
            'CONN_MAX_AGE': 600,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': os.environ.get('SQLITE_PATH', BASE_DIR / 'db.sqlite3'),
        }
    }


# --------------------------------------------------------------------------
# Web Push
#
# Optional, unlike the two above: a deployment with no keys records
# notifications and shows them on the bell, and simply never interrupts
# anybody. That is a working site, so it must not refuse to start — which is
# why these are `get` rather than `required`.
# --------------------------------------------------------------------------
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_CONTACT_EMAIL = os.environ.get('VAPID_CONTACT_EMAIL', '')


# --------------------------------------------------------------------------
# Transport security
#
# All of this assumes TLS terminates in front of Django, which is how it is
# almost always deployed. SECURE_PROXY_SSL_HEADER is what lets Django know a
# request that reached it over plain HTTP arrived over HTTPS at the proxy —
# only trust it if that proxy is yours and strips the header from the client.
# --------------------------------------------------------------------------
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# The session cookie is read by the server, never by page scripts.
SESSION_COOKIE_HTTPONLY = True

# Start low. A long max-age is a promise the browser will not let you take
# back, so raise it once certificate renewal has been seen to work.
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'


# --------------------------------------------------------------------------
# Static files
#
# Hashed filenames, so a stylesheet can be cached forever and still change:
# app.css becomes app.<hash>.css and the name moves when the content does.
# --------------------------------------------------------------------------
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'django.contrib.staticfiles.storage.ManifestStaticFilesStorage',
    },
}


# --------------------------------------------------------------------------
# Logging — to the process's own stderr, for the service manager to collect.
# --------------------------------------------------------------------------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'plain': {'format': '{asctime} {levelname} {name} {message}', 'style': '{'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'},
    },
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        # A 500 is worth a stack trace in the log even though nobody sees a
        # debug page any more.
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
    },
}
