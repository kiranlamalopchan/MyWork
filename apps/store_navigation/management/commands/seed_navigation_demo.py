"""Install the user-supplied reference layout with sample product locations."""
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.store_navigation.models import MapEdge, MapNode, Product, ProductLocation, Store


class Command(BaseCommand):
    help = "Set up the demo using the converted reference map; replaces only the demo walking graph."

    @transaction.atomic
    def handle(self, *args, **options):
        store, _ = Store.objects.get_or_create(
            slug="demo-supermarket", defaults={"name": "Demo Warehouse (sample data)"},
        )
        store.viewbox_width = 650
        store.viewbox_height = 715
        svg = Path(__file__).resolve().parents[2] / "data" / "reference_floorplan.svg"
        # Reuse the converted file on subsequent runs, without extra storage copies.
        if not store.floorplan_svg.name or "reference_floorplan" not in store.floorplan_svg.name:
            store.floorplan_svg.save("reference_floorplan.svg", ContentFile(svg.read_bytes()), save=False)
        store.save()

        # Rebuild this labelled demo's graph because the reference geometry is
        # different from the original rectangular dummy floorplan.
        MapEdge.objects.filter(store=store).delete()
        ProductLocation.objects.filter(store=store).delete()
        MapNode.objects.filter(store=store).delete()

        nodes = {}

        def node(name, x, y, kind="CORRIDOR"):
            result = MapNode.objects.create(store=store, node_id=name, node_type=kind, pos_x=x, pos_y=y)
            return result

        def connect(a, b):
            for source, target in ((a, b), (b, a)):
                MapEdge.objects.create(store=store, from_node=source, to_node=target)

        # Coordinates follow open gaps between the reference image's tall
        # shelving runs. Horizontal connections exist only above/below shelves.
        columns = (100, 140, 175, 215, 247, 280, 310, 343, 375)
        rows = (130, 275, 320, 450, 500, 550)
        for x in columns:
            previous = None
            for y in rows:
                nodes[x, y] = node(f"WALK_{x}_{y}", x, y)
                if previous is not None:
                    connect(previous, nodes[x, y])
                previous = nodes[x, y]
        for y in (130, 550):
            for left, right in zip(columns, columns[1:]):
                connect(nodes[left, y], nodes[right, y])

        entrance = node("ENTRANCE_MAIN", 480, 665, "ENTRANCE")
        lower = node("ENTRANCE_LOWER", 480, 650)
        checkout_gap = node("CHECKOUT_GAP", 310, 650)
        connect(entrance, lower)
        connect(lower, checkout_gap)
        connect(checkout_gap, nodes[310, 550])

        products = [
            ("DEMO_APPLES", "Fresh Apples 1kg", "Aisle 1", 1, 100, 320),
            ("DEMO_BANANAS", "Bananas 1kg", "Aisle 2", 2, 140, 450),
            ("DEMO_OLIVE_OIL", "Moro Oil Olive Extra Virgin 1L", "Aisle 5", 2, 247, 275),
            ("DEMO_PASTA", "Penne Pasta 500g", "Aisle 5", 3, 247, 450),
            ("DEMO_BISCUITS", "Chocolate Biscuits 200g", "Aisle 6", 2, 280, 320),
            ("DEMO_TEA", "Breakfast Tea 100 Bags", "Aisle 7", 3, 310, 450),
            ("DEMO_MILK", "Full Cream Milk 2L", "Aisle 9", 2, 375, 450),
            ("DEMO_CHEESE", "Tasty Cheese 500g", "Aisle 8", 3, 343, 500),
        ]
        for sku, title, aisle, bay, x, y in products:
            product, _ = Product.objects.update_or_create(sku=sku, defaults={"title": title})
            ProductLocation.objects.create(
                store=store, product=product, aisle_name=aisle, bay_number=bay, map_node=nodes[x, y],
                zone="A", rack=aisle.replace("Aisle ", ""), shelf=str(bay), bin="1",
                bin_code=f"DEMO-A-{aisle.split()[-1]}-{bay}-1",
            )
        self.stdout.write(self.style.SUCCESS(f"Reference demo ready: /store-navigation/?store={store.pk}&q=olive&sku=DEMO_OLIVE_OIL#floorplan"))
