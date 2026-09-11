"""A laptop.

The default in manage.py, and the settings the test suite runs under. Nothing
here is a secret, because nothing here reaches anybody else's machine.
"""

import os

from .base import *  # noqa: F401,F403
from .base import BASE_DIR

# Not a secret. It signs sessions on one developer machine, and production.py
# refuses to start without a real one, so there is no path by which this value
# ends up guarding anything.
SECRET_KEY = 'django-insecure-change-me-20260305051257'

DEBUG = True

# The app is opened from a phone on the same Wi-Fi, which means the request
# arrives with the laptop's LAN IP as its Host header. Locking this to
# localhost would reject those with a 400.
ALLOWED_HOSTS = ['*']


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


# --------------------------------------------------------------------------
# Web Push
#
# Empty unless exported, so notifications are recorded and shown on the bell
# and nothing is sent. To try the sending half on this machine:
#
#     python manage.py vapid_keys
#     export VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_CONTACT_EMAIL=you@example.com
#
# and open the site at http://localhost:8000 — a service worker needs a
# secure context, and localhost counts as one where the laptop's LAN IP does
# not. Testing it from the phone means testing it on the deployed site.
# --------------------------------------------------------------------------
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_CONTACT_EMAIL = os.environ.get('VAPID_CONTACT_EMAIL', '')
