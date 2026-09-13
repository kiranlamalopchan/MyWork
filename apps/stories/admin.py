from django.contrib import admin

from .models import Story, StoryReaction, StoryView


@admin.register(Story)
class StoryAdmin(admin.ModelAdmin):
    list_display = ("author", "created_at", "expires_at", "caption")
    list_filter = ("author",)
    date_hierarchy = "created_at"


admin.site.register(StoryView)
admin.site.register(StoryReaction)
