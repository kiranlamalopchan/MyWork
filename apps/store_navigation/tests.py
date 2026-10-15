import math

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from .models import MapEdge, MapNode, Product, ProductLocation, Store
from .services.pathfinding import InvalidMap, NodeNotFound, PathNotFound, find_shortest_path


class StoreNavigationFixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.store = Store.objects.create(name="Central", slug="central", floorplan_svg="floorplans/central.svg")
        cls.other = Store.objects.create(name="Other", slug="other")
        cls.start = cls.node("ENTRANCE_MAIN", 0, 0, MapNode.NodeType.ENTRANCE)
        cls.corridor = cls.node("CORRIDOR", 3, 0)
        cls.target = cls.node("SHELF", 3, 4, MapNode.NodeType.SHELF)
        cls.foreign = MapNode.objects.create(store=cls.other, node_id="FOREIGN", node_type="SHELF", pos_x=1, pos_y=1)
        cls.product = Product.objects.create(sku="OIL_1L", title="Olive Oil 1L")
        cls.location = ProductLocation.objects.create(product=cls.product, store=cls.store, aisle_name="Aisle 5", bay_number=12, map_node=cls.target)
        cls.user = get_user_model().objects.create_user(username="navigator")
        MapEdge.objects.create(store=cls.store, from_node=cls.start, to_node=cls.corridor)
        MapEdge.objects.create(store=cls.store, from_node=cls.corridor, to_node=cls.target)

    @classmethod
    def node(cls, name, x, y, kind=MapNode.NodeType.CORRIDOR):
        return MapNode.objects.create(store=cls.store, node_id=name, node_type=kind, pos_x=x, pos_y=y)


