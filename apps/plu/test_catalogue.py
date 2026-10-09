import io
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from pypdf import PdfReader
from rest_framework.authtoken.models import Token

from . import catalogue
from .models import Catalogue, CatalogueUpload, PluItem


def csv_file(text, name="items.csv"):
    return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")


class PersonalCatalogueTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")
        self.token = Token.objects.create(user=self.alice)
        self.other_token = Token.objects.create(user=self.bob)
        self.client.force_login(self.alice)

    def api(self, method, name, data=None, user=None, pk=None):
        token = self.other_token if user == self.bob else self.token
        return getattr(self.client, method)(reverse("api:" + name, args=[pk] if pk else None),
            data=data or {}, HTTP_AUTHORIZATION=f"Token {token.key}",
            **({"content_type": "application/json"} if method == "post" and not any(hasattr(v, "read") for v in (data or {}).values()) else {}))

    def save(self, user=None, text="SKU,Name,Notes,Category\n001,Blue apron,Wash cold,Clothing\nA-9,Steel knife,Sharp,Tools\n", **mapping):
        user = user or self.alice
        upload = catalogue.stage_upload(user, csv_file(text))
        chosen = {"name": "Work kit", "title_column": "Name", "description_column": "Notes", "code_column": "SKU", "search_columns": ["SKU", "Name", "Category"]}
        chosen.update(mapping)
        return catalogue.import_upload(user, str(upload.pk), chosen)

    def test_any_user_can_preview_map_and_import(self):
        response = self.api("post", "item_preview", {"file": csv_file("Ref,Product,Details\n00A,Apron,Blue\n")})
        self.assertEqual(response.status_code, 200, response.content)
        preview = response.json()
        self.assertEqual(preview["headers"], ["Ref", "Product", "Details"])
        self.assertEqual(preview["sample"][0]["Ref"], "00A")
        self.assertFalse(PluItem.objects.exists())
        response = self.api("post", "item_import", {"upload_id": preview["upload_id"], "name": "Supplies", "title_column": "Product", "description_column": "Details", "code_column": "Ref", "search_columns": ["Product", "Ref"]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["total"], 1)
        item = catalogue.items_for(self.alice).get()
        self.assertEqual((item.title, item.description, item.code), ("Apron", "Blue", "00A"))
        self.assertEqual(item.fields["Details"], "Blue")
        detail = self.client.get(reverse("plu:detail", args=[item.pk]))
        self.assertContains(detail, "00A")
        self.assertContains(detail, "Copy Ref")
        self.assertContains(detail, "Blue")
        self.assertEqual(CatalogueUpload.objects.count(), 0)

    def test_only_selected_columns_are_searched_and_words_can_span_fields(self):
        self.save()
        self.assertEqual([i.title for i in catalogue.search_items(self.alice, "clothing blue")], ["Blue apron"])
        self.assertEqual(list(catalogue.search_items(self.alice, "wash")), [])
        self.assertEqual([i.code for i in catalogue.search_items(self.alice, "001")], ["001"])
        self.assertEqual(catalogue.items_for(self.alice).get(code="001").fields["Notes"], "Wash cold")

    def test_search_samples_counts_and_details_never_include_another_user(self):
        self.save()
        self.save(self.bob, text="SKU,Name,Notes,Category\n001,Secret item,Private,Hidden\n")
        PluItem.objects.create(plu_no=999, description="Legacy secret")
        idle = self.api("get", "item_search").json()
        self.assertEqual(idle["total"], 2)
        self.assertEqual({i["title"] for i in idle["samples"]}, {"Blue apron", "Steel knife"})
        self.assertEqual(self.api("get", "item_search", {"q": "secret"}).json()["count"], 0)
        foreign = catalogue.items_for(self.bob).get()
        self.assertEqual(self.api("get", "item_detail", pk=foreign.pk).status_code, 404)
        self.assertEqual(self.client.get(reverse("plu:detail", args=[foreign.pk])).status_code, 404)
        self.assertNotContains(self.client.get(reverse("plu:list"), {"q": "secret"}), "Secret item")
        self.assertEqual(self.api("get", "plu_item", pk=999).status_code, 404)

    def test_my_catalogues_view_lists_only_the_owners_named_uploads(self):
        first = self.save(name="Meat")
        self.save(name="Groceries")
        self.save(self.bob, name="Bobs private catalogue")
        response = self.client.get(reverse("plu:list"), {"view": "catalogues"})
        self.assertContains(response, "Meat")
        self.assertContains(response, "Groceries")
        self.assertNotContains(response, "Bobs private catalogue")
        self.assertContains(response, f'?catalogue={first["catalogue_id"]}')

    def test_staff_has_no_cross_account_search_access(self):
        self.alice.is_staff = True
        self.alice.is_superuser = True
        self.alice.save()
        self.save(self.bob)
        self.assertEqual(self.api("get", "item_search").json()["total"], 0)

    def test_preview_token_cannot_be_used_by_another_account(self):
        upload = catalogue.stage_upload(self.bob, csv_file("Name\nPrivate\n"))
        response = self.api("post", "item_import", {"upload_id": str(upload.pk), "title_column": "Name", "search_columns": ["Name"]})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(PluItem.objects.exists())
        self.assertTrue(CatalogueUpload.objects.filter(pk=upload.pk).exists())

    def test_bad_mapping_or_expired_preview_does_not_replace_existing_data(self):
        self.save()
        upload = catalogue.stage_upload(self.alice, csv_file("Name\nNew\n"))
        for mapping in ({"title_column": "Missing", "search_columns": ["Name"]}, {"title_column": "Name", "search_columns": []}, {"title_column": "Name", "search_columns": ["Missing"]}):
            with self.assertRaises(catalogue.CatalogueProblem):
                catalogue.import_upload(self.alice, str(upload.pk), mapping)
        CatalogueUpload.objects.filter(pk=upload.pk).update(created_at=timezone.now() - timedelta(hours=2))
        with self.assertRaises(catalogue.CatalogueProblem):
            catalogue.import_upload(self.alice, str(upload.pk), {"catalogue_id": catalogue.settings_for(self.alice).pk, "title_column": "Name", "search_columns": ["Name"]})
        self.assertEqual(catalogue.items_for(self.alice).count(), 2)

    def test_replace_changes_only_owner_and_preview_cannot_be_replayed(self):
        self.save()
        self.save(self.bob)
        upload = catalogue.stage_upload(self.alice, csv_file("Name\nNew\n"))
        mapping = {"catalogue_id": catalogue.settings_for(self.alice).pk, "title_column": "Name", "search_columns": ["Name"]}
        catalogue.import_upload(self.alice, str(upload.pk), mapping)
        self.assertEqual(catalogue.items_for(self.alice).get().title, "New")
        self.assertEqual(catalogue.items_for(self.bob).count(), 2)
        with self.assertRaises(catalogue.CatalogueProblem):
            catalogue.import_upload(self.alice, str(upload.pk), mapping)

    def test_invalid_csvs_are_refused_without_writing(self):
        for text in ("Name,Name\na,b\n", "Name,\na,b\n", "Name,Note\na,b,c\n", "Name\n", 'Name,Note\n"unfinished,b\n'):
            with self.subTest(text=text), self.assertRaises(catalogue.CatalogueProblem):
                catalogue.stage_upload(self.alice, csv_file(text))
        with self.assertRaises(catalogue.CatalogueProblem):
            catalogue.stage_upload(self.alice, csv_file("Name\na", "bad.xlsx"))
        self.assertFalse(PluItem.objects.exists())

    def test_duplicate_codes_are_refused_but_same_code_across_accounts_is_valid(self):
        with self.assertRaises(catalogue.CatalogueProblem):
            self.save(text="SKU,Name,Notes,Category\n1,One,X,Y\n1,Two,X,Y\n")
        self.save()
        self.save(self.bob)
        self.assertEqual(PluItem.objects.filter(code="001").count(), 2)

    def test_title_only_catalogue_and_blank_titles(self):
        upload = catalogue.stage_upload(self.alice, csv_file("Title,Other\nMy note,One\n,Two\n"))
        result = catalogue.import_upload(self.alice, str(upload.pk), {"title_column": "Title", "search_columns": ["Title"]})
        self.assertEqual((result["total"], result["skipped"]), (1, 1))
        item = catalogue.items_for(self.alice).get()
        self.assertEqual(item.code, "")
        self.assertContains(self.client.get(reverse("plu:detail", args=[item.pk])), "My note")

    def test_upload_preview_and_commit_work_on_website_without_javascript(self):
        response = self.client.post(reverse("plu:import"), {"csv_file": csv_file("Code,Title,Description\nA-1,Knife,Stainless\n")})
        self.assertContains(response, "Choose your headings")
        self.assertContains(response, "Stainless")
        token = response.context["preview"]["upload_id"]
        response = self.client.post(reverse("plu:import"), {"upload_id": token, "name": "Kit", "title_column": "Title", "description_column": "Description", "code_column": "Code", "search_columns": ["Title", "Code"]})
        self.assertRedirects(response, reverse("plu:list") + f"?catalogue={catalogue.settings_for(self.alice).pk}")
        response = self.client.get(reverse("plu:list"), {"q": "Knife"})
        self.assertContains(response, "Knife")
        self.assertContains(response, "A-1")

    def test_plu_photo_corrections_and_pdf_cannot_resolve_foreign_codes(self):
        self.save(text="plu_no,description\n7012,LAMB CHOPS\n", title_column="description", description_column="", code_column="plu_no", search_columns=["plu_no", "description"])
        self.save(self.bob, text="plu_no,description\n900,PRIVATE BEEF\n", title_column="description", description_column="", code_column="plu_no", search_columns=["plu_no", "description"])
        self.assertEqual(self.api("get", "plu_search", {"q": "BEEF"}).json()["count"], 0)
        self.assertEqual(self.api("get", "plu_item", pk=900).status_code, 404)
        session = self.client.session
        session["photo_search_lines"] = [{"line": "x", "plu_no": 900}]
        session.save()
        self.assertNotContains(self.client.get(reverse("plu:photo_search")), "PRIVATE BEEF")
        self.assertEqual(self.client.post(reverse("plu:photo_search_pick"), {"index": 0, "plu_no": 900}).status_code, 400)
        response = self.api("post", "plu_photo_pdf", {"rows": [{"plu_no": 900, "line": "foreign"}, {"plu_no": 7012, "line": "mine"}]})
        text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
        self.assertIn("LAMB CHOPS", text)
        self.assertNotIn("PRIVATE BEEF", text)
        self.assertNotIn("foreign", text)

    def test_legacy_claim_is_explicit_private_and_preserves_existing_catalogues(self):
        row = PluItem.objects.create(plu_no=7012, description="LAMB CHOPS")
        self.assertEqual(self.api("get", "plu_search").json()["total"], 0)
        call_command("claim_legacy_catalogue", "alice", stdout=io.StringIO())
        row.refresh_from_db()
        self.assertEqual(row.catalogue.owner, self.alice)
        self.assertEqual(row.code, "7012")
        self.assertEqual(self.api("get", "item_search", user=self.bob).json()["total"], 0)
        with self.assertRaises(CommandError):
            call_command("claim_legacy_catalogue", "alice", stdout=io.StringIO())

    def test_failed_database_write_rolls_back_replacement(self):
        self.save()
        upload = catalogue.stage_upload(self.alice, csv_file("Name\nNew\n"))
        with patch("apps.plu.catalogue.PluItem.objects.bulk_create", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                catalogue.import_upload(self.alice, str(upload.pk), {"catalogue_id": catalogue.settings_for(self.alice).pk, "title_column": "Name", "search_columns": ["Name"]})
        self.assertEqual(catalogue.items_for(self.alice).count(), 2)
        self.assertTrue(CatalogueUpload.objects.filter(pk=upload.pk).exists())

    def test_a_column_named_items_is_shown_as_data(self):
        upload = catalogue.stage_upload(self.alice, csv_file("title,items\nKit,Three knives\n"))
        catalogue.import_upload(self.alice, str(upload.pk), {"title_column": "title", "search_columns": ["title"]})
        item = catalogue.items_for(self.alice).get()
        self.assertContains(self.client.get(reverse("plu:detail", args=[item.pk])), "Three knives")

    def test_named_uploads_are_kept_separately_and_picker_counts_are_private(self):
        groceries = self.save(name="Groceries", text="SKU,Name,Notes,Category\n01,Apple,Fresh,Fruit\n")
        meat = self.save(name="Meat", text="SKU,Name,Notes,Category\n01,Beef mince,Lean,Beef\n")
        self.save(self.bob, name="Bob only")
        self.assertEqual(Catalogue.objects.filter(owner=self.alice).count(), 2)
        self.assertEqual(catalogue.items_for(self.alice).count(), 2)
        for saved, title in ((groceries, "Apple"), (meat, "Beef mince")):
            response = self.api("get", "item_search", {"catalogue": saved["catalogue_id"], "q": "01"})
            self.assertEqual(response.status_code, 200, response.content)
            data = response.json()
            self.assertEqual([r["title"] for r in data["results"]], [title])
            self.assertEqual(data["total"], 1)
            self.assertEqual([r["title"] for r in data["samples"]], [title])
            self.assertEqual({c["name"] for c in data["catalogues"]}, {"Groceries", "Meat"})
            self.assertEqual([c["count"] for c in data["catalogues"]], [1, 1])

    def test_same_codes_and_different_column_mappings_can_coexist(self):
        first = self.save(name="Groceries")
        upload = catalogue.stage_upload(self.alice, csv_file("Part,Title,Maker\n001,Saw,Acme\n"))
        second = catalogue.import_upload(self.alice, str(upload.pk), {"name": "Tools", "title_column": "Title", "code_column": "Part", "search_columns": ["Maker", "Part"]})
        self.assertEqual(catalogue.items_for(self.alice).filter(code="001").count(), 2)
        response = self.api("get", "item_search", {"catalogue": second["catalogue_id"], "q": "Acme"}).json()
        self.assertEqual(response["results"][0]["title"], "Saw")
        self.assertEqual(response["catalogue"]["title_column"], "Title")
        self.assertEqual(self.api("get", "item_search", {"catalogue": first["catalogue_id"], "q": "Acme"}).json()["count"], 0)

    def test_replacing_one_named_catalogue_preserves_other_uploads(self):
        groceries = self.save(name="Groceries")
        meat = self.save(name="Meat")
        upload = catalogue.stage_upload(self.alice, csv_file("Title\nChicken\n"))
        done = catalogue.import_upload(self.alice, str(upload.pk), {"catalogue_id": meat["catalogue_id"], "title_column": "Title", "search_columns": ["Title"]})
        self.assertEqual(done["catalogue_id"], meat["catalogue_id"])
        self.assertEqual(done["name"], "Meat")
        self.assertEqual(catalogue.items_for(self.alice, groceries["catalogue_id"]).count(), 2)
        self.assertEqual(catalogue.items_for(self.alice, meat["catalogue_id"]).get().title, "Chicken")

    def test_duplicate_names_never_silently_replace_data(self):
        saved = self.save(name="Groceries")
        for name in ("Groceries", "groceries", " Groceries "):
            with self.subTest(name=name), self.assertRaises(catalogue.CatalogueProblem):
                self.save(name=name)
        self.assertEqual(catalogue.items_for(self.alice, saved["catalogue_id"]).count(), 2)
        self.save(self.bob, name="Groceries")
        self.assertEqual(Catalogue.objects.filter(name="Groceries").count(), 2)

    def test_another_users_catalogue_cannot_be_selected_or_replaced(self):
        foreign = self.save(self.bob, name="Private")["catalogue_id"]
        for endpoint in ("item_search", "plu_search", "plu_item"):
            response = self.api("get", endpoint, {"catalogue": foreign}, pk=1 if endpoint == "plu_item" else None)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get(reverse("plu:list"), {"catalogue": foreign}).status_code, 404)
        upload = catalogue.stage_upload(self.alice, csv_file("Title\nNew\n"))
        response = self.api("post", "item_import", {"upload_id": str(upload.pk), "catalogue_id": foreign, "title_column": "Title", "search_columns": ["Title"]})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(catalogue.items_for(self.bob).count(), 2)
        self.assertFalse(catalogue.items_for(self.alice).exists())

    def test_web_selector_remembers_choice_and_pagination_keeps_it(self):
        self.save(name="Groceries")
        upload = catalogue.stage_upload(self.alice, csv_file("Title\n" + "\n".join(f"Meat {i}" for i in range(25))))
        saved = catalogue.import_upload(self.alice, str(upload.pk), {"name": "Meat", "title_column": "Title", "search_columns": ["Title"]})
        selected = saved["catalogue_id"]
        response = self.client.get(reverse("plu:list"), {"catalogue": selected, "q": "Meat"})
        self.assertContains(response, 'id="catalogue-select"')
        self.assertEqual(response.context["catalogue"].pk, selected)
        self.assertContains(response, f"catalogue={selected}&amp;q=Meat&amp;page=2")
        response = self.client.get(reverse("plu:search_api"), {"catalogue": selected, "q": "Meat", "page": 2})
        self.assertEqual(len(response.json()["results"]), 5)
        self.assertEqual(self.client.get(reverse("plu:list")).context["catalogue"].pk, selected)

    def test_filename_is_suggested_as_the_new_catalogue_name(self):
        upload = catalogue.stage_upload(self.alice, csv_file("Title\nApple\n", "Groceries.csv"))
        self.assertEqual(catalogue.preview_data(upload)["defaults"]["name"], "Groceries")

    def test_first_legacy_import_reports_its_new_catalogue_count(self):
        self.alice.is_staff = True
        self.alice.save()
        response = self.api("post", "plu_import", {"file": csv_file("plu_no,description\n1,Apple\n")})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(self.api("get", "plu_search").json()["total"], 1)

    def test_same_plu_in_two_catalogues_is_resolved_from_selected_source(self):
        first = self.save(name="Meat", text="plu_no,description\n7012,LAMB CHOPS\n", title_column="description", description_column="", code_column="plu_no", search_columns=["plu_no", "description"])
        second = self.save(name="Groceries", text="plu_no,description\n7012,RED APPLE\n", title_column="description", description_column="", code_column="plu_no", search_columns=["plu_no", "description"])
        for saved, title in ((first, "LAMB CHOPS"), (second, "RED APPLE")):
            selected = saved["catalogue_id"]
            self.assertEqual(self.api("get", "plu_item", {"catalogue": selected}, pk=7012).json()["description"], title)
            response = self.api("post", "plu_photo_pdf", {"catalogue": selected, "rows": [{"plu_no": 7012, "line": "x"}]})
            text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
            self.assertIn(title, text)
        session = self.client.session
        session["photo_search_catalogue"] = first["catalogue_id"]
        session["photo_search_lines"] = [{"plu_no": 7012, "line": "lamb"}]
        session.save()
        response = self.client.get(reverse("plu:photo_search"), {"catalogue": second["catalogue_id"]})
        self.assertNotContains(response, "LAMB CHOPS")
        self.assertEqual(self.client.post(reverse("plu:photo_search_pick"), {"catalogue": second["catalogue_id"], "index": 0, "plu_no": 7012}).status_code, 400)
