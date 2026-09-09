from django.apps import AppConfig


class PluConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.plu"
    # See AccountsConfig: the label is what the database knows this app by.
    label = "plu"
