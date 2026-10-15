from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.db import IntegrityError
from django.test import Client
from django.urls import reverse

from .models import Product, ProductLocation, Store
from .tests import StoreNavigationFixture


class AddWarehouseProductTests(StoreNavigationFixture):
    def setUp(self):
        self.client.force_login(self.user)
        self.user.user_permissions.add(*Permission.objects.filter(
            content_type__app_label="store_navigation", codename__in=["add_product", "add_productlocation"]))
        self.url = reverse("store_map:add_product")
        self.data = {"store": self.store.pk, "barcode": "0012345678905", "title": "Warehouse bolts",
                     "zone": "A", "rack": "04", "shelf": "2", "bin": "6", "map_node": self.target.pk}

    def test_create_product_location_search_and_picking(self):
        response = self.client.post(self.url, self.data)
        self.assertEqual(response.status_code, 302)
        product = Product.objects.get(barcode="0012345678905")
        self.assertEqual(product.title, "Warehouse bolts")
        self.assertTrue(product.sku.startswith("WH-"))
        location = ProductLocation.objects.get(product=product, store=self.store)
        self.assertEqual(location.storage_label, "Zone A → Rack 04 → Shelf 2 → Bin 6")
        self.assertEqual(location.bin_code, "")
        self.assertEqual(location.map_node, self.target)
        page = self.client.get(response.url)
        self.assertContains(page, "Warehouse bolts")
        self.assertIsNotNone(page.context["route"])
        from .models import PickOrder
        order = PickOrder.objects.create(owner=self.user, store=self.store, reference="Bolts request")
        pick_url = reverse("store_map:pick_order", kwargs={"pk": order.pk})
        self.client.post(pick_url, {"action": "add", "location": location.pk, "quantity": 2})
        item = order.items.get()
        picked = self.client.post(pick_url, {"action": "confirm", "item": item.pk,
                                           "product_code": product.barcode, "quantity": 2})
        self.assertEqual(picked.status_code, 302)
        order.refresh_from_db()
        self.assertIsNotNone(order.completed_at)

    def test_form_and_entry_points(self):
        page = self.client.get(self.url, {"store": self.store.pk})
        self.assertContains(page, "Scan product barcode")
        self.assertNotContains(page, 'name="bin_code"')
        self.assertNotContains(page, "Scan bin label")
        self.assertContains(page, "data-select-node")
        self.assertContains(page, "data-scan-next=\"#id_title\"")
        self.assertContains(self.client.get(reverse("store_map:index")), 'href="/store-navigation/products/add/?store=')
        self.assertContains(self.client.get(reverse("store_map:orders")), "Add new product")

    def test_duplicate_barcode_does_not_overwrite(self):
        self.product.barcode = self.data["barcode"]
        self.product.save()
        count = Product.objects.count()
        response = self.client.post(self.url, self.data)
        self.assertContains(response, "This barcode already belongs")
        self.assertContains(response, 'value="Warehouse bolts"')
        self.assertEqual(Product.objects.count(), count)
        self.product.refresh_from_db()
        self.assertEqual(self.product.title, "Olive Oil 1L")

    def test_missing_fields_and_foreign_node_leave_no_orphan_product(self):
        count = Product.objects.count()
        for updates in [{"title": ""}, {"barcode": ""}, {"map_node": self.foreign.pk}, {"map_node": ""}]:
            with self.subTest(updates=updates):
                response = self.client.post(self.url, {**self.data, **updates})
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
                self.assertEqual(Product.objects.count(), count)

    def test_duplicate_race_rolls_back_both_records(self):
        count = Product.objects.count()
        with patch("apps.store_navigation.picking_views.ProductLocation.objects.create", side_effect=IntegrityError("duplicate")):
            response = self.client.post(self.url, self.data)
        self.assertContains(response, "This barcode was just added")
        self.assertEqual(Product.objects.count(), count)

    def test_both_permissions_required_and_links_hidden(self):
        self.user.user_permissions.clear()
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url, self.data).status_code, 403)
        self.assertNotContains(self.client.get(reverse("store_map:index")), "/store-navigation/products/add/")
        self.user.user_permissions.add(Permission.objects.get(codename="add_product", content_type__app_label="store_navigation"))
        self.assertEqual(self.client.post(self.url, self.data).status_code, 403)
        self.assertFalse(Product.objects.filter(barcode=self.data["barcode"]).exists())
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_csrf_and_methods(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(client.post(self.url, self.data).status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 405)

    def test_empty_warehouse_and_unknown_warehouse(self):
        self.assertEqual(self.client.get(self.url, {"store": 999999}).status_code, 404)
        Store.objects.all().delete()
        self.assertContains(self.client.get(self.url), "No warehouses configured")

    def test_camera_lookup_opens_exact_product_and_preserves_start(self):
        self.product.barcode = "0000123400005"
        self.product.save()
        response = self.client.get(reverse("store_map:index"), {
            "store": self.store.pk, "q": self.product.barcode, "lookup": "barcode", "start_node_id": self.corridor.node_id,
        })
        self.assertContains(response, "Scan barcode")
        self.assertContains(response, "Barcode 0000123400005")
        self.assertEqual(response.context["location"], self.location)
        self.assertEqual(response.context["start"], self.corridor)
        self.assertIsNotNone(response.context["route"])
        self.assertContains(response, 'data-scan-fallback=')

    def test_camera_lookup_does_not_open_partial_or_foreign_matches(self):
        self.product.barcode = "0000123400005"
        self.product.save()
        for query, warehouse in [("00001234", self.store), ("Olive", self.store), (self.product.barcode, self.other)]:
            response = self.client.get(reverse("store_map:index"), {"store": warehouse.pk, "q": query, "lookup": "barcode", "sku": self.product.sku})
            self.assertEqual(response.context["result_count"], 0)
            self.assertIsNone(response.context["route"])
            self.assertNotIn("location", response.context)
