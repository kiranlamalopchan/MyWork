"""The row of faces and the viewer behind each, and posting one."""

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Profile
from apps.stories.forms import StoryForm
from apps.stories.models import MAX_VIDEO_SECONDS, Story, StoryReaction, Unusable
from apps.stories import notify as story_notify
from apps.stories.views import tray_for

from .. import serialize
from . import uploads

User = get_user_model()


def _tray(request):
    return [serialize.tray_row(request, row, request.user) for row in tray_for(request.user)]


class Tray(APIView):
    def get(self, request):
        return Response({"stories": _tray(request), "max_seconds": MAX_VIDEO_SECONDS})

    def post(self, request):
        """
        A new story: a photo, or a video with the fields the site's composer
        sends — poster, duration, trim_start/trim_end for a clip cut to a
        window. The same set_image/set_video, so the same conversions.
        """
        # A video too big for one request came in pieces (views/uploads.py):
        # the assembled file stands in for the attachment.
        files = {name: request.FILES[name] for name in request.FILES}
        upload_id = request.data.get("upload_id")
        assembled = None
        if upload_id:
            assembled = uploads.take(request.user, upload_id, request.data.get("filename") or "video.mp4")
            if assembled is None:
                return Response({"detail": "That upload wasn't found. Send the video again."}, status=400)
            files["video"] = assembled
        try:
            return self._create(request, files)
        finally:
            if assembled is not None:
                assembled.close()
                uploads.discard(request.user, upload_id)

    def _create(self, request, files):
        form = StoryForm(request.data, files)
        if not form.is_valid():
            caption_error = form.errors.get("caption")
            if caption_error:
                return Response({"detail": caption_error[0]}, status=400)
            return Response({"detail": "That file couldn't be used. Choose a photo or a video."}, status=400)
        data = form.cleaned_data
        if not data["image"] and not data["video"]:
            return Response({"detail": "Choose a photo or a video for your story."}, status=400)
        story = Story(author=request.user, caption=(data["caption"] or "").strip(), visibility=data["visibility"])
        try:
            if data["video"]:
                story.set_video(
                    data["video"], poster=data["poster"], duration=data["duration"],
                    start=data["trim_start"], end=data["trim_end"],
                )
            else:
                story.set_image(data["image"])
        except Unusable:
            raise
        except Exception:
            return Response({"detail": "That photo couldn't be read. Try a JPEG, PNG or HEIC."}, status=400)
        story.save()
        story_notify.story_posted(story)
        return Response(
            {"story": serialize.story(request, story, request.user), "stories": _tray(request)},
            status=status.HTTP_201_CREATED,
        )


class Person(APIView):
    """Everything `username` has up right now — the viewer's payload."""

    def get(self, request, username):
        author = get_object_or_404(User, username=username)
        stories = list(Story.objects.for_viewer(request.user).filter(author=author).order_by("created_at"))
        if not stories:
            return Response({"detail": "Nothing here any more."}, status=404)
        profile = Profile.of(author)
        seen = set(request.user.story_views.filter(story__in=stories).values_list("story_id", flat=True))
        return Response({
            "person": serialize.person(request, author, request.user),
            "name": "Your story" if author.pk == request.user.pk else profile.name,
            "start": next((i for i, s in enumerate(stories) if s.pk not in seen and s.author_id != request.user.pk), 0),
            "emoji": serialize.emoji_choices(),
            "max_seconds": MAX_VIDEO_SECONDS,
            "stories": [serialize.story(request, s, request.user) for s in stories],
        })


class StoryDetail(APIView):
    def delete(self, request, pk):
        story = get_object_or_404(Story, pk=pk)
        if story.author_id != request.user.pk:
            return Response({"detail": "Only its author can take a story down."}, status=403)
        story.take_down()
        return Response({"stories": _tray(request)})


class Seen(APIView):
    def post(self, request, pk):
        story = get_object_or_404(Story.objects.for_viewer(request.user), pk=pk)
        story.seen_by(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class React(APIView):
    def post(self, request, pk):
        story = get_object_or_404(Story.objects.for_viewer(request.user), pk=pk)
        left = StoryReaction.toggle(story, request.user, request.data.get("emoji", ""))
        story_notify.story_reacted(story, request.user, left)
        tally = story.reactions.values("emoji").annotate(n=Count("id")).order_by("-n")
        return Response({
            "my_emoji": left or "",
            "reactions": [{"emoji": r["emoji"], "count": r["n"]} for r in tally],
        })
