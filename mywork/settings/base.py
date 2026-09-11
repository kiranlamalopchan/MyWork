"""Settings shared by every environment MyWork runs in.

This file makes no decision that depends on where the code is running. It has
no `if DEBUG`, reads no environment variables, and does not define SECRET_KEY,
DEBUG, ALLOWED_HOSTS or DATABASES — those are the four things that genuinely
differ between a laptop and a server, and each is set in local.py or
production.py where the difference can be seen rather than inferred.
"""

from pathlib import Path

# .../mywork/settings/base.py → .../mywork/settings → .../mywork → the repo.
# Three parents, not two: this file sits one directory deeper than the
# settings.py it replaced.
BASE_DIR = Path(__file__).resolve().parent.parent.parent


# --------------------------------------------------------------------------
# Applications
# --------------------------------------------------------------------------
DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # "3 minutes ago" on the notice board reads better than a timestamp.
    'django.contrib.humanize',
]

LOCAL_APPS = [
    # Who you are on MyWork — the profile behind the avatar in the app bar.
    'apps.accounts',
    'apps.plu',
    'apps.timeclock',
    'apps.noticeboard',
    # The bell: one mailbox every app writes into, and the push subscriptions
    # that carry a line of it to a phone.
    'apps.notifications',
    # Australian public holidays — the card on the hub, and the API the
    # mobile app reads it from.
    'apps.holidays',
]

# Split in two so that "which of these did we write?" is answered by reading
# rather than by recognising names.
INSTALLED_APPS = DJANGO_APPS + LOCAL_APPS


MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Must sit after AuthenticationMiddleware: it reads request.user to find
    # which timezone the user's phone reported.
    'apps.timeclock.middleware.UserTimezoneMiddleware',
    # Also after it, and for the same reason: it records that request.user
    # was here, which is what puts the live dot on their face on the board.
    'apps.accounts.middleware.PresenceMiddleware',
    # Last, because it is the only one that may do real work: roughly four
    # times an hour it runs the timesheet reminders, which is how they run at
    # all on a host whose scheduler offers one task a day.
    'apps.timeclock.middleware.ReminderSweepMiddleware',
]


ROOT_URLCONF = 'mywork.urls'
WSGI_APPLICATION = 'mywork.wsgi.application'


# --------------------------------------------------------------------------
# Templates — one directory at the repository root, not one per app
# --------------------------------------------------------------------------
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                # Which of MyWork's apps the current page belongs to, so
                # base.html can render that app's navigation and nothing else.
                'mywork.context_processors.section',
                # The signed-in user's own photo and name, for the app bar.
                'mywork.context_processors.me',
                # What is waiting for them, for the bell beside it.
                'apps.notifications.context_processors.notifications',
            ],
            # Tags belonging to the project rather than to any one app: the
            # icon set and the backlink, used by all four. Registered here so
            # that mywork does not have to pretend to be an application to
            # own a template library.
            'libraries': {
                'ui': 'mywork.templatetags.ui',
            },
        },
    },
]


# --------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LOGIN_URL = '/login/'
# After signing in you land on the hub, where you pick an app.
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/login/'


# --------------------------------------------------------------------------
# Locale
# --------------------------------------------------------------------------
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Australia/Darwin'

USE_I18N = True
USE_TZ = True


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------
STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
# Where `collectstatic` gathers everything (including django.contrib.admin's
# own CSS/JS) into one directory for the host to serve directly.
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Uploads — profile photos. Kept out of STATIC_ROOT: static files
# ship with the code and are collected, these arrive from users and are backed
# up with the database, not with the repository.
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'


# --------------------------------------------------------------------------
# Web Push
#
# Off unless configured, which is the only default this file can honestly
# have: the keys are secrets, and secrets belong where the environment is
# read. An empty public key is what tells the page not to offer a switch that
# could not do anything, so a laptop with none set behaves correctly rather
# than half-working.
#
# Generate a pair with `python manage.py vapid_keys` and put them in .env;
# production.py reads them there. They are the identity of this site to every
# push service, so changing them later invalidates every subscription already
# handed out and everybody has to turn notifications on again.
# --------------------------------------------------------------------------
VAPID_PUBLIC_KEY = ''
VAPID_PRIVATE_KEY = ''
# Where a push service writes if this site starts misbehaving. They all
# require one, and all of them require it to be an address.
VAPID_CONTACT_EMAIL = ''


DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
