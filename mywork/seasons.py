"""Festival display calendar, independent of payroll/public-holiday records."""
from datetime import date, timedelta
from functools import lru_cache
import logging

import holidays
from django.conf import settings
from django.utils import timezone

log = logging.getLogger(__name__)

# Display seasons, not assertions about days off work.
FESTIVALS = (
    ("Fagu Poornima", "holi", "Happy Holi", "Colours, joy and fresh beginnings."),
    ("Nepali New Year", "nepali-new-year", "Happy Nepali New Year", "Naya barsa ko subhakamana!"),
    ("Chhath", "chhath", "Happy Chhath", "Warm wishes for peace and prosperity."),
    ("Buddha Jayanti", "buddha-jayanti", "Buddha Jayanti", "A day for peace, kindness and reflection."),
    ("Shivaratri", "shivaratri", "Maha Shivaratri", "Wishing you peace and well-being."),
    ("Lhochhar", "lhosar", "Happy Lhosar", "Warm wishes for a joyful new year."),
    ("Lhosar", "lhosar", "Happy Lhosar", "Warm wishes for a joyful new year."),
    ("Maghe Sankranti", "maghe-sankranti", "Happy Maghe Sankranti", "Warm wishes for the season ahead."),
    ("Janai Poornima", "janai-poornima", "Janai Purnima", "Celebrating connection and tradition."),
    ("Krishna Janmashtami", "krishna-janmashtami", "Krishna Janmashtami", "Wishing you a joyful celebration."),
    ("Eid al-Fitr", "eid", "Eid Mubarak", "Wishing you peace, happiness and togetherness."),
    ("Eid al-Adha", "eid", "Eid Mubarak", "Wishing you peace, happiness and togetherness."),
)


@lru_cache(maxsize=6)
def calendar_for_year(year):
    days = {}

    def add(start, end, key, title, message):
        while start <= end:
            days[start.isoformat()] = {"id": key, "title": title, "message": message}
            start += timedelta(days=1)

    try:
        nepal = holidays.country_holidays("NP", years=year, language="en_US")
        for day, name in sorted(nepal.items()):
            for match, key, title, message in FESTIVALS:
                if match in name:
                    add(day, day, key, title, message)
            if "Ghatasthapana" in name:
                add(day, day + timedelta(days=14), "dashain", "Happy Dashain", "Bada Dashain ko subhakamana! Wishing you joy and togetherness.")
            if "Bhai Tika" in name:
                add(day - timedelta(days=4), day, "tihar", "Happy Tihar", "A festival of lights, love and new beginnings.")
        australia = holidays.country_holidays("AU", years=year, language="en_US")
        for day, name in australia.items():
            if "Good Friday" in name:
                add(day, day + timedelta(days=3), "easter", "Happy Easter", "Wishing you a bright and peaceful long weekend.")
    except (NotImplementedError, KeyError):
        # An older calendar package must never prevent the website rendering.
        log.warning("Festival calendar unavailable for %s; update holidays", year)

    add(date(year, 12, 1), date(year, 12, 26), "christmas", "Merry Christmas", "A little festive cheer for your working day.")
    add(date(year, 12, 27), date(year, 12, 31), "new-year", "Happy New Year", "Here’s to fresh starts and good things ahead.")
    add(date(year, 1, 1), date(year, 1, 3), "new-year", "Happy New Year", "Here’s to fresh starts and good things ahead.")
    return days



def home_festival_banner():
    """One administrator choice and one site date for every visitor."""
    from zoneinfo import ZoneInfo
    from apps.holidays.models import FestivalThemeSettings
    from apps.holidays.festivals import FESTIVAL_INFO, FESTIVAL_MOTION

    configuration = FestivalThemeSettings.objects.filter(pk=1).first()
    choice = configuration.theme if configuration else 'auto'
    if choice == 'off':
        return None
    if choice == 'auto':
        today = timezone.now().astimezone(ZoneInfo(settings.TIME_ZONE)).date()
        event = getattr(settings, 'SEASONAL_THEME_DATES', {}).get(today.isoformat())
        if event is None:
            event = calendar_for_year(today.year).get(today.isoformat())
        choice = event.get('id') if event else None
    if choice not in FESTIVAL_INFO:
        return None
    name, greeting, description, art = FESTIVAL_INFO[choice]
    manual = configuration and configuration.theme not in ('auto', 'off')
    return {
        'id': choice, 'name': name, 'motion': FESTIVAL_MOTION[choice], 'greeting': configuration.greeting if manual and configuration.greeting else greeting,
        'description': configuration.description if manual and configuration.description else description,
        'art': 'img/festivals/home-' + art + '.webp',
    }
