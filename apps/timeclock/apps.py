from django.apps import AppConfig


class TimeclockConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.timeclock"
    # See AccountsConfig: the label is what the database knows this app by.
    label = "timeclock"
