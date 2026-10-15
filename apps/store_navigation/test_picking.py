from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import Client
from django.urls import reverse

from .models import MapEdge, PickItem, PickOrder, Product, ProductLocation
from .services.picking import plan_pick_route
from .tests import StoreNavigationFixture


class WarehousePickingTests(StoreNavigationFixture):
    def setUp(self):
        self.client.force_login(self.user)
        self.location.zone, self.location.rack = "A", "04"
        self.location.shelf, self.location.bin = "2", "6"
        self.location.bin_code = "A-04-2-6"
        self.location.save()
        self.product.barcode = "0123456789012"
        self.product.save()
        self.order = PickOrder.objects.create(owner=self.user, store=self.store, reference="Customer 123")
        self.url = reverse("store_map:pick_order", kwargs={"pk": self.order.pk})

    def add(self, quantity=2, location=None):
        return self.client.post(self.url, {"action": "add", "location": (location or self.location).pk, "quantity": quantity})

    def confirm(self, item, **overrides):
        return self.client.post(self.url, {"action": "confirm", "item": item.pk,
                                          "product_code": self.product.barcode, "quantity": 1, **overrides})

    def test_create_and_render_private_order(self):
        response = self.client.post(reverse("store_map:orders"), {"store": self.store.pk, "reference": "Customer Jones"})
        self.assertEqual(response.status_code, 302)
        order = PickOrder.objects.get(reference="Customer Jones")
        self.assertEqual(order.owner, self.user)
        self.assertContains(self.client.get(response.url), "Customer Jones")

    def test_storage_fields_show_in_map_and_edit_page(self):
        self.assertEqual(self.location.storage_label, "Zone A → Rack 04 → Shelf 2 → Bin 6")
        self.assertContains(self.client.get(reverse("store_map:index")), "Rack 04")
        edit = reverse("store_map:edit_location", kwargs={"pk": self.location.pk})
        self.assertEqual(self.client.get(edit).status_code, 403)
        self.user.user_permissions.add(Permission.objects.get(codename="change_productlocation"))
        self.assertContains(self.client.get(edit), "Walking destination on map")
        response = self.client.post(edit, {"zone": "B", "rack": "9", "shelf": "1", "bin": "3", "bin_code": "B-9-1-3", "map_node": self.target.pk})
        self.assertEqual(response.status_code, 302)
        self.location.refresh_from_db()
        self.assertEqual(self.location.bin, "3")
        bad = self.client.post(edit, {"zone": "B", "rack": "9", "shelf": "1", "bin": "3", "bin_code": "B-9-1-3", "map_node": self.foreign.pk})
        self.assertEqual(bad.status_code, 200)
        self.location.refresh_from_db()
        self.assertEqual(self.location.map_node_id, self.target.pk)

    def test_add_merges_quantities_and_renders_scan_forms(self):
        self.add(2)
        self.add(3)
        self.assertEqual(self.order.items.get().quantity, 5)
        page = self.client.get(self.url)
        self.assertNotContains(page, "Scan bin code")
        self.assertNotContains(page, 'name="bin_code"')
        self.assertContains(page, "Scan product barcode")
        self.assertContains(page, "Collection route")
        self.assertContains(page, "A → Rack 04")
        self.assertContains(page, "data-camera-target")
        self.assertContains(page, "Walking guide to this stop")

    def test_partial_pick_then_finish_and_set_position(self):
        self.add(3)
        item = self.order.items.get()
        self.assertEqual(self.confirm(item, quantity=2).status_code, 302)
        self.order.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(item.remaining, 1)
        self.assertEqual(self.order.current_node, self.target)
        self.assertIsNone(self.order.completed_at)
        self.assertEqual(self.confirm(item, product_code=self.product.sku).status_code, 302)
        self.order.refresh_from_db()
        self.assertIsNotNone(self.order.completed_at)
        self.assertContains(self.client.get(self.url), "Ready for customer")
        self.confirm(item)
        item.refresh_from_db()
        self.assertEqual(item.picked_quantity, 3)
        self.add(1)
        item.refresh_from_db()
        self.assertEqual(item.quantity, 3)

    def test_wrong_codes_and_excess_quantity_do_not_record_pick(self):
        self.add(2)
        item = self.order.items.get()
        for values, error in [({"product_code": "WRONG"}, "Wrong product"),
                              ({"quantity": 3}, "Only 2 units"), ({"quantity": 0}, "greater than or equal to 1"),
                              ({"quantity": -1}, "greater than or equal to 1")]:
            with self.subTest(values=values):
                self.assertContains(self.confirm(item, **values), error)
                item.refresh_from_db()
                self.assertEqual(item.picked_quantity, 0)
        self.order.refresh_from_db()
        self.assertIsNone(self.order.current_node)

    def test_product_barcode_confirms_without_bin_code(self):
        self.add()
        self.location.bin_code = ""
        self.location.save()
        item = self.order.items.get()
        self.assertEqual(self.confirm(item).status_code, 302)
        item.refresh_from_db()
        self.assertEqual(item.picked_quantity, 1)

    def test_cross_warehouse_and_invalid_quantity_rejected(self):
        foreign_location = ProductLocation.objects.create(store=self.other, product=self.product, map_node=self.foreign, aisle_name="Other")
        for location, quantity in [(foreign_location, 1), (self.location, 0), (self.location, 10001)]:
            response = self.add(quantity, location)
            self.assertEqual(response.status_code, 200)
            self.assertFalse(self.order.items.exists())

    def test_orders_and_mutations_are_private(self):
        self.add()
        item = self.order.items.get()
        outsider = get_user_model().objects.create_user(username="outsider")
        self.client.force_login(outsider)
        self.assertNotContains(self.client.get(reverse("store_map:orders")), "Customer 123")
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.confirm(item).status_code, 404)
        self.assertEqual(self.client.post(self.url, {"action": "remove", "item": item.pk}).status_code, 404)
        item.refresh_from_db()
        self.assertEqual(item.picked_quantity, 0)
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_cannot_confirm_another_orders_item(self):
        another = PickOrder.objects.create(owner=self.user, store=self.store, reference="Other request")
        item = PickItem.objects.create(order=another, location=self.location)
        self.assertEqual(self.confirm(item).status_code, 404)

    def test_remove_only_unpicked_lines(self):
        self.add(2)
        item = self.order.items.get()
        self.confirm(item)
        self.client.post(self.url, {"action": "remove", "item": item.pk})
        self.assertTrue(PickItem.objects.filter(pk=item.pk).exists())
        second = Product.objects.create(sku="SECOND", title="Second")
        location = ProductLocation.objects.create(store=self.store, product=second, map_node=self.corridor, aisle_name="Rack 1")
        self.add(1, location)
        unpicked = self.order.items.get(location=location)
        self.client.post(self.url, {"action": "remove", "item": unpicked.pk})
        self.assertFalse(PickItem.objects.filter(pk=unpicked.pk).exists())

    def test_multi_stop_route_orders_and_recalculates_remaining(self):
        second = Product.objects.create(sku="SECOND", title="Second")
        near = ProductLocation.objects.create(store=self.store, product=second, map_node=self.corridor, aisle_name="Rack 1", bin_code="NEAR")
        self.add(1)
        self.add(2, near)
        items = list(self.order.items.select_related("location__map_node"))
        plan = plan_pick_route(self.order, items)
        self.assertEqual([stop["item"].location_id for stop in plan["stops"]], [near.pk, self.location.pk])
        self.assertEqual(plan["path_points"], [[0, 0], [3, 0], [3, 4]])
        near_item = self.order.items.get(location=near)
        self.confirm(near_item, bin_code="NEAR", product_code="SECOND", quantity=2)
        self.order.refresh_from_db()
        items = list(self.order.items.select_related("location__map_node"))
        updated = plan_pick_route(self.order, items)
        self.assertEqual(len(updated["stops"]), 1)
        self.assertEqual(updated["path_points"], [[3, 0], [3, 4]])

    def test_unreachable_item_is_visible_and_not_dropped(self):
        self.add(1)
        MapEdge.objects.filter(to_node=self.target).delete()
        response = self.client.get(self.url)
        self.assertContains(response, "no reachable walking route")
        self.assertContains(response, "Olive Oil 1L")
        self.assertEqual(len(response.context["plan"]["unreachable"]), 1)

    def test_csrf_and_http_methods(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(client.post(self.url, {"action": "add"}).status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 405)

    def test_search_by_product_barcode_and_bin_code(self):
        for code in [self.product.barcode, self.location.bin_code]:
            page = self.client.get(reverse("store_map:index"), {"q": code})
            self.assertContains(page, "Olive Oil 1L")
            self.assertEqual(page.context["result_count"], 1)

    def test_overview_filters_progress_totals_and_private_counts(self):
        from django.utils import timezone
        self.add(4)
        self.confirm(self.order.items.get())
        ready = PickOrder.objects.create(owner=self.user, store=self.store, reference="Ready collection", completed_at=timezone.now())
        PickItem.objects.create(order=ready, location=self.location, quantity=2, picked_quantity=2)
        outsider = get_user_model().objects.create_user(username="private-picker")
        PickOrder.objects.create(owner=outsider, store=self.store, reference="Private collection")
        url = reverse("store_map:orders")
        response = self.client.get(url)
        self.assertEqual(response.context["counts"], {"total": 2, "open": 1, "ready": 1})
        row = next(order for order in response.context["orders"] if order.pk == self.order.pk)
        self.assertEqual((row.requested_units, row.collected_units, row.progress_percent), (4, 1, 25))
        self.assertNotContains(response, "Private collection")
        opened = self.client.get(url, {"status": "open"})
        self.assertContains(opened, self.order.reference)
        self.assertNotContains(opened, "Ready collection")
        done = self.client.get(url, {"status": "ready", "q": "Ready"})
        self.assertContains(done, "Ready collection")
        self.assertNotContains(done, self.order.reference)
        self.assertTrue(all("q=Ready" in link["href"] for link in done.context["filters"]))

    def test_pagination_keeps_status_and_reference_search(self):
        PickOrder.objects.bulk_create([PickOrder(owner=self.user, store=self.store, reference=f"Warehouse collection {number}") for number in range(14)])
        response = self.client.get(reverse("store_map:orders"), {"status": "open", "q": "Warehouse", "page": 2})
        self.assertEqual(len(response.context["orders"]), 2)
        self.assertContains(response, "status=open")
        self.assertContains(response, "q=Warehouse")
        self.assertEqual(response.context["page_obj"].paginator.count, 14)

    def test_order_highlights_next_stop_and_groups_collected_items(self):
        self.add(3)
        response = self.client.get(self.url)
        self.assertContains(response, "NEXT COLLECTION STOP")
        self.assertEqual(response.context["next_stop"]["item"].location_id, self.location.pk)
        self.assertEqual(response.context["remaining_units"], 3)
        self.assertContains(response, "data-pick-open=")
        self.confirm(self.order.items.get(), quantity=3)
        done = self.client.get(self.url)
        self.assertIsNone(done.context["next_stop"])
        self.assertEqual(len(done.context["completed_items"]), 1)
        self.assertEqual(done.context["progress_percent"], 100)
        self.assertContains(done, "Ready to hand over.")
