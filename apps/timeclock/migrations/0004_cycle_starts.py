"""
Every cycle gets a start you can choose.

The week was Monday-to-Sunday and unchangeable, the fortnight had an anchor
and the month was always the calendar month. Now each of the three has its own
start, at both scopes — on a Workplace for the cap it measures, and on
TimePreference for the combined figures and the calendar grid. Existing rows
take the new defaults: a Sunday-to-Saturday week, and a month that opens on
the 1st, which is the shape most rosters and pay slips are written in.
"""


import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('timeclock', '0003_workplace_hours_limit'),
    ]

    operations = [
        migrations.AddField(
            model_name='timepreference',
            name='month_starts_on',
            field=models.PositiveSmallIntegerField(default=1, validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(28)]),
        ),
        migrations.AddField(
            model_name='timepreference',
            name='week_starts_on',
            field=models.IntegerField(choices=[(0, 'Monday'), (1, 'Tuesday'), (2, 'Wednesday'), (3, 'Thursday'), (4, 'Friday'), (5, 'Saturday'), (6, 'Sunday')], default=6),
        ),
        migrations.AddField(
            model_name='workplace',
            name='month_starts_on',
            field=models.PositiveSmallIntegerField(default=1, validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(28)]),
        ),
        migrations.AddField(
            model_name='workplace',
            name='week_starts_on',
            field=models.IntegerField(choices=[(0, 'Monday'), (1, 'Tuesday'), (2, 'Wednesday'), (3, 'Thursday'), (4, 'Friday'), (5, 'Saturday'), (6, 'Sunday')], default=6),
        ),
        migrations.AlterField(
            model_name='workplace',
            name='limit_period',
            field=models.CharField(choices=[('WEEK', 'Per week'), ('FORTNIGHT', 'Per fortnight'), ('MONTH', 'Per month')], default='FORTNIGHT', max_length=9),
        ),
    ]
