"""
Tells every template which of MyWork's apps the current page belongs to.

The tab bar is the same everywhere; what changes inside an app is the
segmented control at the top of its pages, which lists that app's own
places. Deciding it here — from the URL namespace, which every app already
declares — means no view has to remember to pass it, and a page added to
either app is navigated correctly for free.
"""

SECTIONS = {
    "plu": {
        "name": "PLU",
        "title": "PLU Management",
        "nav": "plu/_nav_links.html",
    },
    "timeclock": {
        "name": "TimeSheet",
        "title": "TimeSheet Management",
        "nav": "timeclock/_nav_links.html",
    },
}


def section(request):
    match = getattr(request, "resolver_match", None)
    current = SECTIONS.get(match.namespace) if match else None
    if not current:
        # The hub, the account pages, the admin — no app section, so nothing
        # to segment. The tab bar is base.html's and is there regardless.
        return {"section_nav": None, "section_name": None, "section_title": None}
    return {
        "section_nav": current["nav"],
        "section_name": current["name"],
        "section_title": current["title"],
    }


def me(request):
    """
    The signed-in user's own profile, for the avatar button in the app bar.

    Fetched here rather than reached through `request.user.profile` in the
    template, so a page still renders for an account whose profile row is
    somehow missing — a template that raises on an attribute has no way to
    fall back to the letter.
    """
    from apps.accounts.models import Profile

    return {"me": Profile.of(getattr(request, "user", None))}
