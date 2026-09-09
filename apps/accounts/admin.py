from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "has_photo", "updated_at")
    search_fields = ("user__username", "display_name")

    @admin.display(boolean=True, description="Photo")
    def has_photo(self, profile):
        return bool(profile.photo)
