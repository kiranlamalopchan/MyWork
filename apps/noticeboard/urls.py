# noticeboard/urls.py
#
# The board itself lives on the hub; these are the actions behind it. Mounted
# by the project under /notices/.

from django.urls import path

from . import views

app_name = "notices"

urlpatterns = [
    path("", views.board, name="board"),
    # The page behind the + button. With JS it never loads — the button opens
    # the same form in a dialog instead — but it is where the button points.
    path("new/", views.notice_compose, name="compose"),
    path("post/", views.notice_create, name="create"),
    path("<int:pk>/react/", views.notice_react, name="react"),
    # Behind the tally: the count in names, for a notice and for a comment.
    path("<int:pk>/reactions/", views.notice_reactors, name="reactors"),
    path("<int:pk>/comment/", views.comment_create, name="comment"),
    path("comments/<int:pk>/react/", views.comment_react, name="comment_react"),
    path("comments/<int:pk>/reactions/", views.comment_reactors, name="comment_reactors"),
    path("comments/<int:pk>/delete/", views.comment_delete, name="comment_delete"),
    path("<int:pk>/edit/", views.notice_edit, name="edit"),
    path("<int:pk>/delete/", views.notice_delete, name="delete"),
    # Who wrote it. Every name on the board leads here.
    path("people/<str:username>/", views.person, name="person"),
]
