"""Shared UI pieces, as tags rather than as markup repeated in every template.

Before this, one icon meant three or four lines of <svg> wherever it appeared,
and the same nineteen shapes accounted for eighty-nine of the hundred and
twenty-two <svg> blocks in the templates. Reading a page meant reading past
them. They are drawings, not content: naming each one once and calling it by
name is what lets a template be read as the page it describes.

Registered in TEMPLATES['OPTIONS']['libraries'] rather than by being an app,
because that is all this is — a library of tags belonging to the project as a
whole rather than to any one of its four applications.
"""

from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

register = template.Library()


# The line work of each icon, without the <svg> around it. Everything here is
# drawn on the same 24×24 grid with round caps and joins, so the wrapper is
# identical every time and only the strokes below differ.
#
# Names say what the icon means in this app rather than what it depicts —
# `back` rather than `chevron-left` — because the meaning is what a template
# is choosing when it asks for one.
ICONS = {
    "back":       '<path d="m15 18-6-6 6-6"/>',
    "chev":       '<path d="m9 18 6-6-6-6"/>',
    "chev-down":  '<path d="m6 9 6 6 6-6"/>',
    "check":      '<path d="M20 6 9 17l-5-5"/>',
    "plus":       '<path d="M12 5v14M5 12h14"/>',
    "pencil":     '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    "trash":      '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
    "search":     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    "clock":      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "alert":      '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.5"/>',
    "doc":        '<path d="M14 3v5h5"/><path d="M19 21H5V3h9l5 5v13Z"/><path d="M9 13h6M9 17h4"/>',
    "arrow-right":'<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
    "home":       '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M10 21v-5h4v5"/>',
    "camera":     '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-.9l.6-1a2 2 0 0 1 1.7-.9h2.6a2 2 0 0 1 1.7.9l.6 1a2 2 0 0 0 1.7.9h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.4"/>',
    "chat":       '<path d="M4 5h16v12H8l-4 4Z"/>',
    "chat-lines": '<path d="M4 5h16v12H8l-4 4Z"/><path d="M8 9.5h8"/><path d="M8 13h5"/>',
    "calendar":   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    "reply":      '<path d="M9 14 4 9l5-5"/><path d="M4 9h7a7 7 0 0 1 7 7v4"/>',
    "bell":       '<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 3h16Z"/><path d="M10 22h4"/>',
    "download":   '<path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
}


@register.simple_tag
def icon(name, **kwargs):
    """One icon: {% icon "back" %}, {% icon "chev" class="result__chev" %}.

    `width` overrides the stroke weight, which a few places thin or thicken to
    sit correctly at an unusual size. `label` turns the icon from decoration
    into something a screen reader announces — without it the icon is hidden,
    which is right whenever there is text beside it saying the same thing.
    """
    line = ICONS.get(name)
    if line is None:
        raise template.TemplateSyntaxError(
            "unknown icon %r — the names are in mywork/templatetags/ui.py" % (name,)
        )

    label = kwargs.get("label")
    css = kwargs.get("class")
    attrs = ['viewBox="0 0 24 24"', 'fill="none"', 'stroke="currentColor"',
             'stroke-width="%s"' % escape(kwargs.get("width", "2")),
             'stroke-linecap="round"', 'stroke-linejoin="round"']
    if css:
        attrs.insert(0, 'class="%s"' % escape(css))
    attrs.append(
        'role="img" aria-label="%s"' % escape(label) if label else 'aria-hidden="true"'
    )
    return mark_safe("<svg %s>%s</svg>" % (" ".join(attrs), line))
