# mywork/urls.py
#
# MyWork is the mother project. It owns the hub and the account pages; each
# app is mounted under its own prefix so the two never collide and either one
# can be moved or removed without touching the other.

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from . import views

urlpatterns = [
    path("admin/", admin.site.urls),

    # Hub + accounts
    path("", views.home, name="home"),
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("register/", views.register, name="register"),

    # The shared notice board behind the hub
    path("notices/", include("noticeboard.urls")),

    # The two apps
    path("plu/", include("plu.urls")),
    path("timesheet/", include("timeclock.urls")),
]
