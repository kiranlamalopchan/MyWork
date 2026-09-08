# accounts/urls.py
#
# Who you are on MyWork. Mounted by the project at /profile/, one level up
# from either app, because your face is not a feature of PLU or of TimeSheet.

from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("", views.profile, name="profile"),
    path("edit/", views.profile_edit, name="edit"),
    # The picture is changed and dropped from the menu on the picture, so each
    # is a POST of its own rather than a field on the details form.
    path("photo/", views.photo_upload, name="photo"),
    path("photo/remove/", views.photo_remove, name="photo_remove"),
]