class NavigationTests(StoreNavigationFixture):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/stores/{self.store.pk}/"

    def route(self, **params):
        return self.client.get(self.base + "navigate/", params)

    def test_euclidean_route_and_query_count(self):
        with self.assertNumQueries(2):
            result = find_shortest_path(self.store.pk, self.start.node_id, self.target.node_id)
        self.assertEqual(result, {"start_node": [0, 0], "target_node": [3, 4], "total_distance": 7.0, "path_points": [[0, 0], [3, 0], [3, 4]]})
        self.assertEqual(MapEdge.objects.get(from_node=self.start).weight, 3)

    def test_null_weight_from_bulk_insert_uses_distance(self):
        MapEdge.objects.bulk_create([MapEdge(store=self.store, from_node=self.start, to_node=self.target)])
        self.assertEqual(find_shortest_path(self.store.pk, "ENTRANCE_MAIN", "SHELF")["total_distance"], 5)

    def test_cheap_custom_weights_keep_heuristic_admissible(self):
        detour = self.node("FAR", 100, 100)
        MapEdge.objects.create(store=self.store, from_node=self.start, to_node=self.target, weight=3)
        MapEdge.objects.create(store=self.store, from_node=self.start, to_node=detour, weight=0)
        MapEdge.objects.create(store=self.store, from_node=detour, to_node=self.target, weight=1)
        result = find_shortest_path(self.store.pk, "ENTRANCE_MAIN", "SHELF")
        self.assertEqual(result["total_distance"], 1)
        self.assertEqual(result["path_points"], [[0, 0], [100, 100], [3, 4]])

    def test_direction_and_missing_nodes(self):
        with self.assertRaises(PathNotFound):
            find_shortest_path(self.store.pk, "SHELF", "ENTRANCE_MAIN")
        with self.assertRaises(NodeNotFound):
            find_shortest_path(self.store.pk, "FOREIGN", "SHELF")

    def test_same_start_and_target(self):
        result = find_shortest_path(self.store.pk, "SHELF", "SHELF")
        self.assertEqual(result["path_points"], [[3, 4]])
        self.assertEqual(result["total_distance"], 0)

    def test_unreachable_cycle_terminates(self):
        self.node("ISOLATED", 10, 10)
        MapEdge.objects.create(store=self.store, from_node=self.corridor, to_node=self.start, weight=0)
        with self.assertRaises(PathNotFound):
            find_shortest_path(self.store.pk, "ENTRANCE_MAIN", "ISOLATED")

    def test_model_rejects_cross_store_relations(self):
        with self.assertRaises(ValidationError):
            MapEdge.objects.create(store=self.store, from_node=self.start, to_node=self.foreign)
        self.location.map_node = self.foreign
        with self.assertRaises(ValidationError):
            self.location.save()

    def test_invalid_weights(self):
        for weight in (-1, math.inf, math.nan):
            with self.subTest(weight=weight), self.assertRaises(ValidationError):
                MapEdge.objects.create(store=self.store, from_node=self.start, to_node=self.target, weight=weight)

    def test_service_rejects_bulk_inserted_cross_store_edge(self):
        MapEdge.objects.bulk_create([MapEdge(store=self.store, from_node=self.start, to_node=self.foreign)])
        with self.assertRaises(InvalidMap):
            find_shortest_path(self.store.pk, "ENTRANCE_MAIN", "SHELF")
        self.assertEqual(self.route(sku=self.product.sku).status_code, 400)

    def test_navigation_response(self):
        response = self.route(sku=self.product.sku)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["product"], {"sku": "OIL_1L", "title": "Olive Oil 1L", "aisle": "Aisle 5", "bay": 12})
        self.assertEqual(response.data["navigation_path"], [[0, 0], [3, 0], [3, 4]])
        self.assertEqual(response.data["floorplan_svg"], "/media/floorplans/central.svg")
        self.assertEqual(response.data["viewbox"], {"width": 1000, "height": 1000})
        self.assertEqual(response.data["start"], {"node_id": "ENTRANCE_MAIN", "coords": [0, 0]})
        self.assertEqual(response.data["target"], {"node_id": "SHELF", "coords": [3, 4]})

    def test_explicit_start(self):
        response = self.route(sku=self.product.sku, start_node_id="CORRIDOR")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_distance"], 4)

    def test_default_entrance_selection(self):
        self.node("AAA", 1, 1, MapNode.NodeType.ENTRANCE)
        self.assertEqual(self.route(sku=self.product.sku).data["start"]["node_id"], "ENTRANCE_MAIN")
        self.start.delete()
        MapEdge.objects.create(store=self.store, from_node=MapNode.objects.get(node_id="AAA"), to_node=self.target)
        self.assertEqual(self.route(sku=self.product.sku).data["start"]["node_id"], "AAA")

    def test_navigation_errors(self):
        cases = [({}, 400), ({"sku": " "}, 400), ({"sku": "missing"}, 404),
                 ({"sku": self.product.sku, "start_node_id": "FOREIGN"}, 404),
                 ({"sku": self.product.sku, "start_node_id": ""}, 400)]
        for params, status in cases:
            with self.subTest(params=params):
                self.assertEqual(self.route(**params).status_code, status)
        self.start.delete()
        self.assertEqual(self.route(sku=self.product.sku).status_code, 404)

    def test_unreachable_api(self):
        MapEdge.objects.all().delete()
        self.assertEqual(self.route(sku=self.product.sku).status_code, 404)

    def test_search_title_sku_and_store_isolation(self):
        ProductLocation.objects.create(product=Product.objects.create(sku="OTHER_OIL", title="Oil elsewhere"), store=self.other, map_node=self.foreign, aisle_name="Other")
        for term in ("olive", "oil_1l"):
            response = self.client.get(self.base + "products/search/", {"q": term})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["count"], 1)
            item = response.data["results"][0]
            self.assertEqual(item["sku"], self.product.sku)
            self.assertEqual(item["map_node"], [3, 4])
            self.assertEqual(item["bay_number"], 12)
        self.assertEqual(self.client.get(self.base + "products/search/", {"q": "absent"}).data["count"], 0)

    def test_search_invalid_and_missing_store(self):
        for params in ({}, {"q": " "}):
            self.assertEqual(self.client.get(self.base + "products/search/", params).status_code, 400)
        for endpoint in ("navigate/?sku=OIL_1L", "products/search/?q=oil"):
            self.assertEqual(self.client.get("/api/stores/999999/" + endpoint).status_code, 404)

    def test_authentication_required(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.route(sku=self.product.sku).status_code, 401)
        self.assertEqual(self.client.get(self.base + "products/search/", {"q": "oil"}).status_code, 401)


