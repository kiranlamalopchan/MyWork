"""
Your own profile: the face MyWork shows for you, and what you have done in it.

This is the one page behind the avatar in the app bar. It is deliberately not
a second copy of either app's settings — TimeSheet's own preferences stay
behind TimeSheet's More, and the board's stay on the board. What belongs here
is only what is true of you across the whole of MyWork: your photo, your name,
and the figures both apps can add up about you.
"""

from datetime import timedelta

from django.contrib import messages
from django.contrib.auth import get_user_model, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from apps.noticeboard.models import Comment, CommentReaction, Notice, Reaction
from apps.timeclock.models import Shift, Workplace
from apps.timeclock.views import hours_this_week

from . import notify
from .forms import PhotoForm, ProfileForm
from .models import FriendRequest, Friendship, Profile


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
        "friend_count": Friendship.objects.filter(user=user).count(),
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

    Friends live here too rather than behind a link to a page of their own —
    who your "Friends only" posts reach is exactly the kind of thing this
    page already answers about you, and a search box you have to navigate to
    is a search box people stop using.
    """
    today = timezone.localdate()
    # Where the statement form opens: this month so far. Last month is a
    # tap away on the form itself.
    last_month_end = today.replace(day=1) - timedelta(days=1)
    return render(request, "accounts/profile.html", {
        "me": Profile.of(request.user),
        "photo_form": PhotoForm(),
        "section_title": "Profile",
        "workplaces": Workplace.objects.filter(user=request.user).order_by("name"),
        "statement_from": today.replace(day=1),
        "statement_to": today,
        "last_month_from": last_month_end.replace(day=1),
        "last_month_to": last_month_end,
        "today": today,
        **_activity(request.user),
        **_friends_context(request.user, request.GET.get("friends_q", "")),
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


# ---------------------------------------------------------------------------
# Friends — who your "Friends only" posts reach, gathered here for the
# profile page, which is the one place all of this is shown.
# ---------------------------------------------------------------------------

# How many names a search box on a small team needs to narrow. Past this a
# name is worth typing for rather than scanning for.
SEARCH_MIN_USERS = 12


def _friends_context(user, query=""):
    """
    Everything the profile page's Friends section shows: your friends, your
    pending requests both ways, and everyone else — one call, because on a
    workplace-sized user list there is no need to split "find people" from
    "manage your list" the way a public network would.
    """
    friend_ids = Friendship.ids_for(user)
    received = list(
        FriendRequest.objects.filter(to_user=user).select_related(
            "from_user", "from_user__profile"
        )
    )
    sent = list(
        FriendRequest.objects.filter(from_user=user).select_related(
            "to_user", "to_user__profile"
        )
    )
    pending_to = {r.to_user_id for r in sent}
    pending_from = {r.from_user_id for r in received}

    from apps.moderation.models import Block
    people = get_user_model().objects.filter(is_active=True).exclude(pk=user.pk).exclude(pk__in=Block.ids_for(user))
    query = (query or "").strip()
    if query:
        people = people.filter(username__icontains=query)
    people = list(people.select_related("profile").order_by("username"))

    friend_list = [p for p in people if p.pk in friend_ids]
    others = [
        p for p in people
        if p.pk not in friend_ids and p.pk not in pending_to and p.pk not in pending_from
    ]

    return {
        "friends_received": received,
        "friends_sent": sent,
        "friend_list": friend_list,
        "friends_others": others,
        "friends_query": query,
        "friends_show_search": len(people) > SEARCH_MIN_USERS or bool(query),
    }


def _to_friends(request):
    """
    Back to the Friends section of the profile page.

    A page of its own used to be here; everything it did now lives on the
    profile, so every action that used to land back on that page lands here
    instead — one redirect target rather than a page nothing links to any
    more.
    """
    query = request.POST.get("next_friends_q") or request.GET.get("friends_q") or ""
    url = reverse("accounts:profile")
    if query:
        url = f"{url}?friends_q={query}"
    return redirect(f"{url}#friends")


@login_required
def friends(request):
    """
    The old address for the Friends page. Kept working — a notification
    already sent, a bookmark already made — by sending it to where the same
    thing lives now.
    """
    return _to_friends(request)


@login_required
@require_POST
def friend_request_send(request, username):
    """Ask `username` to be friends."""
    me = request.user
    them = get_object_or_404(get_user_model(), username=username, is_active=True)

    if them.pk == me.pk:
        return _to_friends(request)

    from apps.moderation.models import Block
    if Block.between(me, them):
        messages.error(request, "That request can't be sent.")
        return _to_friends(request)

    if Friendship.are_friends(me, them):
        messages.info(request, f"You and {them.get_username()} are already friends.")
        return _to_friends(request)

    # They already asked you — accepting theirs is the same as sending your
    # own and having it answered in the same breath, so do that instead of
    # leaving two requests crossed in the post.
    theirs = FriendRequest.objects.filter(from_user=them, to_user=me).first()
    if theirs is not None:
        theirs.accept()
        notify.friend_accepted(me, them)
        messages.success(request, f"You and {them.get_username()} are now friends.")
        return _to_friends(request)

    friend_request, created = FriendRequest.objects.get_or_create(from_user=me, to_user=them)
    if created:
        notify.friend_requested(friend_request)
        messages.success(request, f"Friend request sent to {them.get_username()}.")
    return _to_friends(request)


@login_required
@require_POST
def friend_request_accept(request, pk):
    friend_request = get_object_or_404(FriendRequest, pk=pk, to_user=request.user)
    friend_request.accept()
    notify.friend_accepted(request.user, friend_request.from_user)
    messages.success(request, f"You and {friend_request.from_user.get_username()} are now friends.")
    return _to_friends(request)


@login_required
@require_POST
def friend_request_decline(request, pk):
    # Also how a request you sent is cancelled: `from_user=request.user` on
    # a `to_user`-filtered lookup would 404, so both directions are checked.
    friend_request = get_object_or_404(
        FriendRequest.objects.filter(to_user=request.user) | FriendRequest.objects.filter(from_user=request.user),
        pk=pk,
    )
    friend_request.decline()
    return _to_friends(request)


@login_required
@require_POST
def friend_remove(request, username):
    them = get_object_or_404(get_user_model(), username=username)
    Friendship.unfriend(request.user, them)
    messages.success(request, f"Removed {them.get_username()} from your friends.")
    return _to_friends(request)


def delete_account(user):
    """
    Everything about a person, gone: the account row and, by cascade, the
    profile, shifts, workplaces, notices, comments, reactions, stories,
    friendships and devices. What they said to others stays where it was
    said only as a notification's words, with no actor (SET_NULL there is
    deliberate — see apps/notifications/models.py). The photo file is
    dropped by hand, since a FileField leaves it behind.
    """
    profile = Profile.objects.filter(user=user).first()
    if profile and profile.photo:
        profile.clear_photo()
    user.delete()


@login_required
def account_delete(request):
    """
    The way out for good, behind the password: the store review guidelines
    ask that an account made in the app can be deleted in it, and this is
    the page the app and the site both send you to.
    """
    if request.method == "POST":
        if request.user.check_password(request.POST.get("password", "")):
            user = request.user
            logout(request)
            delete_account(user)
            messages.success(request, "Your account and everything in it have been deleted.")
            return redirect("login")
        messages.error(request, "That password isn't right.")
    return render(request, "accounts/delete.html")
