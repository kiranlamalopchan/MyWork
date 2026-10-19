"""Search labels and organisation must preserve the website's URL contract."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import resolve, reverse

from .models import Catalogue, PluItem


class SearchNavigationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username="search-navigation")
        cls.catalogue = Catalogue.objects.create(owner=cls.user, name="Work products", headers=["PLU", "Name"],
            title_column="Name", code_column="PLU", search_columns=["Name", "PLU"])
        cls.item = PluItem.objects.create(catalogue=cls.catalogue, title="Bolts", description="Bolts", code="001", plu_no=1,
            fields={"PLU": "001", "Name": "Bolts"}, search_text="001 bolts")

    def setUp(self):
        self.client.force_login(self.user)

    def test_existing_plu_url_contract_is_unchanged(self):
        urls = {
            "list": "/plu/", "search_api": "/plu/api/search/", "detail": f"/plu/item/{self.item.pk}/",
            "import": "/plu/import/", "photo_search": "/plu/photo-search/", "photo_search_pdf": "/plu/photo-search/pdf/",
            "photo_search_pick": "/plu/photo-search/pick/", "photo_search_clear": "/plu/photo-search/clear/",
        }
        for name, path in urls.items():
            with self.subTest(route=name):
                args = [self.item.pk] if name == "detail" else []
                self.assertEqual(reverse("plu:" + name, args=args), path)
                self.assertEqual(resolve(path).view_name, "plu:" + name)

    def test_workspace_tabs_have_consistent_order_and_one_active_destination(self):
        pages = [
            ("/plu/", "Search"), ("/plu/?view=catalogues", "Catalogues"),
            ("/plu/import/", "Catalogues"), ("/plu/photo-search/", "Search"),
            (f"/plu/item/{self.item.pk}/", "Search"),
            (f"/plu/catalogues/{self.catalogue.pk}/edit/", "Catalogues"),
            (f"/plu/catalogues/{self.catalogue.pk}/delete/", "Catalogues"),
        ]
        for path, active in pages:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                links = response.context["section_links"]
                self.assertEqual([link["label"] for link in links], ["Search", "Catalogues"])
                self.assertEqual([link["label"] for link in links if link["active"]], [active])
                for link in links:
                    resolve(link["href"].split("?")[0])

    def test_actions_are_buttons_outside_destination_tabs_and_preserve_catalogue(self):
        page = self.client.get("/plu/", {"catalogue": self.catalogue.pk})
        actions = page.context["search_actions"]
        self.assertEqual([action["label"] for action in actions], ["Photo search"])
        self.assertNotContains(page, 'href="/plu/import/"')
        self.assertEqual(actions[0]["href"], f"/plu/photo-search/?catalogue={self.catalogue.pk}")
        self.assertEqual(page.context["section_links"][0]["href"], f"/plu/?catalogue={self.catalogue.pk}")
        self.assertContains(page, '<h1 class="page-title">Search</h1>', html=True)
        self.assertContains(page, 'aria-label="Catalogue actions"')
        catalogues = self.client.get("/plu/", {"view": "catalogues"})
        self.assertContains(catalogues, 'href="/plu/import/"', count=1)
        self.assertNotContains(catalogues, "Photo search")
        self.assertNotContains(catalogues, "Search catalogue")
        uploaded = self.client.get("/plu/import/")
        self.assertNotIn("Upload catalogue", [action["label"] for action in uploaded.context["search_actions"]])

    def test_general_catalogues_do_not_offer_incompatible_photo_matching(self):
        self.catalogue.code_column = "SKU"
        self.catalogue.save(update_fields=["code_column"])
        page = self.client.get("/plu/", {"catalogue": self.catalogue.pk})
        self.assertEqual(page.context["search_actions"], [])

    def test_search_label_and_primary_links_work_across_the_website(self):
        for path in ["/", "/plu/", "/profile/", "/timesheet/", "/notifications/"]:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                links = response.context["primary_nav"]
                self.assertEqual([link["label"] for link in links], ["Home", "Search", "Work", "Alerts", "Profile"])
                self.assertEqual(links[1]["href"], "/plu/")
                for link in links:
                    resolve(link["href"])

    def test_warehouse_feature_is_removed(self):
        home = self.client.get("/")
        self.assertNotContains(home, "Warehouse Navigation")
        self.assertNotContains(home, "/store-navigation/")
        for path in (
            "/store-navigation/", "/store-navigation/picking/",
            "/store-navigation/products/add/", "/store-navigation/face/",
            "/api/stores/1/products/search/", "/api/stores/1/navigate/",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
