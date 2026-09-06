# plu/urls.py

from django.urls import path
from django.contrib.auth import views as auth_views
from . import views

app_name = "plu"

urlpatterns = [
    # Authentication
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("register/", views.register, name="register"),

    # PLU app
    path("", views.plu_list, name="list"),
    path("api/search/", views.search_api, name="search_api"),
    path("import/", views.import_csv, name="import"),
    path("photo-search/", views.photo_search, name="photo_search"),
    path("photo-search/pdf/", views.photo_search_pdf, name="photo_search_pdf"),
    path("<int:plu_no>/", views.plu_detail, name="detail"),
]