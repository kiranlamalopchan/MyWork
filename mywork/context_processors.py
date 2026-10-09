"""
Tells every template which of KaamKoRecord's apps the current page belongs to.

The tab bar is the same everywhere; what changes inside an app is the
segmented control at the top of its pages, which lists that app's own
places. Deciding it here — from the URL namespace, which every app already
declares — means no view has to remember to pass it, and a page added to
either app is navigated correctly for free.
"""

# Work groups these existing URLs into Clock, Timesheets, Pay and Settings.
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
        "name": "Items",
        "title": "My items",
        "nav": "_section_nav.html",
    },
    # Clock, timesheets, pay and settings share the Work section.
    "timeclock": {
        "name": "Work",
        "title": "My work",
        "nav": "_section_nav.html",
    },
}


PRIMARY_NAV = (
    ("home", "Home", "home", "home"),
    ("items", "Items", "search", "plu:list"),
    ("work", "Work", "clock", "timeclock:dashboard"),
    ("alerts", "Alerts", "bell", "notifications:inbox"),
    ("profile", "Profile", "person", "accounts:profile"),
)


def _link(label, route, *, icon=None, active=False, params=None, notifications=False):
    from urllib.parse import urlencode
    from django.urls import reverse

    href = reverse(route)
    if params:
        href += "?" + urlencode(params)
    return {"label": label, "href": href, "icon": icon, "active": active, "notifications": notifications}


def section(request):
    match = getattr(request, "resolver_match", None)
    namespace = match.namespace if match else ""
    page = match.url_name if match else ""
    selected = {"plu": "items", "timeclock": "work", "notifications": "alerts", "accounts": "profile"}.get(namespace, "home")
    if page == "privacy" or namespace == "moderation" and page in {"blocked", "rules"}:
        selected = "profile"
    context = {
        "timesheet_pages": TIMESHEET_PAGES, "more_pages": MORE_PAGES,
        "primary_nav": [_link(label, route, icon=icon, active=key == selected, notifications=key == "alerts") for key, label, icon, route in PRIMARY_NAV],
        "section_nav": None, "section_links": [], "section_name": None, "section_title": None,
    }
    current = SECTIONS.get(namespace)
    if not current:
        return context
    context.update(section_nav=current["nav"], section_name=current["name"], section_title=current["title"])
    if namespace == "timeclock":
        context["section_links"] = [
            _link("Clock", "timeclock:dashboard", active=page == "dashboard"),
            _link("Timesheets", "timeclock:timesheet", active=page in TIMESHEET_PAGES or page == "statement"),
            _link("Pay", "timeclock:payments", active=page == "payments"),
            _link("Settings", "timeclock:more", active=page in MORE_PAGES - {"payments", "statement"} or page == "workplace_payslip"),
        ]
    else:
        from apps.plu.catalogue import for_request

        catalogue = for_request(request)
        params = {"catalogue": catalogue.pk} if catalogue else None
        browsing = request.GET.get("view") == "catalogues"
        context["active_catalogue"] = catalogue
        links = [
            _link("Search", "plu:list", icon="search", active=page == "list" and not browsing or page == "detail", params=params),
            _link("My catalogues", "plu:list", active=page == "list" and browsing, params={"view": "catalogues"}),
        ]
        if catalogue and catalogue.code_column.lower() in {"plu", "plu_no"}:
            links.append(_link("Photo", "plu:photo_search", icon="camera", active=page == "photo_search", params=params))
        links.append(_link("Upload", "plu:import", icon="download", active=page == "import"))
        context["section_links"] = links
    return context


def me(request):
    """
    The signed-in user's own profile, for account pages and the current user.

    Fetched here rather than reached through `request.user.profile` in the
    template, so a page still renders for an account whose profile row is
    somehow missing — a template that raises on an attribute has no way to
    fall back to the letter.
    """
    from apps.accounts.models import Profile

    return {"me": Profile.of(getattr(request, "user", None))}


def version(request):
    """
    The project's version, for the line at the foot of the profile page.

    A context processor rather than something the profile view passes, so
    that anywhere else it is wanted later — an about page, a footer — it is
    already there.
    """
    from .version import VERSION

    return {"app_version": VERSION}
