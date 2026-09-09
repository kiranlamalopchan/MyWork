from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    # The import path, which moved when the app did.
    name = "apps.accounts"
    # The database label, which did not, and must not: every migration already
    # applied is recorded against "accounts", and every ForeignKey written as
    # a string ("accounts.Profile") resolves through it. Django would derive
    # this same value from the last part of `name` on its own — it is spelled
    # out because the one thing that would quietly break this rename is it
    # changing, and a line that says so is cheaper than finding out.
    label = "accounts"
    verbose_name = "Accounts"
