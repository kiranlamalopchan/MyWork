from django.db import migrations


def add_demo_bins(apps, schema_editor):
    Location = apps.get_model("store_navigation", "ProductLocation")
    for location in Location.objects.filter(store__slug="demo-supermarket", bin_code=""):
        rack = location.aisle_name.replace("Aisle ", "")
        location.zone = "A"
        location.rack = rack
        location.shelf = str(location.bay_number)
        location.bin = "1"
        location.bin_code = f"DEMO-A-{rack}-{location.bay_number}-1"
        location.save(update_fields=["zone", "rack", "shelf", "bin", "bin_code"])


class Migration(migrations.Migration):
    dependencies = [("store_navigation", "0002_pickitem_pickorder_product_barcode_and_more")]
    operations = [migrations.RunPython(add_demo_bins, migrations.RunPython.noop)]
