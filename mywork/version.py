"""
What version of KaamKoRecord this is.

One number for the whole project, site and app alike. The app carries its
own copy in mobile/app.json, because the stores read that file and nothing
else — so the two are kept in step by a test (see `VersionTests`) rather
than by anybody remembering.

The site has no build number of its own: it is whatever was last pulled,
and a number that changed on every deploy would say nothing a date does
not. The app's build number comes from the binary, where EAS put it.
"""

VERSION = "1.1.0"
