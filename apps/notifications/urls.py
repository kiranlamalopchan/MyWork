# notifications/urls.py
#
# The bell and what is behind it. Mounted by the project at /notifications/.
#
# Not a section of MyWork the way PLU and TimeSheet are — there is no tab bar
# for it, because it is not somewhere you go to work. It is the thing that
# tells you to go somewhere else.

from django.urls import path

from . import views

app_name = "notifications"

urlpatterns = [
    path("", views.inbox, name="inbox"),
    path("read/", views.read_all, name="read_all"),
    # Where a notification on a lock screen actually points.
    path("<int:pk>/go/", views.go, name="go"),
    # Spoken to by notifications.js, never by a person.
    path("subscribe/", views.subscribe, name="subscribe"),
    path("unsubscribe/", views.unsubscribe, name="unsubscribe"),
]
