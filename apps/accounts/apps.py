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

    def ready(self):
        # Teach Pillow to open HEIC/HEIF — what an iPhone photographs in —
        # once, for the whole process. Every ImageField in the project (the
        # profile photo, a story, a photographed picking list) checks its
        # upload with Image.open before a view sees it, so the opener has to
        # be registered before the first request rather than by whichever
        # view happens to need it first. This is the first of our apps to
        # load, which is why the registration lives here.
        try:
            from pillow_heif import register_heif_opener
        except ImportError:
            return
        register_heif_opener()
