from django.contrib import admin

from .models import Notification, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("recipient", "kind", "title", "created_at", "read_at")
    list_filter = ("kind", "read_at")
    search_fields = ("recipient__username", "title", "body")
    raw_id_fields = ("recipient", "actor")


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    """
    Here to answer "is this person actually subscribed?", which is the first
    question whenever somebody says notifications aren't arriving.
    """

    list_display = ("user", "short_endpoint", "user_agent", "created_at", "last_sent_at")
    search_fields = ("user__username", "endpoint")
    raw_id_fields = ("user",)

    @admin.display(description="endpoint")
    def short_endpoint(self, obj):
        return f"{obj.endpoint[:48]}…"
