"""
What somebody looks like on MyWork, before they have uploaded anything.

The letter and the colour are derived from the username rather than stored, so
a new account has a face from its first page load, the same face on every
device, and nothing has to be assigned or migrated. A photo, once set,
replaces the letter — it never replaces the colour, which still backs the
photo while it loads and shows through a transparent PNG.

This lives in `accounts` because it describes a person, not a notice. The
notice board imported these from its own models for a long time and still can:
`apps.noticeboard.models` re-exports both names.
"""


def initial_for(name):
    """The letter on somebody's avatar."""
    return (name or "?")[:1].upper()


def hue_for(name):
    """
    A stable colour for somebody's avatar, 0-359.

    Derived from the name itself rather than stored, so the same person is the
    same colour on every device and nothing has to be assigned.
    """
    return sum(ord(c) * (i + 1) for i, c in enumerate(name or "")) % 360
