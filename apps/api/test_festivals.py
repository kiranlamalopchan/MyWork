import io
import tempfile
from datetime import datetime, timezone
from unittest.mock import patch

from PIL import Image
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.holidays.models import FestivalThemeSettings
from mywork.seasons import home_festival_banner


class FestivalAdminTests(TestCase):
    url = '/api/v1/admin/festival-banner/'

    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.config, _ = FestivalThemeSettings.objects.update_or_create(pk=1, defaults={
            'theme': 'dashain', 'greeting': '', 'description': '', 'banner': ''})
        users = get_user_model()
        self.reader = users.objects.create_user('festival-reader-api')
        self.staff = users.objects.create_user('festival-staff-api', is_staff=True)
        self.manager = users.objects.create_user('festival-manager-api', is_staff=True)
        self.nonstaff = users.objects.create_user('festival-nonstaff-api')
        self.superuser = users.objects.create_superuser('festival-super-api', password='test-only')
        permission = Permission.objects.get(codename='change_festivalthemesettings')
        self.manager.user_permissions.add(permission)
        self.nonstaff.user_permissions.add(permission)
        self.client = APIClient()
        self.client.force_authenticate(self.manager)

    @staticmethod
    def image():
        output = io.BytesIO()
        Image.new('RGB', (300, 100), 'green').save(output, format='PNG')
        return SimpleUploadedFile('banner.png', output.getvalue(), content_type='image/png')

    def test_readers_and_unprivileged_staff_cannot_read_or_write(self):
        for user in (None, self.reader, self.staff, self.nonstaff):
            self.client.force_authenticate(user)
            with self.subTest(user=user):
                self.assertIn(self.client.get(self.url).status_code, (401, 403))
                for fmt in ('json', 'multipart'):
                    response = self.client.patch(self.url, {'theme': 'off'}, format=fmt)
                    self.assertIn(response.status_code, (401, 403))
                self.config.refresh_from_db()
                self.assertEqual(self.config.theme, 'dashain')

    def test_capability_matches_server_permission(self):
        for user, allowed in ((self.reader, False), (self.staff, False), (self.nonstaff, False), (self.manager, True), (self.superuser, True)):
            self.client.force_authenticate(user)
            with self.subTest(user=user):
                self.assertEqual(self.client.get('/api/v1/me/').data['can_manage_festival'], allowed)
                self.assertEqual(self.client.get(self.url).status_code, 200 if allowed else 403)

    def test_cannot_grant_own_permission_through_profile(self):
        self.client.force_authenticate(self.reader)
        self.client.patch('/api/v1/me/', {'is_staff': True, 'is_superuser': True, 'can_manage_festival': True}, format='json')
        self.reader.refresh_from_db()
        self.assertFalse(self.reader.is_staff)
        self.assertFalse(self.reader.is_superuser)
        self.assertEqual(self.client.patch(self.url, {'theme': 'off'}, format='json').status_code, 403)

    def test_preview_get_does_not_change_saved_configuration(self):
        before = self.config.updated_at
        result = self.client.get(self.url)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        choices = {choice['value']: choice['preview'] for choice in result.data['choices']}
        self.assertEqual(choices['tihar']['id'], 'tihar')
        self.assertIsNone(choices['off'])
        self.config.refresh_from_db()
        self.assertEqual(self.config.theme, 'dashain')
        self.assertEqual(self.config.updated_at, before)

    def test_reading_or_invalid_saving_does_not_create_singleton(self):
        FestivalThemeSettings.objects.all().delete()
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertFalse(FestivalThemeSettings.objects.exists())
        self.assertEqual(self.client.patch(self.url, {'theme': 'invalid'}, format='json').status_code, 400)
        self.assertFalse(FestivalThemeSettings.objects.exists())
        self.assertEqual(self.client.patch(self.url, {'theme': 'tihar'}, format='json').status_code, 200)
        self.assertEqual(FestivalThemeSettings.objects.get(pk=1).theme, 'tihar')

    def test_save_is_shared_with_every_users_web_and_mobile_home(self):
        result = self.client.patch(self.url, {'theme': 'tihar', 'greeting': 'Light and joy', 'description': 'Warm wishes for everyone.'}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['preview']['greeting'], 'Light and joy')
        self.assertEqual(home_festival_banner()['id'], 'tihar')
        self.client.force_authenticate(self.reader)
        banner = self.client.get('/api/v1/home/').data['festival']
        self.assertEqual(banner['greeting'], 'Light and joy')
        self.assertEqual(banner['description'], 'Warm wishes for everyone.')
        self.client.force_login(self.reader)
        self.assertContains(self.client.get('/'), 'Light and joy')

    def test_off_and_automatic_apply_to_home(self):
        self.assertEqual(self.client.patch(self.url, {'theme': 'off'}, format='json').status_code, 200)
        self.assertIsNone(self.client.get('/api/v1/home/').data['festival'])
        with patch('mywork.seasons.timezone.now', return_value=datetime(2026, 12, 10, tzinfo=timezone.utc)):
            result = self.client.patch(self.url, {'theme': 'auto', 'greeting': 'Ignored override'}, format='json')
            self.assertEqual(result.data['preview']['id'], 'christmas')
            self.assertEqual(self.client.get('/api/v1/home/').data['festival']['greeting'], 'Merry Christmas')

    def test_invalid_input_never_partially_changes_settings(self):
        for payload in ({'theme': 'unknown'}, {'theme': 'tihar', 'greeting': 'a' * 121}, {'description': 'a' * 601}, ['off']):
            with self.subTest(payload=str(payload)[:40]):
                result = self.client.patch(self.url, payload, format='json')
                self.assertEqual(result.status_code, 400, result.data)
                self.config.refresh_from_db()
                self.assertEqual(self.config.theme, 'dashain')
                self.assertEqual(self.config.greeting, '')

    def test_upload_preserve_clear_and_restore_standard_artwork(self):
        result = self.client.patch(self.url, {'theme': 'tihar', 'banner': self.image(), 'greeting': 'Custom'}, format='multipart')
        self.assertEqual(result.status_code, 200, result.data)
        uploaded = result.data['banner_url']
        self.assertIn('/media/festivals/', uploaded)
        self.assertEqual(result.data['preview']['image_url'], uploaded)
        result = self.client.patch(self.url, {'description': 'Edited without replacing image'}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['banner_url'], uploaded)
        result = self.client.patch(self.url, {'banner': self.image(), 'greeting': '', 'description': ''}, format='multipart')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['preview']['greeting'], 'Happy Tihar')
        result = self.client.patch(self.url, {'remove_banner': True}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertIsNone(result.data['banner_url'])
        self.assertIn('/static/img/festivals/', result.data['preview']['image_url'])

    def test_invalid_conflicting_and_large_images_are_rejected(self):
        bad = SimpleUploadedFile('fake.png', b'not an image', content_type='image/png')
        huge = SimpleUploadedFile('large.png', b'0' * (8 * 1024 * 1024 + 1), content_type='image/png')
        for data in ({'banner': bad}, {'banner': huge}, {'banner': self.image(), 'remove_banner': 'true'}):
            result = self.client.patch(self.url, {'theme': 'tihar', **data}, format='multipart')
            self.assertEqual(result.status_code, 400, result.data)
            self.config.refresh_from_db()
            self.assertEqual(self.config.theme, 'dashain')
            self.assertFalse(self.config.banner)

    def test_permission_revocation_blocks_subsequent_save(self):
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.manager.is_staff = False
        self.manager.save(update_fields=['is_staff'])
        self.assertEqual(self.client.patch(self.url, {'theme': 'off'}, format='json').status_code, 403)
