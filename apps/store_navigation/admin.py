from django.contrib import admin

from .models import MapEdge, MapNode, Product, ProductLocation, Store


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "viewbox_width", "viewbox_height")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("sku", "title", "barcode")
    search_fields = ("sku", "title", "barcode")


@admin.register(MapNode)
class MapNodeAdmin(admin.ModelAdmin):
    list_display = ("node_id", "store", "node_type", "pos_x", "pos_y")
    list_filter = ("store", "node_type")
    search_fields = ("node_id", "store__name")
    list_select_related = ("store",)


@admin.register(MapEdge)
class MapEdgeAdmin(admin.ModelAdmin):
    list_display = ("store", "from_node", "to_node", "weight")
    list_filter = ("store",)
    autocomplete_fields = ("store", "from_node", "to_node")
    list_select_related = ("store", "from_node__store", "to_node")


@admin.register(ProductLocation)
class ProductLocationAdmin(admin.ModelAdmin):
    list_display = ("product", "store", "zone", "rack", "shelf", "bin", "bin_code", "map_node")
    list_filter = ("store",)
    search_fields = ("product__sku", "product__title", "aisle_name", "zone", "rack", "bin_code")
    autocomplete_fields = ("product", "store", "map_node")
    list_select_related = ("product", "store", "map_node__store")
