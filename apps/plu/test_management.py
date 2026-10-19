"""Catalogue edits/deletions use the same private operations on web and API."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase, Client
from django.urls import reverse
from rest_framework.authtoken.models import Token

from . import catalogue
from .models import Catalogue, PluItem


class CatalogueManagementTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("manager")
        cls.other = get_user_model().objects.create_user("other-manager")
        cls.token = Token.objects.create(user=cls.owner)
        cls.book = Catalogue.objects.create(owner=cls.owner, name="Work kit", headers=["Code", "Name", "Notes"], title_column="Name", code_column="Code", search_columns=["Code", "Name"])
        cls.item = PluItem.objects.create(catalogue=cls.book, title="Apron", description="Wash cold", code="001", fields={"Code": "001", "Name": "Apron", "Notes": "Wash cold"}, search_text="001\nApron")
        cls.foreign = Catalogue.objects.create(owner=cls.other, name="Private", headers=["Name"], title_column="Name", search_columns=["Name"])

    def setUp(self):
        self.client.force_login(self.owner)

    def api(self, method, pk=None, body=None):
        return getattr(self.client, method)(reverse("api:catalogue_detail", args=[pk or self.book.pk]), data=json.dumps(body) if body is not None else "", content_type="application/json", HTTP_AUTHORIZATION="Token " + self.token.key)

    def test_api_edit_reindexes_selected_columns_and_keeps_item_identity_and_details(self):
        response = self.api("patch", body={"name": "Tools", "search_columns": ["Notes", "Notes"]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["search_columns"], ["Notes"])
        self.assertEqual([i.pk for i in catalogue.search_items(self.owner, "cold", self.book.pk)], [self.item.pk])
        self.assertEqual(list(catalogue.search_items(self.owner, "Apron", self.book.pk)), [])
        self.item.refresh_from_db()
        self.assertEqual((self.item.code, self.item.title, self.item.fields["Name"]), ("001", "Apron", "Apron"))
        self.assertEqual(self.api("get").json()["count"], 1)

    def test_web_edit_uses_the_same_validation_and_returns_to_catalogues(self):
        url = reverse("plu:catalogue_edit", args=[self.book.pk])
        self.assertContains(self.client.get(url), "Work kit")
        response = self.client.post(url, {"name": "Renamed", "search_columns": ["Notes"]})
        self.assertRedirects(response, reverse("plu:list") + "?view=catalogues")
        self.book.refresh_from_db()
        self.assertEqual((self.book.name, self.book.search_columns), ("Renamed", ["Notes"]))
        self.assertEqual(self.client.post(url, {"name": "Bad", "search_columns": []}).status_code, 200)
        self.book.refresh_from_db()
        self.assertEqual(self.book.name, "Renamed")

    def test_invalid_changes_are_atomic(self):
        Catalogue.objects.create(owner=self.owner, name="Taken", title_column="Name")
        for body in ({"name": " "}, {"name": "x" * 101}, {"name": "taken"}, {"name": "Changed", "search_columns": []}, {"search_columns": ["Missing"]}, {"search_columns": "Name"}, []):
            with self.subTest(body=body):
                self.assertEqual(self.api("patch", body=body).status_code, 400)
                self.book.refresh_from_db(); self.item.refresh_from_db()
                self.assertEqual(self.book.name, "Work kit")
                self.assertEqual(self.item.search_text, "001\nApron")

    def test_other_users_cannot_read_edit_or_delete_catalogues(self):
        for method, body in (("get", None), ("patch", {"name": "Stolen"}), ("delete", None)):
            self.assertEqual(self.api(method, self.foreign.pk, body).status_code, 404)
        for route in ("catalogue_edit", "catalogue_delete"):
            url = reverse("plu:" + route, args=[self.foreign.pk])
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.client.post(url, {"name": "Stolen"}).status_code, 404)
        self.assertTrue(Catalogue.objects.filter(pk=self.foreign.pk, name="Private").exists())

    def test_delete_confirmation_get_is_safe_and_post_removes_only_selected_catalogue(self):
        url = reverse("plu:catalogue_delete", args=[self.book.pk])
        response = self.client.get(url)
        self.assertContains(response, "Delete catalogue?")
        self.assertTrue(PluItem.objects.filter(pk=self.item.pk).exists())
        response = self.client.post(url)
        self.assertRedirects(response, reverse("plu:list") + "?view=catalogues")
        self.assertFalse(Catalogue.objects.filter(pk=self.book.pk).exists())
        self.assertFalse(PluItem.objects.filter(pk=self.item.pk).exists())
        self.assertTrue(Catalogue.objects.filter(pk=self.foreign.pk).exists())
        self.assertNotIn("item_catalogue", self.client.session)

    def test_api_delete_removes_catalogue_and_items(self):
        self.assertEqual(self.api("delete").status_code, 204)
        self.assertFalse(PluItem.objects.filter(pk=self.item.pk).exists())
        self.assertEqual(self.api("get").status_code, 404)

    def test_management_requires_authentication_and_web_posts_require_csrf(self):
        anonymous = Client()
        self.assertIn(anonymous.get(reverse("api:catalogue_detail", args=[self.book.pk])).status_code, [401, 403])
        protected = Client(enforce_csrf_checks=True); protected.force_login(self.owner)
        self.assertEqual(protected.post(reverse("plu:catalogue_delete", args=[self.book.pk])).status_code, 403)
        self.assertTrue(Catalogue.objects.filter(pk=self.book.pk).exists())
