# moderation/urls.py — mounted by the project under /safety/.

from django.urls import path

from . import views

app_name = "moderation"

urlpatterns = [
    path("rules/", views.rules, name="rules"),
    path("report/", views.report, name="report"),
    path("blocked/", views.blocked, name="blocked"),
    path("block/<str:username>/", views.block, name="block"),
    path("unblock/<str:username>/", views.unblock, name="unblock"),
]
