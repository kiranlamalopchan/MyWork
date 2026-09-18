from django import forms

from apps.moderation.filter import REFUSED, objectionable

from .models import MAX_CAPTION


class StoryForm(forms.Form):
    """A photo or a video, and a line under it. One of the two is required —
    which one is decided in the view, where the message can say so."""

    image = forms.ImageField(required=False)
    video = forms.FileField(required=False)
    # The frame the phone grabbed from the video, for the tile.
    poster = forms.ImageField(required=False)
    # How long the phone measured the video to be, believed only where the
    # server has no ffprobe to measure it itself.
    duration = forms.FloatField(required=False, min_value=0)
    # The part of a long video to keep, in seconds from its start — what
    # the composer's trimmer was left at. Both or neither.
    trim_start = forms.FloatField(required=False, min_value=0)
    trim_end = forms.FloatField(required=False, min_value=0)
    caption = forms.CharField(max_length=MAX_CAPTION, required=False)

    def clean_caption(self):
        caption = (self.cleaned_data.get("caption") or "").strip()
        if objectionable(caption):
            raise forms.ValidationError(REFUSED)
        return caption
