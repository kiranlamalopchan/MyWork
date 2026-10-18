"""Reporting rules shared by the website and API."""

from django.contrib.auth import get_user_model
from django.http import Http404
from django.shortcuts import get_object_or_404

from .models import Kind

REPORT_RECEIVED = "Thanks — it's been reported and will be reviewed within 24 hours."


def report_target(kind, pk):
    from apps.noticeboard.models import Comment, Notice
    from apps.stories.models import Story

    model = {
        Kind.NOTICE: Notice, Kind.COMMENT: Comment,
        Kind.STORY: Story, Kind.USER: get_user_model(),
    }.get(kind)
    if model is None:
        raise Http404
    return get_object_or_404(model, pk=pk)
