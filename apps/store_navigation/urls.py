from django.urls import path

from .views import NavigateView, ProductSearchView

app_name = "store_navigation"

urlpatterns = [
    path("<int:store_id>/products/search/", ProductSearchView.as_view(), name="product-search"),
    path("<int:store_id>/navigate/", NavigateView.as_view(), name="navigate"),
]
