from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    # Two apps could otherwise both want to be called "notifications" —
    # Django's own contrib has no such app, but the label is what appears in
    # the admin and is worth saying out loud.
    label = "notifications"
    verbose_name = "Notifications"
