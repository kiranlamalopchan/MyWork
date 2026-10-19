"""
Figures both faces of the app draw the same way: a duration as the app and
the site's chart read it, and the trend — what was earned (or worked, for a
job with no rate) across a week, a fortnight, a month or six months, laid
over the span before it. The API (apps/api/views/timeclock.py) and the
website's chart (views.trend) both serve exactly this, so the phone and the
browser can never draw two different weeks.
"""

from datetime import date, datetime, time, timedelta

from django.utils import timezone

from .models import (
    Shift, TimePreference, Workplace, fortnight_start, month_start, next_month_start, price_shifts, week_start,
)
from .templatetags.timeclock_extras import decimal_hours, hm, hms, minutes


def duration(value):
    """A timedelta as the app draws it: seconds, and the site's words for it."""
    value = value or timedelta()
    return {
        "seconds": int(max(value.total_seconds(), 0)),
        "hm": hm(value) or "0m",
        "hms": hms(value),
        "minutes": minutes(value),
        "decimal": decimal_hours(value),
    }


# ---- trend ----------------------------------------------------------------------
#
# The chart on the timesheet and pay screens: what was earned (or worked, for
# a job with no rate) in each day, week or month of a span, beside the span
# before it, so a week can be read against the last one. Every shift is priced
# by `price_shifts` — the pay screen's own figures, tax period and all.

# key: (switch label, this span, the span before)
TREND_RANGES = {
    "week": ("Weekly", "This week", "Last week"),
    "fortnight": ("Fortnightly", "This fortnight", "Last fortnight"),
    "month": ("Monthly", "This month", "Last month"),
    "months": ("6 months", "Last 6 months", "6 months before"),
}


def _add_months(day, months):
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _by_week(start, end):
    """A span cut into 7-day stretches from its start, the last one as short as it needs to be."""
    out, s = [], start
    while s < end:
        out.append((s, min(s + timedelta(days=7), end)))
        s += timedelta(days=7)
    return out


def trend_buckets(kind, today, pref):
    """
    ([(start, end_exclusive, label, long_label)], [(start, end_exclusive)]):
    the span cut into its points, oldest first, and the same points of the
    span before it. The week, fortnight and month are this person's own —
    starting on the day they set for each, the way their pay is counted.
    """
    if kind == "months":
        first = _add_months(today.replace(day=1), -5)
        spans = [(_add_months(first, i), _add_months(first, i + 1)) for i in range(6)]
        twins = [(_add_months(s, -6), _add_months(e, -6)) for s, e in spans]
        return [(s, e, s.strftime("%b"), s.strftime("%B %Y")) for s, e in spans], twins
    if kind == "month":
        start = month_start(today, pref.month_starts_on)
        end = next_month_start(today, pref.month_starts_on)
        before = month_start(start - timedelta(days=1), pref.month_starts_on)
        spans = _by_week(start, end)
        # Stretch by stretch against last month's; a longer month's extra days fall in its last.
        twins = [(min(before + (s - start), start), min(before + (e - start), start) if i < len(spans) - 1 else start) for i, (s, e) in enumerate(spans)]
        return [(s, e, s.strftime("%-d %b"), f"{s.strftime('%-d')}–{(e - timedelta(days=1)).strftime('%-d %b')}") for s, e in spans], twins
    if kind == "fortnight":
        start = fortnight_start(today, pref.fortnight_anchor)
        spans = [(start + timedelta(days=i), start + timedelta(days=i + 1)) for i in range(14)]
        back = timedelta(days=14)
        return [(s, e, s.strftime("%-d"), s.strftime("%A %-d %b")) for s, e in spans], [(s - back, e - back) for s, e in spans]
    start = week_start(today, pref.week_starts_on)
    spans = [(start + timedelta(days=i), start + timedelta(days=i + 1)) for i in range(7)]
    back = timedelta(days=7)
    return [(s, e, s.strftime("%a"), s.strftime("%A %-d %b")) for s, e in spans], [(s - back, e - back) for s, e in spans]


def trend_json(user, kind="week", workplace=None, today=None):
    kind = kind if kind in TREND_RANGES else "week"
    today = today or timezone.localdate()
    buckets, twins = trend_buckets(kind, today, TimePreference.for_user(user))
    before, end = min(s for s, _ in twins), buckets[-1][1]

    tz = timezone.get_current_timezone()
    since = timezone.make_aware(datetime.combine(before, time.min), tz)
    until = timezone.make_aware(datetime.combine(end, time.min), tz)
    qs = Shift.objects.filter(user=user, clock_in__gte=since, clock_in__lt=until).select_related("workplace").prefetch_related("breaks")
    if workplace:
        qs = qs.filter(workplace=workplace)
    shifts = list(qs)
    priced = price_shifts(shifts)

    def tally(spans):
        out = []
        for s, e in spans:
            mine = [x for x in shifts if s <= timezone.localtime(x.clock_in).date() < e]
            worked = sum((x.worked_duration for x in mine), timedelta())
            gross = [priced[x.pk].gross for x in mine if x.pk in priced]
            out.append({"worked": worked, "gross": round(sum(gross), 2) if gross else None})
        return out

    now_points, then_points = tally((s, e) for s, e, *_ in buckets), tally(twins)
    has_rate = bool(priced) or (workplace.hourly_rate is not None if workplace else Workplace.objects.filter(user=user, hourly_rate__isnull=False).exists())

    def point(p):
        return {"hours": round(p["worked"].total_seconds() / 3600, 2), "worked": duration(p["worked"]), "gross": p["gross"] or (0.0 if has_rate else None)}

    def total(points):
        worked = sum((p["worked"] for p in points), timedelta())
        gross = [p["gross"] for p in points if p["gross"] is not None]
        return {"hours": round(worked.total_seconds() / 3600, 2), "worked": duration(worked), "gross": round(sum(gross), 2) if has_rate else None}

    return {
        "range": kind,
        "title": TREND_RANGES[kind][1],
        "compare_title": TREND_RANGES[kind][2],
        "ranges": [{"value": k, "label": v[0]} for k, v in TREND_RANGES.items()],
        "priced": has_rate,
        "points": [
            {**point(p), "start": s.isoformat(), "label": label, "long_label": long_label, "upcoming": s > today, "current": s <= today < e}
            for (s, e, label, long_label), p in zip(buckets, now_points)
        ],
        "previous": [point(p) for p in then_points],
        "total": total(now_points),
        "previous_total": total(then_points),
    }
