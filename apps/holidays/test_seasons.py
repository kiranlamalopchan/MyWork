from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from mywork.seasons import calendar_for_year, home_festival_banner
from .models import FestivalThemeSettings


class FestivalCalendarTests(SimpleTestCase):
    def test_fixed_and_moving_festival_dates(self):
        days = calendar_for_year(2026)
        self.assertEqual(days['2026-12-25']['id'], 'christmas')
        self.assertEqual(days['2026-01-01']['id'], 'new-year')
        self.assertEqual(days['2026-10-16']['id'], 'dashain')
        self.assertEqual(days['2026-11-11']['id'], 'tihar')
        self.assertNotIn('2026-07-07', days)
        for year in (2026, 2027):
            self.assertIn('easter', {value['id'] for value in calendar_for_year(year).values()})
        self.assertNotEqual(
            [day[5:] for day, value in days.items() if value['id'] == 'tihar'],
            [day[5:] for day, value in calendar_for_year(2027).items() if value['id'] == 'tihar'],
        )


class SharedFestivalBannerTests(TestCase):
    def setUp(self):
        self.configuration, _ = FestivalThemeSettings.objects.update_or_create(pk=1, defaults={'theme': 'dashain', 'greeting': '', 'description': ''})
        self.user = get_user_model().objects.create_user('festival-reader')
        self.client.force_login(self.user)
        self.admin_url = reverse('admin:holidays_festivalthemesettings_change', args=[1])

    def test_shared_selection_ignores_personal_state(self):
        for zone in ('Pacific/Honolulu', 'Pacific/Auckland'):
            self.client.cookies['mywork-season'] = 'tihar'
            self.client.cookies['plu_tz'] = zone
            response = self.client.get('/')
            self.assertContains(response, 'Happy Dashain')
            self.assertContains(response, 'victory of good over evil')
            self.assertNotContains(response, 'id="season-select"')
        another = get_user_model().objects.create_user('another-reader')
        self.client.force_login(another)
        self.assertContains(self.client.get('/'), 'Happy Dashain')

    def test_banner_only_exists_on_home(self):
        for url in ('/profile/', '/plu/', '/holidays/'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, 'class="festival-hero"')
            self.assertNotContains(response, 'seasonal-calendar')
            self.assertNotContains(response, 'id="season-select"')

    def test_off_and_custom_copy(self):
        self.configuration.theme = 'off'
        self.configuration.save()
        self.assertNotContains(self.client.get('/'), 'class="festival-hero"')
        self.configuration.theme = 'tihar'
        self.configuration.greeting = 'Tihar wishes <script>alert(1)</script>'
        self.configuration.description = 'Tihar is the festival of lights.'
        self.configuration.save()
        response = self.client.get('/')
        self.assertContains(response, 'Tihar is the festival of lights.')
        self.assertContains(response, '&lt;script&gt;')
        self.assertNotContains(response, '<script>alert(1)</script>')

    def test_only_administrators_can_change_shared_choice(self):
        self.assertEqual(self.client.post(self.admin_url, {'theme': 'tihar'}).status_code, 302)
        self.configuration.refresh_from_db()
        self.assertEqual(self.configuration.theme, 'dashain')
        staff = get_user_model().objects.create_user('no-permission', is_staff=True)
        self.client.force_login(staff)
        self.assertEqual(self.client.post(self.admin_url, {'theme': 'tihar'}).status_code, 403)
        admin = get_user_model().objects.create_superuser('festival-admin', password='test-only')
        self.client.force_login(admin)
        self.assertContains(self.client.get(self.admin_url), 'Home festival banner')
        response = self.client.post(self.admin_url, {'theme': 'tihar', 'greeting': '', 'description': '', '_save': 'Save'})
        self.assertEqual(response.status_code, 302)
        self.configuration.refresh_from_db()
        self.assertEqual(self.configuration.theme, 'tihar')
        self.client.force_login(self.user)
        self.assertContains(self.client.get('/'), 'Happy Tihar')

    @override_settings(TIME_ZONE='Australia/Darwin')
    def test_automatic_uses_site_date_for_everyone(self):
        from django.utils import timezone
        self.configuration.theme = 'auto'
        self.configuration.save()
        instant = datetime(2026, 12, 26, 15, 0, tzinfo=dt_timezone.utc)
        with patch('mywork.seasons.timezone.now', return_value=instant):
            with timezone.override('Pacific/Honolulu'):
                self.assertEqual(home_festival_banner()['id'], 'new-year')
            with timezone.override('Pacific/Auckland'):
                self.assertEqual(home_festival_banner()['id'], 'new-year')

    def test_every_festival_has_its_own_banner_and_live_layer(self):
        from apps.holidays.festivals import FESTIVAL_INFO
        from django.contrib.staticfiles import finders
        scenes = set()
        for festival in FESTIVAL_INFO:
            self.configuration.theme = festival
            self.configuration.save()
            banner = home_festival_banner()
            with self.subTest(festival=festival):
                self.assertIsNotNone(finders.find(banner['art']))
                self.assertNotIn(banner['art'], scenes)
                scenes.add(banner['art'])
                response = self.client.get('/')
                self.assertContains(response, 'class="festival-live"')
                self.assertNotContains(response, 'data-festival-pause')
                self.assertContains(response, banner['greeting'])
