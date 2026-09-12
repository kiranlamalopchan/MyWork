"""
Tells every template which of MyWork's apps the current page belongs to.

The tab bar is the same everywhere; what changes inside an app is the
segmented control at the top of its pages, which lists that app's own
places. Deciding it here — from the URL namespace, which every app already
declares — means no view has to remember to pass it, and a page added to
either app is navigated correctly for free.
"""

# TimeSheet is three tabs of the dock, and these say which of its pages
# belong to which: the timesheet and its calendar, the shifts on it and the
# forms for them; More and everything it leads to. What is in neither is the
# Clock's. The dock (_tabs.html) reads both to light one tab and no other.
TIMESHEET_PAGES = frozenset({
    "timesheet", "calendar", "shift_detail", "shift_edit", "shift_create",
})
MORE_PAGES = frozenset({
    "more", "workplaces", "workplace_create", "workplace_edit",
    "workplace_confirm_delete", "payments", "statement",
    "preferences",
})

SECTIONS = {
    "plu": {
        "name": "PLU",
        "title": "PLU Management",
        "nav": "plu/_nav_links.html",
    },
    # No segments: its places are tabs of the dock (see TIMESHEET_PAGES).
    "timeclock": {
        "name": "TimeSheet",
        "title": "TimeSheet Management",
        "nav": None,
    },
}


def section(request):
    match = getattr(request, "resolver_match", None)
    current = SECTIONS.get(match.namespace) if match else None
    tabs = {"timesheet_pages": TIMESHEET_PAGES, "more_pages": MORE_PAGES}
    if not current:
        # The hub, the account pages, the admin — no app section, so nothing
        # to segment. The tab bar is base.html's and is there regardless.
        return dict(tabs, section_nav=None, section_name=None, section_title=None)
    return dict(
        tabs,
        section_nav=current["nav"],
        section_name=current["name"],
        section_title=current["title"],
    )


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
