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
    path("workplaces/payslip/", views.workplace_payslip, name="workplace_payslip"),
    path("workplaces/<int:pk>/edit/", views.workplace_edit, name="workplace_edit"),
    # Removing takes the shifts, breaks and payments with it, so
    # the screen that counts them comes first and the POST does it.
    path("workplaces/<int:pk>/remove/", views.workplace_confirm_delete, name="workplace_confirm_delete"),
    path("workplaces/<int:pk>/delete/", views.workplace_delete, name="workplace_delete"),
    path("workplaces/<int:pk>/default/", views.workplace_make_default, name="workplace_default"),

    # What each job still owes, and the one form that draws a line under it:
    # a run, everything up to now, or a day named outright.
    path("pay/", views.payments, name="payments"),
    path("pay/<int:pk>/received/", views.payment_record, name="payment_record"),
    path("pay/<int:pk>/undo/", views.payment_undo, name="payment_undo"),
    # A stretch of the record as a PDF, asked for from the profile — any
    # dates, one job or all — to check a payment against a bank feed.
    path("statement/", views.statement, name="statement"),

    # The employer's own statement of what they paid, read and checked
    # against the hours you recorded for the same days.

    path("preferences/", views.preferences, name="preferences"),
    path("more/", views.more, name="more"),
]
