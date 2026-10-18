"""Display formatting shared by HTML views and the mobile API."""

from django.utils import timezone
from django.utils.timesince import timesince


def relative_time(when):
    """Keep compact timestamps consistent across stories and API responses."""
    now = timezone.now()
    if now - when < timezone.timedelta(seconds=60):
        return "just now"
    return timesince(when, now).split(",")[0] + " ago"
