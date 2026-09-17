from django.contrib import admin

from .models import FriendRequest, Friendship, Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "has_photo", "updated_at")
    search_fields = ("user__username", "display_name")

    @admin.display(boolean=True, description="Photo")
    def has_photo(self, profile):
        return bool(profile.photo)


@admin.register(FriendRequest)
class FriendRequestAdmin(admin.ModelAdmin):
    list_display = ("from_user", "to_user", "created_at")
    search_fields = ("from_user__username", "to_user__username")


@admin.register(Friendship)
class FriendshipAdmin(admin.ModelAdmin):
    list_display = ("user", "friend", "created_at")
    search_fields = ("user__username", "friend__username")
