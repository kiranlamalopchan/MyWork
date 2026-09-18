"""
The pages and POSTs behind blocking and reporting on the site. Mounted by
the project under /safety/. The app does the same through apps.api.
"""

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from .models import Block, Kind, Reason, Report

User = get_user_model()


def _back(request, fallback):
    target = request.POST.get("next") or request.GET.get("next") or ""
    if target and url_has_allowed_host_and_scheme(
        target, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return target
    return fallback


def _is_fetch(request):
    return request.headers.get("X-Requested-With") == "fetch" or "application/json" in request.headers.get("Accept", "")


def rules(request):
    """The community rules — public, and linked from the way in."""
    return render(request, "moderation/rules.html")


@login_required
@require_POST
def block(request, username):
    them = get_object_or_404(User, username=username, is_active=True)
    if them.pk == request.user.pk:
        return redirect(_back(request, reverse("home")))
    Block.block(request.user, them)
    messages.success(request, f"{them.get_username()} is blocked. You won't see each other's posts, and they can't send you a request.")
    if _is_fetch(request):
        return JsonResponse({"blocked": True})
    return redirect(_back(request, reverse("moderation:blocked")))


@login_required
@require_POST
def unblock(request, username):
    them = get_object_or_404(User, username=username)
    Block.unblock(request.user, them)
    messages.success(request, f"{them.get_username()} is unblocked.")
    if _is_fetch(request):
        return JsonResponse({"blocked": False})
    return redirect(_back(request, reverse("moderation:blocked")))


@login_required
def blocked(request):
    """Everyone you have blocked, each with a way back."""
    rows = Block.objects.filter(blocker=request.user).select_related("blocked", "blocked__profile")
    return render(request, "moderation/blocked.html", {"blocks": rows})


def _target(kind, pk):
    from apps.noticeboard.models import Comment, Notice
    from apps.stories.models import Story
    model = {Kind.NOTICE: Notice, Kind.COMMENT: Comment, Kind.STORY: Story, Kind.USER: User}.get(kind)
    if model is None:
        raise Http404
    return get_object_or_404(model, pk=pk)


@login_required
def report(request):
    """
    Flag a notice, a comment, a story or a person. GET shows the short
    form; POST files it. `kind` and `id` say what; `reason` and an
    optional `note` say why.
    """
    kind = request.POST.get("kind") or request.GET.get("kind") or ""
    pk = request.POST.get("id") or request.GET.get("id") or ""
    if kind not in Kind.values or not pk.isdigit():
        raise Http404
    target = _target(kind, int(pk))
    who = target if kind == Kind.USER else getattr(target, "author", None)
    if who is not None and who.pk == request.user.pk:
        messages.info(request, "You can't report your own.")
        return redirect(_back(request, reverse("home")))

    if request.method == "POST":
        reason = request.POST.get("reason") or Reason.OTHER
        if reason not in Reason.values:
            reason = Reason.OTHER
        Report.file(request.user, kind, target, reason, request.POST.get("note", ""))
        if _is_fetch(request):
            return JsonResponse({"detail": "Thanks — it's been reported and will be reviewed within 24 hours."})
        messages.success(request, "Thanks — it's been reported and will be reviewed within 24 hours.")
        return redirect(_back(request, reverse("home")))

    quoted = ""
    if kind in (Kind.NOTICE, Kind.COMMENT):
        quoted = target.body
    elif kind == Kind.STORY:
        quoted = target.caption
    return render(request, "moderation/report.html", {
        "kind": kind,
        "target": target,
        "quoted": quoted,
        "who": who,
        "reasons": Reason.choices,
        "next": _back(request, reverse("home")),
        "already_blocked": who is not None and Block.is_blocking(request.user, who),
    })
