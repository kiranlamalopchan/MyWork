"""A laptop.

The default in manage.py, and the settings the test suite runs under. Nothing
here is a secret, because nothing here reaches anybody else's machine.
"""

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
