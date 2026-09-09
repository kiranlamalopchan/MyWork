"""
Give the workplaces that predate colours one each.

Everything already in the database took the field's default, which would have
left every job the same blue — and a calendar coloured by workplace is worth
nothing if every workplace is the same colour. Each user's jobs are dealt
around the palette in the order they were created, which is the order
`Workplace.save` would have given them had it existed at the time.
"""

from django.db import migrations

from apps.timeclock.models import WORKPLACE_COLORS


def deal_colours(apps, schema_editor):
    Workplace = apps.get_model("timeclock", "Workplace")
    hues = [hue for hue, _ in WORKPLACE_COLORS]

    seen = {}
    updated = []
    for workplace in Workplace.objects.order_by("user_id", "created_at", "pk"):
        nth = seen.get(workplace.user_id, 0)
        workplace.color = hues[nth % len(hues)]
        seen[workplace.user_id] = nth + 1
        updated.append(workplace)

    Workplace.objects.bulk_update(updated, ["color"], batch_size=200)


def back_to_the_default(apps, schema_editor):
    Workplace = apps.get_model("timeclock", "Workplace")
    Workplace.objects.update(color=WORKPLACE_COLORS[0][0])


class Migration(migrations.Migration):

    dependencies = [("timeclock", "0007_workplace_color")]

    operations = [migrations.RunPython(deal_colours, back_to_the_default)]