class StoreMapPageTests(StoreNavigationFixture):
    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.user)

    def test_page_search_and_route(self):
        response = self.client.get("/store-navigation/", {"store": self.store.pk, "q": "olive", "sku": self.product.sku})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Show route")
        self.assertContains(response, "Aisle 5")
        self.assertContains(response, '<polyline points="0.0,0.0 3.0,0.0 3.0,4.0"')
        self.assertContains(response, "/media/floorplans/central.svg")

    def test_empty_state_and_staff_setup(self):
        Store.objects.all().delete()
        response = self.client.get("/store-navigation/")
        self.assertContains(response, "No warehouses configured yet")
        self.assertNotContains(response, "Add a warehouse")
        self.user.is_staff = True
        self.user.is_superuser = True
        self.user.save()
        self.assertContains(self.client.get("/store-navigation/"), "Add a warehouse")

    def test_home_and_items_link_to_map(self):
        self.assertContains(self.client.get("/"), 'href="/store-navigation/"')
        self.assertContains(self.client.get("/plu/"), 'href="/store-navigation/"')

    def test_invalid_store_and_unreachable_route(self):
        response = self.client.get("/store-navigation/", {"store": "bad"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["form"].errors)
        MapEdge.objects.all().delete()
        self.assertContains(self.client.get("/store-navigation/", {"sku": self.product.sku}), "No walkable route")

    def test_manual_position_picker_and_reroute(self):
        response = self.client.get("/store-navigation/", {"store": self.store.pk, "sku": self.product.sku, "position": "pick"})
        self.assertContains(response, "Set my position at")
        self.assertContains(response, "Automatic tracking is not connected")
        self.assertContains(response, "Use this position")
        response = self.client.get("/store-navigation/", {"store": self.store.pk, "sku": self.product.sku, "q": "oil", "start_node_id": "CORRIDOR"})
        self.assertEqual(response.context["route"]["total_distance"], 4)
        self.assertContains(response, 'value="CORRIDOR"')
        self.assertContains(response, "start_node_id=CORRIDOR")
        self.assertContains(response, "Your chosen position")
        self.assertContains(response, "Walking directions")
        self.assertContains(response, "bottom of the map")
        self.assertNotContains(response, "Set my position at")

    def test_manual_position_rejects_another_stores_node(self):
        response = self.client.get("/store-navigation/", {"sku": self.product.sku, "start_node_id": "FOREIGN"})
        self.assertContains(response, "The starting point is unavailable")
        self.assertIsNone(response.context["route"])

    def test_3d_guide_loads_face_endpoint_instead_of_full_profile_image(self):
        response = self.client.get("/store-navigation/", {"store": self.store.pk, "sku": self.product.sku})
        self.assertContains(response, 'class="locator-3d-guide"')
        self.assertContains(response, 'data-face-url="/store-navigation/face/"')
        self.assertContains(response, 'id="locator-route-points"')
        self.assertNotContains(response, 'class="locator-character-photo"')
        self.assertNotContains(response, "animateMotion")

    def test_page_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/store-navigation/").status_code, 302)


class DemoSeedTests(TestCase):
    def test_seed_is_repeatable_and_every_product_has_a_walkable_route(self):
        import tempfile
        from io import StringIO
        from django.core.management import call_command
        from django.test import override_settings

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            call_command("seed_navigation_demo", stdout=StringIO())
            counts = (Store.objects.count(), Product.objects.count(), MapNode.objects.count(), MapEdge.objects.count())
            call_command("seed_navigation_demo", stdout=StringIO())
            self.assertEqual(counts, (Store.objects.count(), Product.objects.count(), MapNode.objects.count(), MapEdge.objects.count()))
            store = Store.objects.get(slug="demo-supermarket")
            self.assertTrue(store.floorplan_svg.storage.exists(store.floorplan_svg.name))
            self.assertEqual(ProductLocation.objects.filter(store=store).count(), 8)
            for location in ProductLocation.objects.filter(store=store).select_related("map_node"):
                route = find_shortest_path(store.pk, "ENTRANCE_MAIN", location.map_node.node_id)
                self.assertGreater(route["total_distance"], 0)
                # Walking segments stay axis-aligned in the floorplan corridors.
                for a, b in zip(route["path_points"], route["path_points"][1:]):
                    self.assertTrue(a[0] == b[0] or a[1] == b[1])
            user = get_user_model().objects.create_user(username="demo-viewer")
            self.client.force_login(user)
            response = self.client.get("/store-navigation/", {"store": store.pk})
            self.assertContains(response, "Demo warehouse")
            self.assertContains(response, "Full Cream Milk 2L")


class GuidanceTests(TestCase):
    def test_merge_straight_segments_and_handle_arrival(self):
        from .services.guidance import route_instructions
        self.assertEqual(route_instructions([[1, 1]]), [])
        self.assertEqual(route_instructions([[1, 1], [1, 1]]), [])
        self.assertEqual(route_instructions([[0, 3], [0, 2], [0, 1], [2, 1]]), [
            "Follow the highlighted walkway towards the top of the map.",
            "Follow the highlighted walkway towards the right of the map.",
        ])


class StoreMapPaginationTests(StoreNavigationFixture):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        for index in range(14):
            product = Product.objects.create(sku=f"BROWSE_{index:02}", title=f"Browse product {index:02}")
            ProductLocation.objects.create(product=product, store=cls.store, map_node=cls.target, aisle_name="Aisle 5")

    def setUp(self):
        self.client.force_login(self.user)
        self.url = "/store-navigation/"

    def test_all_stores_support_paginated_browsing(self):
        response = self.client.get(self.url, {"store": self.store.pk})
        self.assertEqual(response.context["result_count"], 15)
        self.assertEqual(len(response.context["results"]), 6)
        self.assertContains(response, "Showing 1–6 of 15 products")
        self.assertContains(response, 'aria-label="Product pagination"')
        self.assertContains(response, "Browse product 00")
        self.assertNotContains(response, "Browse product 06")
        self.assertIsNone(response.context["previous_page_url"])

    def test_next_page_preserves_search_selected_product_and_position(self):
        from urllib.parse import parse_qs, urlsplit
        params = {"store": self.store.pk, "q": "Browse", "sku": self.product.sku, "start_node_id": "CORRIDOR"}
        first = self.client.get(self.url, params)
        next_url = first.context["next_page_url"]
        query = parse_qs(urlsplit(next_url).query)
        for key, value in params.items():
            self.assertEqual(query[key], [str(value)])
        self.assertEqual(query["page"], ["2"])
        self.assertEqual(urlsplit(next_url).fragment, "products")
        second = self.client.get(self.url + next_url)
        self.assertContains(second, "Showing 7–12 of 14 products")
        self.assertContains(second, "Browse product 06")
        self.assertNotContains(second, "Browse product 00")
        self.assertEqual(second.context["route"]["total_distance"], 4)
        self.assertContains(second, "page=2#floorplan")
        self.assertEqual(second.context["location"].product_id, self.product.pk)

    def test_page_boundaries_invalid_values_and_no_matches(self):
        for number, expected in (("nonsense", 1), ("999", 3), ("-1", 3), ("0", 3)):
            with self.subTest(number=number):
                response = self.client.get(self.url, {"store": self.store.pk, "page": number})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.context["page_obj"].number, expected)
        last = self.client.get(self.url, {"store": self.store.pk, "page": 3})
        self.assertEqual(len(last.context["results"]), 3)
        self.assertIsNone(last.context["next_page_url"])
        empty = self.client.get(self.url, {"store": self.store.pk, "q": "No match", "page": 200})
        self.assertContains(empty, "No products found")
        self.assertEqual(empty.context["result_count"], 0)
        self.assertNotContains(empty, 'aria-label="Product pagination"')

    def test_search_form_resets_page_and_only_picker_loads_all_nodes(self):
        response = self.client.get(self.url, {"store": self.store.pk, "page": 2})
        self.assertEqual(response.context["position_nodes"], [])
        self.assertContains(response, 'action="/store-navigation/#products"')
        self.assertContains(response, 'id="products"')
        picker = self.client.get(self.url, {"store": self.store.pk, "page": 2, "position": "pick"})
        self.assertEqual(len(picker.context["position_nodes"]), 3)
        self.assertContains(picker, 'name="page" value="2"')
        self.assertIn("page=2", picker.context["position_nodes"][0]["href"])

    def test_other_stores_products_do_not_appear(self):
        ProductLocation.objects.create(product=Product.objects.create(sku="FOREIGN_SKU", title="Foreign product"), store=self.other, map_node=self.foreign, aisle_name="Other")
        response = self.client.get(self.url, {"store": self.store.pk, "q": "Foreign"})
        self.assertEqual(response.context["result_count"], 0)
        self.assertNotContains(response, "Foreign product")


