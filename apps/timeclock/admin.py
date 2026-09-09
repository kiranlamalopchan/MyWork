from django.contrib import admin

from .models import Break, Shift, TimePreference, Workplace


class BreakInline(admin.TabularInline):
    model = Break
    extra = 0


@admin.register(Workplace)
class WorkplaceAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "is_default", "hourly_rate", "hours_limit", "limit_period")
    list_filter = ("is_default", "limit_period")
    search_fields = ("name", "user__username")


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ("user", "workplace", "clock_in", "clock_out", "status")
    list_filter = ("status", "workplace")
    search_fields = ("user__username", "workplace__name")
    date_hierarchy = "clock_in"
    inlines = [BreakInline]


@admin.register(TimePreference)
class TimePreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "fortnight_anchor", "timezone_name")
