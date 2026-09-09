"""Settings, one file per place the code runs.

Nothing is imported here on purpose. Which settings module is in force is a
property of the environment, not of the code, so it is chosen by
DJANGO_SETTINGS_MODULE and nowhere else:

    mywork.settings.local        a laptop, and the default in manage.py
    mywork.settings.production   a server

Both begin `from .base import *`. Anything true in both places belongs in
base.py; anything that differs belongs in exactly one of the other two, and
never in a conditional inside base.
"""
