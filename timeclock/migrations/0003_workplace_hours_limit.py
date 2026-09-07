"""
The hours cap moves from the user to each workplace.

One cap per person couldn't describe two jobs with two different agreements,
so `hours_limit`, `limit_period` and the fortnight anchor now sit on every
Workplace. Existing caps are copied onto each of the user's active workplaces
— the closest reading of a single cap that was almost certainly set with one
job in mind — and can then be adjusted per workplace.
"""

from django.db import migrations, models

import timeclock.models


def copy_limits_onto_workplaces(apps, schema_editor):
    TimePreference = apps.get_model("timeclock", "TimePreference")
    Workplace = apps.get_model("timeclock", "Workplace")

    for pref in TimePreference.objects.all():
        if pref.hours_limit is None:
            continue
        Workplace.objects.filter(user_id=pref.user_id, is_archived=False).update(
            hours_limit=pref.hours_limit,
            limit_period=pref.limit_period,
            fortnight_anchor=pref.fortnight_anchor,
        )


def collapse_limits_back_onto_the_user(apps, schema_editor):
    """Reverse: the default workplace's cap becomes the user's single cap."""
    TimePreference = apps.get_model("timeclock", "TimePreference")
    Workplace = apps.get_model("timeclock", "Workplace")

    for pref in TimePreference.objects.all():
        source = (
            Workplace.objects.filter(
                user_id=pref.user_id, is_archived=False, hours_limit__isnull=False
            )
            .order_by("-is_default", "pk")
            .first()
        )
        if source is None:
            continue
        pref.hours_limit = source.hours_limit
        pref.limit_period = source.limit_period
        pref.fortnight_anchor = source.fortnight_anchor
        pref.save(update_fields=["hours_limit", "limit_period", "fortnight_anchor"])


class Migration(migrations.Migration):

    dependencies = [
        ("timeclock", "0002_timepreference_timezone_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="workplace",
            name="hours_limit",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.AddField(
            model_name="workplace",
            name="limit_period",
            field=models.CharField(
                choices=[("WEEK", "Per week"), ("FORTNIGHT", "Per fortnight")],
                default="FORTNIGHT",
                max_length=9,
            ),
        ),
        migrations.AddField(
            model_name="workplace",
            name="fortnight_anchor",
            field=models.DateField(default=timeclock.models._monday_of_this_week),
        ),
        migrations.RunPython(copy_limits_onto_workplaces, collapse_limits_back_onto_the_user),
        migrations.RemoveField(model_name="timepreference", name="hours_limit"),
        migrations.RemoveField(model_name="timepreference", name="limit_period"),
    ]
