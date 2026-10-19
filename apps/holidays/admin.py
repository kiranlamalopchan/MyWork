from django.contrib import admin

from .models import FestivalThemeSettings, HolidayPreference, PublicHoliday
from .forms import FestivalBannerForm


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


@admin.register(FestivalThemeSettings)
class FestivalThemeSettingsAdmin(admin.ModelAdmin):
    form = FestivalBannerForm
    fields = ('theme', 'banner', 'greeting', 'description', 'updated_at')
    readonly_fields = ('updated_at',)

    def has_add_permission(self, request):
        return super().has_add_permission(request) and not FestivalThemeSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
