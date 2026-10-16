import uuid
from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.contrib.admin.sites import AdminSite
from rest_framework.test import APIClient
from apps.timeclock.models import Shift, Workplace
from apps.holidays.models import FestivalThemeSettings
from .models import ShiftReceipt, SupportReport, MobileRelease
from .admin import MobileReleaseAdmin


class MobileReleaseTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('mobile-release-test')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.workplace = Workplace.objects.create(user=self.user, name='Test shop')
        self.payload = {'client_id': str(uuid.uuid4()), 'workplace': self.workplace.pk,
            'clock_in': '2026-01-13T09:00', 'clock_out': '2026-01-13T17:00', 'note': '', 'breaks': []}

    def test_shift_retry_returns_the_same_shift(self):
        first = self.client.post('/api/v1/timesheet/shifts/', self.payload, format='json')
        second = self.client.post('/api/v1/timesheet/shifts/', self.payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(Shift.objects.filter(user=self.user).count(), 1)

    def test_changed_payload_with_same_submission_id_requires_review(self):
        self.client.post('/api/v1/timesheet/shifts/', self.payload, format='json')
        response = self.client.post('/api/v1/timesheet/shifts/', {**self.payload, 'note': 'Changed'}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Shift.objects.filter(user=self.user).count(), 1)

    def test_invalid_shift_does_not_consume_submission_id(self):
        bad = self.client.post('/api/v1/timesheet/shifts/', {**self.payload, 'clock_out': '2026-01-13T08:00'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertFalse(ShiftReceipt.objects.exists())
        self.assertEqual(self.client.post('/api/v1/timesheet/shifts/', self.payload, format='json').status_code, 201)

    def test_report_is_owned_by_the_authenticated_user(self):
        response = self.client.post('/api/v1/support/reports/', {'description':'The scanner selected a different cut', 'app_version':'1.3.0', 'platform':'android'})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(SupportReport.objects.get().user, self.user)
        self.assertEqual(self.client.post('/api/v1/support/reports/', {'description':''}).status_code, 400)

    def test_festival_selection_and_off_are_shared_with_mobile(self):
        FestivalThemeSettings.objects.update_or_create(pk=1, defaults={'theme':'dashain'})
        response = self.client.get('/api/v1/home/')
        self.assertEqual(response.data['festival']['motion'], 'kites')
        self.assertTrue(response.data['festival']['image_url'].startswith('http'))
        FestivalThemeSettings.objects.filter(pk=1).update(theme='off')
        self.assertIsNone(self.client.get('/api/v1/home/').data['festival'])

    def test_admin_announcement_uses_the_mobile_store_destination(self):
        release = MobileRelease.objects.create(version='1.3.0')
        admin = MobileReleaseAdmin(MobileRelease, AdminSite())
        with patch('apps.api.admin.notify_many') as send, patch.object(admin, 'message_user'):
            admin.announce(SimpleNamespace(user=self.user), MobileRelease.objects.filter(pk=release.pk))
        self.assertEqual(send.call_args.kwargs['url'], '/app-update/')
        self.assertEqual(send.call_args.kwargs['dedupe_key'], 'mobile-update:1.3.0')
        release.refresh_from_db()
        self.assertIsNotNone(release.announced_at)
