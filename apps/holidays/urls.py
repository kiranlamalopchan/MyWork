# holidays/urls.py
#
# Australian public holidays. Mounted by the project at /holidays/.
#
# Not a section of MyWork the way PLU and TimeSheet are: it is one card on the
# hub and one page behind it, so it has no tab bar of its own.

from django.urls import path

from . import views

app_name = "holidays"

urlpatterns = [
    path("", views.calendar, name="calendar"),
    # What the mobile app calls.
    path("api/next/", views.next_holiday, name="api_next"),
]