class FaceTextureTests(TestCase):
    def test_face_crop_excludes_background_and_clothing(self):
        from io import BytesIO
        from unittest.mock import patch, Mock
        from PIL import Image, ImageDraw
        from .services.faces import extract_face_texture
        photo = Image.new("RGB", (100, 180), "blue")
        drawing = ImageDraw.Draw(photo)
        drawing.rectangle((20, 50, 80, 119), fill="red")
        drawing.rectangle((0, 120, 99, 179), fill="green")
        source = BytesIO(); photo.save(source, "PNG")
        detector = Mock(); detector.detectMultiScale.return_value = [(20, 50, 60, 70)]
        with patch("apps.store_navigation.services.faces.face_detector", return_value=detector):
            cropped = Image.open(BytesIO(extract_face_texture(source.getvalue())))
        self.assertEqual(cropped.size, (256, 320))
        self.assertEqual(cropped.getpixel((128, 160)), (255, 0, 0, 255))
        self.assertEqual(cropped.getpixel((0, 0))[3], 0)

    def test_face_endpoint_is_private_and_uses_only_current_accounts_photo(self):
        import tempfile
        from unittest.mock import patch
        from django.core.files.base import ContentFile
        from django.core.cache import cache
        from django.test import override_settings
        from apps.accounts.models import Profile
        user = get_user_model().objects.create_user(username="face-owner")
        other = get_user_model().objects.create_user(username="face-other")
        self.assertEqual(self.client.get("/store-navigation/face/").status_code, 302)
        self.client.force_login(user)
        self.assertEqual(self.client.get("/store-navigation/face/").status_code, 404)
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            Profile.of(user).photo.save("own.jpg", ContentFile(b"own-source"))
            Profile.of(other).photo.save("other.jpg", ContentFile(b"other-source"))
            cache.clear()
            with patch("apps.store_navigation.services.faces.extract_face_texture", return_value=b"cropped-face") as extract:
                response = self.client.get("/store-navigation/face/", {"user": other.pk})
                extract.assert_called_once_with(b"own-source")
            self.assertEqual(response.content, b"cropped-face")
            self.assertEqual(response["Content-Type"], "image/png")
            self.assertIn("private", response["Cache-Control"])
            self.assertIn("no-store", response["Cache-Control"])

    def test_no_face_returns_neutral_guide_error_without_source_photo(self):
        import tempfile
        from io import BytesIO
        from PIL import Image
        from django.core.files.base import ContentFile
        from django.test import override_settings
        from apps.accounts.models import Profile
        user = get_user_model().objects.create_user(username="no-face")
        self.client.force_login(user)
        source = BytesIO(); Image.new("RGB", (100, 100), "white").save(source, "PNG")
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            Profile.of(user).photo.save("blank.png", ContentFile(source.getvalue()))
            response = self.client.get("/store-navigation/face/")
            self.assertEqual(response.status_code, 404)
            self.assertIn("No face detected", response.json()["detail"])
