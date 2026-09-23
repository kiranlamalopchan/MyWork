"""
Working out which state somebody is in, when they have never said.

The default used to be the Northern Territory for everybody, because that is
where this project's clock is set — so a new account in Sydney was quietly
told about Picnic Day and never heard about the Queen's Birthday. Silently
wrong is worse than blank: there is nothing on the screen to argue with.

Every request already carries the phone's IANA timezone (the app sends the
`X-Timezone` header, the site writes a `plu_tz` cookie — see
apps/timeclock/middleware.py), and in Australia that names the state closely
enough to be a good opening guess. It is a guess and nothing more: it is used
only where nobody has chosen, the screen still says which state it is
showing, and one tap overrules it for good.

Two things it cannot do. Canberra has no zone of its own — `Australia/
Canberra` is a backwards-compatibility alias for `Australia/Sydney` in the
tz database — so the ACT is indistinguishable from New South Wales and its
people have to correct it once. And a phone whose clock is set to the wrong
place will be guessed wrong; it is reading a setting, not a satellite.
"""

from .models import State

# Every Australian zone in the tz database, not just the seven capitals.
# The outliers are the point: Broken Hill is in New South Wales but keeps
# South Australian time, Eucla is Western Australia on a half-hour of its
# own, Lord Howe is New South Wales, Lindeman is Queensland. Mapping only
# the obvious ones would get those wrong in a way that looks arbitrary.
STATE_BY_ZONE = {
    "australia/sydney": State.NSW,
    "australia/canberra": State.NSW,      # an alias for Sydney; the ACT cannot be seen
    "australia/nsw": State.NSW,           # the old-style name, still in the database
    "australia/broken_hill": State.NSW,   # NSW, on South Australian time
    "australia/lord_howe": State.NSW,
    "australia/lhi": State.NSW,
    "australia/melbourne": State.VIC,
    "australia/victoria": State.VIC,
    "australia/brisbane": State.QLD,
    "australia/queensland": State.QLD,
    "australia/lindeman": State.QLD,
    "australia/adelaide": State.SA,
    "australia/south": State.SA,
    "australia/yancowinna": State.NSW,    # the old name for Broken Hill
    "australia/perth": State.WA,
    "australia/west": State.WA,
    "australia/eucla": State.WA,
    "australia/hobart": State.TAS,
    "australia/currie": State.TAS,        # retired, but old phones still say it
    "australia/tasmania": State.TAS,
    "australia/darwin": State.NT,
    "australia/north": State.NT,
}


def state_from_timezone(name: str | None) -> str | None:
    """
    The state a phone reporting this IANA zone is most likely in, or None.

    None for anything outside Australia, anything unrecognised, and anything
    empty — every one of which means "no opinion", and leaves the caller's
    own default standing.
    """
    if not name:
        return None
    return STATE_BY_ZONE.get(name.strip().lower().replace(" ", "_"))


def timezone_of(request) -> str:
    """
    The zone this request came from, by the same order of preference the
    timezone middleware uses: what the phone just said, then what the
    browser last wrote down.
    """
    return (request.headers.get("X-Timezone") or request.COOKIES.get("plu_tz") or "").strip()[:64]


def guess_state(request) -> str | None:
    """The state to fall back on for somebody who has never chosen one."""
    return state_from_timezone(timezone_of(request))
