from django.db import migrations


def rename_demo(apps, schema_editor):
    # Preserve any name the workplace has customised.
    apps.get_model("store_navigation", "Store").objects.filter(
        slug="demo-supermarket", name="Demo Supermarket (sample data)"
    ).update(name="Demo Warehouse (sample data)")


class Migration(migrations.Migration):
    dependencies = [("store_navigation", "0003_demo_warehouse_locations")]
    operations = [migrations.RunPython(rename_demo, migrations.RunPython.noop)]
