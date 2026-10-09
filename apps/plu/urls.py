# plu/urls.py
#
# Mounted by the project under /plu/, so every path here is relative to that.
# Sign-in and registration belong to KaamKoRecord itself and live in mywork/urls.py.

from django.urls import path

from . import views, catalogue_views

app_name = "plu"

urlpatterns = [
    path("", catalogue_views.item_list, name="list"),
    path("api/search/", catalogue_views.search_api, name="search_api"),
    path("item/<int:plu_no>/", catalogue_views.item_detail, name="detail"),

    path("import/", catalogue_views.import_csv, name="import"),
    path("photo-search/", views.photo_search, name="photo_search"),
    path("photo-search/pdf/", views.photo_search_pdf, name="photo_search_pdf"),
    path("photo-search/pick/", views.photo_search_pick, name="photo_search_pick"),
    path("photo-search/clear/", views.photo_search_clear, name="photo_search_clear"),
]
