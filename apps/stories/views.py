"""
The row of faces on the hub, and the full-screen viewer behind each one.

The tray is server-rendered (`tray_for`, `stories/_tray.html`) so it is on
the page as it loads; the viewer is drawn by app.js from `person`'s JSON,
so opening a story is a fetch and not a page. Every action here answers a
fetch with the fragment it needs and a plain form with a redirect, so the
row works, if more slowly, with no script at all.
"""

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Count
from django.http import HttpResponse, HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.timesince import timesince
from django.views.decorators.http import require_POST

from apps.accounts.models import Profile
from apps.noticeboard.models import Emoji

from .forms import StoryForm
from .models import MAX_VIDEO_SECONDS, Story, StoryReaction, Unusable

User = get_user_model()


# ---- the tray ---------------------------------------------------------------


def tray_for(user):
    """
    The tiles on the hub, in order: yours first if you have one, then
    everyone with something you haven't seen, newest first, then the rest.

    One row per author, carrying their latest live story for the picture,
    how many they have, and whether any is still unseen by `user`.
    """
    Story.sweep()
    live = Story.objects.live().select_related("author", "author__profile")
    seen = set(
        live.filter(views__viewer=user).values_list("pk", flat=True)
    )
    by_author = {}
    for story in live.order_by("created_at"):
        row = by_author.setdefault(story.author_id, {
            "user": story.author,
            "profile": Profile.of(story.author),
            "latest": story,
            "count": 0,
            "unseen": False,
            "mine": story.author_id == user.pk,
        })
        row["latest"] = story
        row["count"] += 1
        if story.author_id != user.pk and story.pk not in seen:
            row["unseen"] = True
    rows = list(by_author.values())
    rows.sort(key=lambda r: (not r["mine"], not r["unseen"], -r["latest"].created_at.timestamp()))
    return rows


def _tray_response(request):
    return render(request, "stories/_tray.html", {"stories": tray_for(request.user)})


def _is_fetch(request):
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"


# ---- posting one --------------------------------------------------------------


@login_required
def compose(request):
    """The page behind the Create tile, for a browser without script."""
    return render(request, "stories/compose.html", {"form": StoryForm()})


def _refused(request, error):
    if _is_fetch(request):
        return JsonResponse({"error": error}, status=400)
    messages.error(request, error)
    return redirect("stories:compose")


@login_required
@require_POST
def create(request):
    """
    A new story: a photo (any format Pillow or pillow-heif opens, already
    cropped by the phone's editor) or a video of up to MAX_VIDEO_SECONDS,
    with the poster frame the phone grabbed.
    """
    form = StoryForm(request.POST, request.FILES)
    if not form.is_valid():
        return _refused(request, "That file couldn't be used. Choose a photo or a video.")
    data = form.cleaned_data
    if not data["image"] and not data["video"]:
        return _refused(request, "Choose a photo or a video for your story.")
    story = Story(author=request.user, caption=data["caption"].strip())
    try:
        if data["video"]:
            story.set_video(
                data["video"], poster=data["poster"], duration=data["duration"],
                start=data["trim_start"], end=data["trim_end"],
            )
        else:
            story.set_image(data["image"])
    except Unusable as why:
        return _refused(request, str(why))
    except Exception:
        return _refused(request, "That photo couldn't be read. Try a JPEG, PNG or HEIC.")
    story.save()
    if _is_fetch(request):
        return _tray_response(request)
    return redirect("home")


@login_required
@require_POST
def delete(request, pk):
    story = get_object_or_404(Story, pk=pk)
    if story.author_id != request.user.pk:
        return HttpResponseForbidden()
    story.take_down()
    if _is_fetch(request):
        return _tray_response(request)
    return redirect("home")


# ---- looking at them --------------------------------------------------------


def _ago(when):
    delta = timezone.now() - when
    if delta.total_seconds() < 60:
        return "just now"
    return timesince(when, timezone.now()).split(",")[0] + " ago"


def _story_json(story, viewer):
    mine = story.author_id == viewer.pk
    my = story.reactions.filter(user=viewer).first()
    tally = (
        story.reactions.values("emoji").annotate(n=Count("id")).order_by("-n")
    )
    data = {
        "id": story.pk,
        "kind": story.kind,
        "image": story.image.url if story.image else "",
        "video": story.video.url if story.video else "",
        "duration": story.duration,
        "caption": story.caption,
        "ago": _ago(story.created_at),
        "created": story.created_at.isoformat(),
        "mine": mine,
        "my_emoji": my.emoji if my else "",
        "reactions": [{"emoji": r["emoji"], "count": r["n"]} for r in tally],
    }
    if mine:
        data["seen_count"] = story.views.count()
        data["viewers"] = [
            {"name": Profile.of(v.viewer).name, "ago": _ago(v.seen_at)}
            for v in story.views.select_related("viewer", "viewer__profile")[:50]
        ]
        data["delete_url"] = reverse("stories:delete", args=[story.pk])
    return data


@login_required
def person(request, username):
    """
    Everything `username` has up right now. JSON for the viewer; a plain
    page of the same pictures for a browser without script.
    """
    author = get_object_or_404(User, username=username)
    stories = list(Story.objects.live().filter(author=author).order_by("created_at"))
    if not stories:
        if _is_fetch(request):
            return JsonResponse({"error": "Nothing here any more."}, status=404)
        messages.info(request, "Those stories have gone.")
        return redirect("home")
    profile = Profile.of(author)
    if _is_fetch(request):
        seen = set(request.user.story_views.filter(story__in=stories).values_list("story_id", flat=True))
        return JsonResponse({
            "username": author.get_username(),
            "name": "Your story" if author.pk == request.user.pk else profile.name,
            "photo": profile.photo_url,
            "initial": profile.initial,
            "hue": profile.hue,
            # Where to start: the first one not yet seen.
            "start": next((i for i, s in enumerate(stories) if s.pk not in seen and s.author_id != request.user.pk), 0),
            "emoji": [{"value": v, "label": l} for v, l in Emoji.choices],
            "max_seconds": MAX_VIDEO_SECONDS,
            "stories": [_story_json(s, request.user) for s in stories],
        })
    for story in stories:
        story.seen_by(request.user)
    return render(request, "stories/person.html", {"author": author, "profile": profile, "stories": stories})


@login_required
@require_POST
def seen(request, pk):
    story = get_object_or_404(Story.objects.live(), pk=pk)
    story.seen_by(request.user)
    return HttpResponse(status=204)


@login_required
@require_POST
def react(request, pk):
    story = get_object_or_404(Story.objects.live(), pk=pk)
    left = StoryReaction.toggle(story, request.user, request.POST.get("emoji", ""))
    if _is_fetch(request):
        tally = story.reactions.values("emoji").annotate(n=Count("id")).order_by("-n")
        return JsonResponse({
            "my_emoji": left or "",
            "reactions": [{"emoji": r["emoji"], "count": r["n"]} for r in tally],
        })
    return redirect("stories:person", username=story.author.get_username())
