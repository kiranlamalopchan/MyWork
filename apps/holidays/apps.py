from django.apps import AppConfig


class HolidaysConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.holidays"
    # Said out loud because the app shares a name with the `holidays` package
    # it reads from; the label is what migrations and the admin know it by.
    label = "holidays"
    verbose_name = "Public holidays"
