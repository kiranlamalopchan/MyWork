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


@login_required
def home(request):
    """
    The hub. Two cards, one per app — picking one hands the whole navigation
    over to that app's own section, so the tab bar only ever shows the
    features of the app you're currently inside.
    """
    return render(request, "home.html")


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
