"""
Accounts made by Google/Apple sign-in before usernames were taken from the
person's name carry a random one (user_ and 20 hex digits). Give each the
plain username a new account would get now: their name, else the start of
their email, with _2, _3… added only if taken. Social-only accounts sign in through
the provider, so nobody's sign-in changes; anyone already renamed by hand is
left alone, as only the exact random pattern is touched.
"""
import re
import unicodedata

from django.db import migrations

RANDOM = r'^user_[0-9a-f]{20}$'


def plain(text):
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9._]', '', text).strip('._')[:24]


def rename(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    Profile = apps.get_model('accounts', 'Profile')
    names = dict(Profile.objects.values_list('user_id', 'display_name'))
    taken = {u.lower() for u in User.objects.values_list('username', flat=True)}
    for user in User.objects.filter(username__regex=RANDOM).order_by('pk'):
        base = plain(names.get(user.pk, '')) or plain((user.email or '').split('@')[0]) or 'user'
        if len(base) < 3:
            base = f'{base}user'
        candidate, n = base, 2
        while candidate in taken:
            candidate, n = f'{base}_{n}', n + 1
        taken.discard(user.username.lower())
        taken.add(candidate)
        user.username = candidate
        user.save(update_fields=['username'])


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0007_social_sign_in'),
    ]

    operations = [
        migrations.RunPython(rename, migrations.RunPython.noop),
    ]
