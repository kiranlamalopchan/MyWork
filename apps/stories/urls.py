# stories/urls.py — mounted by the project under /stories/.

from django.urls import path

from . import views

app_name = "stories"

urlpatterns = [
    path("new/", views.compose, name="compose"),
    path("post/", views.create, name="create"),
    path("<int:pk>/delete/", views.delete, name="delete"),
    path("<int:pk>/seen/", views.seen, name="seen"),
    path("<int:pk>/react/", views.react, name="react"),
    path("<str:username>/", views.person, name="person"),
]
