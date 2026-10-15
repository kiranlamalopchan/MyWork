from django.urls import path

from .web_views import face_texture, store_map

from . import picking_views

app_name = "store_map"
urlpatterns = [
    path("products/add/", picking_views.add_product, name="add_product"),
    path("picking/", picking_views.orders, name="orders"),
    path("picking/<uuid:pk>/", picking_views.pick_order, name="pick_order"),
    path("locations/<int:pk>/", picking_views.edit_location, name="edit_location"),
path("", store_map, name="index"), path("face/", face_texture, name="face")]
