from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import Notice, Visibility


class NoticeActionMenuTests(TestCase):
    def setUp(self):
        self.author = get_user_model().objects.create_user('notice-menu-author', is_staff=True)
        self.reader = get_user_model().objects.create_user('notice-menu-reader')
        self.notice = Notice.objects.create(author=self.author, body='Team notice')
        self.url = reverse('notices:detail', args=[self.notice.pk])

    def test_author_management_is_in_menu_while_conversation_actions_stay_outside(self):
        self.client.force_login(self.author)
        html = self.client.get(self.url).content.decode()
        menu = html.split('<details class="notice-menu"', 1)[1].split('</details>', 1)[0]
        for label in ('Edit', 'Delete', 'Pin'):
            self.assertIn('role="menuitem"', menu)
            self.assertIn(label, menu)
        actions = html.split('<div class="acts">', 1)[1].split('<div class="thread">', 1)[0]
        self.assertIn('Comment', actions)
        self.assertNotIn('data-edit', actions)
        self.assertNotIn(reverse('notices:delete', args=[self.notice.pk]), actions)
        self.assertNotIn(reverse('notices:pin', args=[self.notice.pk]), actions)
        self.assertIn('name="csrfmiddlewaretoken"', menu)
        self.assertIn('Remove this notice?', menu)

    def test_menu_permissions_and_unpin_follow_existing_rules(self):
        self.client.force_login(self.reader)
        self.assertNotContains(self.client.get(self.url), 'class="notice-menu"')
        self.reader.is_staff = True
        self.reader.save(update_fields=['is_staff'])
        html = self.client.get(self.url).content.decode()
        menu = html.split('<details class="notice-menu"', 1)[1].split('</details>', 1)[0]
        self.assertIn('Pin', menu)
        self.assertNotIn('data-edit', menu)
        self.assertNotIn('Delete', menu)
        self.notice.pin()
        self.assertContains(self.client.get(self.url), 'Unpin')
        self.notice.unpin()
        self.notice.visibility = Visibility.PRIVATE
        self.notice.save()
        self.author.is_staff = False
        self.author.save(update_fields=['is_staff'])
        self.client.force_login(self.author)
        html = self.client.get(self.url).content.decode()
        menu = html.split('<details class="notice-menu"', 1)[1].split('</details>', 1)[0]
        self.assertIn('Edit', menu)
        self.assertIn('Delete', menu)
        self.assertNotIn('>Pin', menu)
