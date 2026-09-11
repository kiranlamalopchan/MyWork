from django.contrib import admin

from .models import HolidayPreference, PublicHoliday


@admin.register(PublicHoliday)
class PublicHolidayAdmin(admin.ModelAdmin):
    """
    Read-mostly: everything here is rebuilt by `manage.py sync_holidays`, so
    an edit made by hand lasts until the next sync. Useful for answering "is
    it actually in there?", which is the first question when a card is empty.
    """

    list_display = ("date", "name", "state")
    list_filter = ("state", "date")
    search_fields = ("name",)
    date_hierarchy = "date"


@admin.register(HolidayPreference)
class HolidayPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "state")
    list_filter = ("state",)
    raw_id_fields = ("user",)
