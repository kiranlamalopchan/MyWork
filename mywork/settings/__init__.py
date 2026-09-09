"""Settings, one file per place the code runs.

Nothing is configured here on purpose. Which settings module is in force is a
property of the environment, not of the code, so it is chosen by
DJANGO_SETTINGS_MODULE and nowhere else:

    mywork.settings.local        a laptop, and the default in manage.py
    mywork.settings.production   a server

Both begin `from .base import *`. Anything true in both places belongs in
base.py; anything that differs belongs in exactly one of the other two, and
never in a conditional inside base.
"""

import os

from django.core.exceptions import ImproperlyConfigured

# This used to be settings.py — a real settings module — and anything still
# pointing at "mywork.settings" will import this package instead and find it
# empty. Django does not notice: it hands back a Settings object with nothing
# on it, and the first attribute it happens to want fails, which is why that
# mistake surfaces as
#
#     AttributeError: 'Settings' object has no attribute 'ROOT_URLCONF'
#
# a long way from the cause. A deployment's own WSGI file is the usual place
# it survives, because that file lives on the server rather than in the
# repository and no amount of pulling updates it.
#
# The test is deliberately narrow: importing mywork.settings.local imports
# this package too, but with DJANGO_SETTINGS_MODULE naming the submodule, so
# only the genuine mistake trips it.
if os.environ.get("DJANGO_SETTINGS_MODULE") == __name__:
    raise ImproperlyConfigured(
        "DJANGO_SETTINGS_MODULE is set to 'mywork.settings', which is a "
        "package holding the settings rather than the settings themselves. "
        "Point it at one of 'mywork.settings.production' (a server) or "
        "'mywork.settings.local' (a laptop). On PythonAnywhere this is set "
        "in the WSGI configuration file linked from the Web tab, not in the "
        "repository."
    )
