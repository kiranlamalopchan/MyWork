"""
The gate at the door: words that don't get posted.

Not a censor of everything anyone could take badly — that is what Report is
for — but the small set of slurs and threats there is no workplace reason to
put on a shared wall. A match refuses the post with a plain message, before
anyone else has to see it. The list can be extended per site with the
`OBJECTIONABLE_WORDS` setting.
"""

import re

from django.conf import settings

# Kept short and unambiguous on purpose: a filter that catches "class" for
# containing a rude word is a filter people learn to route around.
_DEFAULT = (
    "nigger", "nigga", "faggot", "kike", "spic", "chink", "wetback", "tranny",
    "retard", "cunt",
    "kill yourself", "kys", "i will kill you", "i'll kill you", "rape you",
)


def _pattern():
    words = list(_DEFAULT) + list(getattr(settings, "OBJECTIONABLE_WORDS", ()))
    return re.compile(
        r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in words) + r")(?![a-z0-9])",
        re.IGNORECASE,
    )


def objectionable(text):
    """Whether `text` contains something that can't go on the board."""
    if not text:
        return False
    return bool(_pattern().search(text))


REFUSED = "That can't be posted here. Keep it civil — see the community rules."
