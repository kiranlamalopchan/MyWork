from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from django.urls import reverse


class ProfileSettingsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('profile-preview')

    def test_settings_require_sign_in(self):
        response = self.client.get(reverse('accounts:settings'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('next=/profile/settings/', response.url)

    def test_profile_keeps_all_personal_tools_and_links_to_settings(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('accounts:profile'))
        for url in ['accounts:edit', 'accounts:settings', 'accounts:photo', 'accounts:photo_remove']:
            self.assertContains(response, reverse(url))
        for element in ['id="friends"', 'id="statement"', 'id="activity"', 'statement-download']:
            self.assertContains(response, element)
        self.assertNotContains(response, 'id="theme-toggle"')

    def test_settings_keep_account_controls_without_admin_tools(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('accounts:settings'))
        self.assertContains(response, 'id="theme-toggle"')
        for url in ['accounts:password', 'accounts:delete', 'moderation:blocked', 'moderation:rules', 'privacy']:
            self.assertContains(response, reverse(url))
        self.assertNotContains(response, 'Festival banner')
        self.assertNotContains(response, 'Password reset links')

    def test_festival_tool_requires_staff_and_permission(self):
        permission = Permission.objects.get(codename='change_festivalthemesettings')
        self.user.user_permissions.add(permission)
        self.client.force_login(self.user)
        self.assertNotContains(self.client.get(reverse('accounts:settings')), 'Festival banner')
        self.user.is_staff = True
        self.user.save()
        response = self.client.get(reverse('accounts:settings'))
        self.assertContains(response, 'Festival banner')
        self.assertContains(response, 'Password reset links')

    def test_staff_without_festival_permission_only_sees_password_tools(self):
        self.user.is_staff = True
        self.user.save()
        self.client.force_login(self.user)
        response = self.client.get(reverse('accounts:settings'))
        self.assertNotContains(response, 'Festival banner')
        self.assertContains(response, 'Password reset links')
