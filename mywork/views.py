"""
Project-level screens: the app chooser you land on after signing in, plus the
account pages that belong to MyWork as a whole rather than to either app.

MyWork hosts two independent apps — PLU Management and TimeSheet Management.
Nothing here knows what either one does; it only points at their front doors.
"""

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.shortcuts import redirect, render

from noticeboard.views import board_context, recent_for_hub


@login_required
def home(request):
    """
    The hub. Two cards, one per app — picking one hands the whole navigation
    over to that app's own section, so the tab bar only ever shows the
    features of the app you're currently inside.

    Under them, the notice board: the one thing on MyWork that everybody
    shares, so it belongs on the page everybody lands on.
    """
    notices, total = recent_for_hub(request.user)
    return render(request, "home.html", board_context(
        request,
        notices=notices,
        notice_total=total,
        next_url=request.path,
    ))


def register(request):
    """Public sign-up. On success the new account lands on the hub."""
    if request.user.is_authenticated:
        return redirect("home")

    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, "Account created. You are now logged in.")
            return redirect("home")
        messages.error(request, "Please correct the errors below.")
    else:
        form = UserCreationForm()

    return render(request, "registration/register.html", {"form": form})
