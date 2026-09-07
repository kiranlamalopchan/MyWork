# timeclock/urls.py
#
# Mounted by the project under /timesheet/, so "" below is the clock
# dashboard — the front door of the TimeSheet Management app.

from django.urls import path

from . import views

app_name = "timeclock"

urlpatterns = [
    path("", views.dashboard, name="dashboard"),

    # Clock actions — all POST-only, each redirects back to the dashboard.
    path("clock-in/", views.clock_in, name="clock_in"),
    path("break/start/", views.start_break, name="start_break"),
    path("break/end/", views.end_break, name="end_break"),
    path("clock-out/", views.clock_out, name="clock_out"),

    path("shifts/", views.timesheet, name="timesheet"),
    path("calendar/", views.calendar_month, name="calendar"),
    # Typing in a day the clock was never started on.
    path("shifts/add/", views.shift_create, name="shift_create"),
    path("shifts/<int:pk>/", views.shift_detail, name="shift_detail"),
    path("shifts/<int:pk>/edit/", views.shift_edit, name="shift_edit"),
    path("shifts/<int:pk>/delete/", views.shift_delete, name="shift_delete"),

    path("workplaces/", views.workplace_list, name="workplaces"),
    path("workplaces/add/", views.workplace_create, name="workplace_create"),
    path("workplaces/<int:pk>/edit/", views.workplace_edit, name="workplace_edit"),
    path("workplaces/<int:pk>/delete/", views.workplace_delete, name="workplace_delete"),
    path("workplaces/<int:pk>/default/", views.workplace_make_default, name="workplace_default"),

    path("preferences/", views.preferences, name="preferences"),
    path("more/", views.more, name="more"),
]
