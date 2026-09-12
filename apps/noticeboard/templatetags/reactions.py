"""
The faces on the board, drawn rather than typed.

An emoji is a different picture on every phone — a thumb on one is a fist on
another, and the yellow face is a different yellow face everywhere — so the
board draws its own. Each reaction is a small inline SVG: a coloured disc
with the face on it, the way the reaction bar on a social app draws them, so
the row of faces is the same row on every device and can be animated.

    {% reaction emoji %}            the icon for one emoji
    {{ emoji|reaction_kind }}       "like", "love", ... for a class or data-attr

Anything that is not on the menu is shown as the glyph it is, so a reaction
left before a face was retired still shows up as something.
"""

from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

from ..models import Emoji

register = template.Library()

# What each reaction is called in CSS and in the DOM.
KINDS = {
    Emoji.LIKE: "like",
    Emoji.LOVE: "love",
    Emoji.CARE: "care",
    Emoji.HAHA: "haha",
    Emoji.WOW: "wow",
    Emoji.SAD: "sad",
    Emoji.ANGRY: "angry",
}

# The palette. Two discs are their own colour, the faces share one.
BLUE = "#1b74e4"
RED = "#f0284a"
YELLOW = "#f7b125"
ORANGE = "#ec5a3b"
INK = "#3b2408"        # the features on a yellow face
INK_ANGRY = "#3a1005"
TEAR = "#3f8ff0"

# The drawing of each face, on a 32×32 grid with the disc already behind it.
# Stroked features use round caps so they read at 16px on a tally as well as
# at 40px in the picker.
FACES = {
    "like": (BLUE,
        '<path d="M18.9 13.2V9.6a2.5 2.5 0 0 0-2.5-2.5l-3.4 7.6v8.9h9.5a1.7 1.7 0 0 0 1.7-1.5l1.2-7.6a1.7 1.7 0 0 0-1.7-2h-4.8Z'
        'M13 14.7H10.6a1.7 1.7 0 0 0-1.7 1.7v5.5a1.7 1.7 0 0 0 1.7 1.7H13"'
        ' fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>'),
    "love": (RED,
        '<path d="M22.7 11.2a4.3 4.3 0 0 0-6.1 0l-.6.6-.6-.6a4.3 4.3 0 0 0-6.1 6.1l.6.6 6.1 6.1 6.1-6.1.6-.6a4.3 4.3 0 0 0 0-6.1Z"'
        ' fill="#fff"/>'),
    "care": (YELLOW,
        '<path d="M9 11.2c1-1.5 3-1.5 4 0M19 11.2c1-1.5 3-1.5 4 0" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<path d="M12 15c1.1 1.3 2.4 2 4 2s2.9-.7 4-2" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<path d="M21.5 21.2a3 3 0 0 0-4.3 0l-.4.4-.4-.4a3 3 0 0 0-4.3 4.3l.4.4 4.3 4.3 4.3-4.3.4-.4a3 3 0 0 0 0-4.3Z"'
        ' fill="%(red)s"/>' % {"ink": INK, "red": RED}),
    "haha": (YELLOW,
        '<path d="M8.5 12.6c1.1-1.7 3.3-1.7 4.4 0M19.1 12.6c1.1-1.7 3.3-1.7 4.4 0" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<path d="M8.2 17.4h15.6c0 4.5-3.5 7.6-7.8 7.6s-7.8-3.1-7.8-7.6Z" fill="%(ink)s"/>'
        '<path d="M11.6 22.4c1.3-1.4 7.5-1.4 8.8 0-1 1.6-2.6 2.6-4.4 2.6s-3.4-1-4.4-2.6Z" fill="%(red)s"/>' % {"ink": INK, "red": RED}),
    "wow": (YELLOW,
        '<path d="M8.8 9.6c1.1-1.5 3.3-1.5 4.4 0M18.8 9.6c1.1-1.5 3.3-1.5 4.4 0" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<ellipse cx="11" cy="13.8" rx="1.7" ry="2.3" fill="%(ink)s"/><ellipse cx="21" cy="13.8" rx="1.7" ry="2.3" fill="%(ink)s"/>'
        '<ellipse cx="16" cy="22.2" rx="3" ry="4" fill="%(ink)s"/>' % {"ink": INK}),
    "sad": (YELLOW,
        '<path d="M8.4 12c1.3-1.5 3.1-2 4.8-1.3M23.6 12c-1.3-1.5-3.1-2-4.8-1.3" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<circle cx="11.4" cy="15.3" r="1.6" fill="%(ink)s"/><circle cx="20.6" cy="15.3" r="1.6" fill="%(ink)s"/>'
        '<path d="M11.4 24c1.3-1.9 2.9-2.8 4.6-2.8s3.3.9 4.6 2.8" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>'
        '<path d="M23.2 16.6s2.5 3.3 2.5 4.9a2.5 2.5 0 0 1-5 0c0-1.6 2.5-4.9 2.5-4.9Z" fill="%(tear)s"/>' % {"ink": INK, "tear": TEAR}),
    "angry": (ORANGE,
        '<path d="M8.6 11.2l5.2 2.3M23.4 11.2l-5.2 2.3" fill="none" stroke="%(ink)s" stroke-width="2" stroke-linecap="round"/>'
        '<circle cx="11.6" cy="16.2" r="1.5" fill="%(ink)s"/><circle cx="20.4" cy="16.2" r="1.5" fill="%(ink)s"/>'
        '<path d="M11.2 23.6c1.4-1.5 3-2.2 4.8-2.2s3.4.7 4.8 2.2" fill="none" stroke="%(ink)s" stroke-width="1.8" stroke-linecap="round"/>' % {"ink": INK_ANGRY}),
}


@register.filter
def reaction_kind(emoji):
    """"like", "love", ... — or "" for anything not on the menu."""
    return KINDS.get(emoji, "")


@register.simple_tag
def reaction(emoji, **kwargs):
    """
    The icon for one reaction: {% reaction notice.my_emoji %}.

    `label` makes it something a screen reader reads out; without it the
    icon is decoration beside text that already says the same thing.
    """
    kind = KINDS.get(emoji)
    label = kwargs.get("label")
    aria = (
        'role="img" aria-label="%s"' % escape(label) if label else 'aria-hidden="true"'
    )
    if kind is None:
        return mark_safe('<span class="rx rx--glyph" %s>%s</span>' % (aria, escape(emoji)))
    disc, face = FACES[kind]
    return mark_safe(
        '<svg class="rx rx--%s" viewBox="0 0 32 32" %s>'
        '<circle cx="16" cy="16" r="16" fill="%s"/>%s</svg>' % (kind, aria, disc, face)
    )
