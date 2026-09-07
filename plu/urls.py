# plu/urls.py
#
# Mounted by the project under /plu/, so every path here is relative to that.
# Sign-in and registration belong to MyWork itself and live in mywork/urls.py.

from django.urls import path

from . import views

app_name = "plu"

urlpatterns = [
    path("", views.plu_list, name="list"),
    path("api/search/", views.search_api, name="search_api"),
    path("item/<int:plu_no>/", views.plu_detail, name="detail"),

    path("import/", views.import_csv, name="import"),
    path("photo-search/", views.photo_search, name="photo_search"),
    path("photo-search/pdf/", views.photo_search_pdf, name="photo_search_pdf"),
]
