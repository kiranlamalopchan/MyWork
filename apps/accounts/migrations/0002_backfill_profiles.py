"""
Give every account that predates profiles one.

The signal in apps.accounts.models only fires for accounts created after it, so
without this the people already using MyWork would be the only ones unable to
set a photo — and every page reading `user.profile` would have to guard
against them for good.
"""

from django.db import migrations


def create_missing(apps, schema_editor):
    User = apps.get_model("auth", "User")
    Profile = apps.get_model("accounts", "Profile")

    Profile.objects.bulk_create(
        [
            Profile(user_id=pk, display_name="", photo="")
            for pk in User.objects.exclude(profile__isnull=False).values_list(
                "pk", flat=True
            )
        ]
    )


def drop(apps, schema_editor):
    """Reversing means unmaking profiles; the table goes with 0001 anyway."""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(create_missing, drop),
    ]
