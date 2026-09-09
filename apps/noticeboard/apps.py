from django.apps import AppConfig


class NoticeboardConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.noticeboard"
    # See AccountsConfig: the label is what the database knows this app by.
    label = "noticeboard"
