"""
Your own profile: the face MyWork shows for you, and what you have done in it.

This is the one page behind the avatar in the app bar. It is deliberately not
a second copy of either app's settings — TimeSheet's own preferences stay
behind TimeSheet's More, and the board's stay on the board. What belongs here
is only what is true of you across the whole of MyWork: your photo, your name,
and the figures both apps can add up about you.
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.views.decorators.http import require_POST

from apps.noticeboard.models import Comment, CommentReaction, Notice, Reaction
from apps.timeclock.models import Shift, Workplace
from apps.timeclock.views import hours_this_week

from .forms import PhotoForm, ProfileForm
from .models import Profile


def _activity(user):
    """
    What MyWork can say about you, gathered from the apps that know.

    Each app answers for itself — hours are TimeSheet's reading of the week,
    notices are the board's count — so nothing here re-implements a figure
    that is shown elsewhere and could drift from it.
    """
    worked = hours_this_week(user)

    return {
        "week_hours": worked.total_seconds() / 3600,
        "shift_count": Shift.objects.filter(user=user).count(),
        "workplace_count": Workplace.objects.filter(user=user).count(),
        "notice_count": Notice.objects.filter(author=user).count(),
        "comment_count": Comment.objects.filter(author=user).count(),
        # A reaction to your notice and one to your comment are the same
        # compliment, counted as one — as the board's own profile page does.
        "reactions_received": (
            Reaction.objects.filter(notice__author=user).count()
            + CommentReaction.objects.filter(comment__author=user).count()
        ),
    }


@login_required
def profile(request):
    """
    Your profile, to look at.

    Reading and editing are separate screens. A page that is a form is a page
    you have to check before you trust it — every value sitting in a box that
    could have been half-typed — and the thing you came here to do most of the
    time is look at what is already true.
    """
    return render(request, "accounts/profile.html", {
        "me": Profile.of(request.user),
        "photo_form": PhotoForm(),
        "section_title": "Profile",
        **_activity(request.user),
    })


@login_required
def profile_edit(request):
    """Your details, to change."""
    me = Profile.of(request.user)

    if request.method == "POST":
        form = ProfileForm(request.POST, instance=me)
        if form.is_valid():
            form.save()
            messages.success(request, "Profile saved.")
            return redirect("accounts:profile")
        messages.error(request, "Please correct the errors below.")
    else:
        form = ProfileForm(instance=me)

    return render(request, "accounts/profile_form.html", {
        "form": form,
        "me": me,
        "section_title": "Edit profile",
    })


@login_required
@require_POST
def photo_upload(request):
    """
    Take a new picture, and nothing else.

    Its own endpoint because it is its own decision, made from the menu on the
    photo. Sending it through the details form would mean a new picture could
    only be kept by also saving whatever was in the other boxes.
    """
    me = Profile.of(request.user)
    form = PhotoForm(request.POST, request.FILES)

    if form.is_valid():
        me.set_photo(form.cleaned_data["photo"])
        me.save()
        messages.success(request, "Photo updated.")
    else:
        messages.error(request, form.errors["photo"][0])

    return redirect("accounts:profile")


@login_required
@require_POST
def photo_remove(request):
    """Drop the photo and go back to the letter."""
    me = Profile.of(request.user)
    if me.photo:
        me.clear_photo()
        me.save()
        messages.success(request, "Photo removed.")
    return redirect("accounts:profile")
