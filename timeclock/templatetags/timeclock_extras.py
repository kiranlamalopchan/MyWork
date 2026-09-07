from datetime import timedelta

from django import template

register = template.Library()


def _parts(value):
    if not isinstance(value, timedelta):
        return None
    total = int(value.total_seconds())
    if total < 0:
        total = 0
    return total // 3600, (total % 3600) // 60, total % 60


@register.filter
def hm(value):
    """A timedelta as "5h 19m" — the form used everywhere totals are shown."""
    parts = _parts(value)
    if parts is None:
        return ""
    hours, minutes, _ = parts
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"


@register.filter
def hms(value):
    """A timedelta as "05:42:11", for the running clock."""
    parts = _parts(value)
    if parts is None:
        return ""
    hours, minutes, seconds = parts
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


@register.filter
def minutes(value):
    """A short break as "27m"; anything past an hour keeps the hour."""
    parts = _parts(value)
    if parts is None:
        return ""
    hours, mins, _ = parts
    return f"{hours}h {mins}m" if hours else f"{mins}m"


@register.filter
def decimal_hours(value):
    """A timedelta as a decimal like 5.32, for payroll-style reading."""
    if not isinstance(value, timedelta):
        return ""
    return f"{max(value.total_seconds(), 0) / 3600:.2f}"
