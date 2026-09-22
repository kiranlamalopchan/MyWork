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
    path("delete/", views.account_delete, name="delete"),
    # The password you already know, and — for an admin — a link for somebody
    # who no longer knows theirs. See apps/accounts/passwords.py.
    path("password/", views.password_change, name="password"),
    path("reset-links/", views.reset_links, name="reset_links"),
    # The picture is changed and dropped from the menu on the picture, so each
    # is a POST of its own rather than a field on the details form.
    path("photo/", views.photo_upload, name="photo"),
    path("photo/remove/", views.photo_remove, name="photo_remove"),
    # Who your "Friends only" posts reach.
    path("friends/", views.friends, name="friends"),
    path("friends/request/<str:username>/", views.friend_request_send, name="friend_request_send"),
    path("friends/accept/<int:pk>/", views.friend_request_accept, name="friend_request_accept"),
    path("friends/decline/<int:pk>/", views.friend_request_decline, name="friend_request_decline"),
    path("friends/remove/<str:username>/", views.friend_remove, name="friend_remove"),
]
