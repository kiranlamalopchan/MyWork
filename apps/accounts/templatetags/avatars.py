"""
`{% avatar %}` — one person's face, wherever MyWork needs to show one.

Every surface that names somebody also shows their face, and each one used to
build that face itself out of an initial and a hue. Adding photos would have
meant the same `{% if %}` copied into five templates, and the first one anybody
forgot would be the one still drawing a letter over somebody's picture. One tag,
one partial, one answer.
"""

from django import template

from ..models import Profile

register = template.Library()


@register.inclusion_tag("accounts/_avatar.html")
def avatar(user, size="", link=False, me=False, label=None):
    """
    Render `user`'s face.

    size  — "sm", "lg", "xl" or "" for the board's default 38px.
    link  — make it a link to their profile page on the board.
    me    — draw it in the brand colour, for the "this is you" avatars beside
            a compose box, where the point is whose box it is rather than who
            somebody is.
    label — accessible name; omitted (the default) means decorative, which is
            right whenever the person's name is already written beside it.
    """
    profile = Profile.of(user) if user is not None else None

    return {
        "profile": profile,
        "username": user.get_username() if profile else "",
        "size_class": f" avatar--{size}" if size else "",
        "me_class": " avatar--me" if me else "",
        "link": bool(link and profile),
        "label": label,
    }
