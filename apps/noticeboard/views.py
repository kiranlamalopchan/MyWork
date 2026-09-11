"""
The notice board: one wall everyone reads, and only ever your own to change.

Reading is deliberately unfiltered — the whole point is that a notice reaches
everyone. Writing is the opposite: every editing view starts from
`Notice.editable_by(request.user)`, so another person's notice is simply not
found rather than found-and-refused.
"""

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from . import notify
from .forms import CommentForm, NoticeForm
from .models import (
    Comment, CommentReaction, Emoji, Notice, Reaction,
)

# How many notices a page of the board carries.
PER_PAGE = 20

# How many notices the hub shows before pointing at the full board. The board
# is what you read on the way past the apps, so it is deliberately two: the
# hub fetches two rather than fetching more and hiding the rest, which is the
# only kind of hiding that actually costs less to serve.
HUB_LIMIT = 2

# How much of a person's board history their profile carries. A profile is a
# glance at who somebody is, not an archive of everything they ever said.
PROFILE_LIMIT = 10

# How much of a thread stays open. A busy notice shouldn't push the next one
# off the screen, so the newest few stay and the rest fold away behind a line
# you can tap. It is the newest that stay rather than the oldest, which is
# what keeps a comment you just wrote in front of you.
COMMENTS_SHOWN = 3
REPLIES_SHOWN = 2


def decorate(notices, user):
    """
    Hang everything the board template needs off each notice.

    Ownership, your own emoji and the reaction tally are all decided here, in
    one place, off data that was already prefetched — the template only ever
    reads what it is handed, and never has to ask the database mid-render.
    """
    for notice in notices:
        _mark(notice, user)
        notice.comment_list = notice.thread()
        notice.older_comments, notice.recent_comments = _fold(
            notice.comment_list, COMMENTS_SHOWN
        )
        for comment in notice.comments.all():
            _mark(comment, user)
            comment.older_replies, comment.recent_replies = _fold(
                comment.reply_list, REPLIES_SHOWN
            )
    return notices


def _fold(items, keep):
    """
    Split a thread into the part that folds away and the part that stays.

    Returns (older, recent). Keeping the tail rather than the head is the
    whole point: whatever was just written is in `recent`, so nobody posts a
    comment and then has to go looking for it behind a fold.
    """
    cut = max(len(items) - keep, 0)
    return items[:cut], items[cut:]


def _mark(item, user):
    """The part a notice and a comment are shown the same way: yours, and how
    the room answered it."""
    item.is_mine = item.author_id == user.pk
    item.my_emoji = item.emoji_of(user)
    item.groups = item.reaction_groups()
    item.who_reacted = item.reactor_summary(user)
    return item


def recent_for_hub(user):
    """The slice of the board the landing page carries, plus the full count."""
    total = Notice.objects.count()
    return decorate(list(Notice.visible()[:HUB_LIMIT]), user), total


def board_context(request, **extra):
    """
    Everything `_board.html` needs, wherever it is rendered — the hub, the
    full board, or somebody's profile. One place, so a page that shows the
    board can never be missing the form or the emoji menu that goes with it.
    """
    context = {
        "comment_form": CommentForm(),
        "form": NoticeForm(),
        "emoji_choices": Emoji.choices,
        # On a rejected post this is a POST to the create URL, which is no
        # place to send anyone back to — keep the page the writer came from.
        "next_url": _safe_next(request, request.get_full_path()),
    }
    context.update(extra)
    return context


def _safe_next(request, fallback):
    """
    Where to go back to after posting.

    The form carries the page it was posted from so a notice written on the
    hub lands back on the hub, and the + button carries it in the query
    string. Either way it is checked against this host first — a redirect
    target is never trusted just because it arrived from the browser.
    """
    target = request.POST.get("next") or request.GET.get("next") or ""
    if target and url_has_allowed_host_and_scheme(
        target, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return target
    return fallback


def _page_holding(pk):
    """
    Which page of the board a given notice is on, or None if there is no such
    notice.

    A notification points at one thing and has to land on it. The board is
    paginated, so a link to a notice from last week is a link to an anchor
    that is not on the page — you arrive at the top of today and never learn
    what you were told about. Counting how many notices are newer than this
    one says which page it fell onto, and the count moves as the board does,
    so the link keeps working as the notice sinks.
    """
    try:
        notice = Notice.objects.only("created_at").get(pk=pk)
    except (Notice.DoesNotExist, ValueError, TypeError):
        return None
    newer = Notice.objects.filter(created_at__gt=notice.created_at).count()
    return newer // PER_PAGE + 1


@login_required
def board(request, form=None):
    """
    The full board. Everyone's notices, newest first.

    `form` is passed in by the create view when a post failed validation, so
    the writer gets their text back with the error on it instead of an empty
    box and a lost sentence.

    `?notice=<pk>` is how a notification arrives: it asks for whichever page
    that notice is on rather than the first. An explicit `?page=` still wins,
    because that is somebody paging by hand and their choice outranks a link's.
    """
    page = request.GET.get("page") or _page_holding(request.GET.get("notice"))
    page_obj = Paginator(Notice.visible(), PER_PAGE).get_page(page)
    decorate(page_obj.object_list, request.user)

    return render(request, "noticeboard/board.html", board_context(
        request,
        page_obj=page_obj,
        notices=page_obj,
        form=form or NoticeForm(),
    ))


@login_required
def notice_compose(request):
    """
    The full-page version of the composer.

    The + button links here and app.js intercepts the click to open the same
    form in a dialog. Without JavaScript the link simply works, which is why
    the modal never has to be the only way to post.
    """
    return render(request, "noticeboard/notice_form.html", {
        "form": NoticeForm(),
        "notice": None,
        "next_url": _safe_next(request, ""),
    })


@require_POST
@login_required
def notice_create(request):
    form = NoticeForm(request.POST)

    if not form.is_valid():
        # Re-render the full board rather than redirecting: a redirect would
        # drop both the error and what was typed.
        return board(request, form=form)

    notice = form.save(commit=False)
    notice.author = request.user
    notice.save()

    # After the save, never inside it: a board that wouldn't accept a notice
    # because a push service was down would be the wrong way round.
    notify.notice_posted(notice)

    messages.success(request, "Posted to the board.")
    return redirect(_safe_next(request, reverse("notices:board")))


@login_required
def notice_edit(request, pk):
    # Only ever your own — someone else's is a 404, not a 403.
    notice = get_object_or_404(Notice.editable_by(request.user), pk=pk)

    if request.method == "POST":
        form = NoticeForm(request.POST, instance=notice)
        if form.is_valid():
            form.save()
            messages.success(request, "Notice updated.")
            return redirect(_safe_next(request, reverse("notices:board")))
        messages.error(request, "Please fix the error below.")
    else:
        form = NoticeForm(instance=notice)

    return render(request, "noticeboard/notice_form.html", {
        "form": form,
        "notice": notice,
        "next_url": request.GET.get("next", ""),
    })


@require_POST
@login_required
def notice_delete(request, pk):
    notice = get_object_or_404(Notice.editable_by(request.user), pk=pk)
    notice.delete()
    messages.success(request, "Notice removed.")
    return redirect(_safe_next(request, reverse("notices:board")))


# ---------------------------------------------------------------------------
# Reactions and comments — anyone may add, only your own is yours to remove
# ---------------------------------------------------------------------------

def _back_to(request, notice, anchor=None):
    """
    Where a reaction or comment returns you to.

    The anchor rides along, so the page comes back at the comment you were
    answering — or at the notice you were reading — rather than at the top of
    the board.
    """
    return f"{_safe_next(request, reverse('notices:board'))}#{anchor or f'notice-{notice.pk}'}"


@require_POST
@login_required
def notice_react(request, pk):
    # Reacting to other people's notices is the point, so this is the whole
    # board — not the editable-by-you slice the writing views use.
    notice = get_object_or_404(Notice, pk=pk)
    # What they are left with: an emoji, or None if that tap took it back.
    left = Reaction.toggle(notice, request.user, request.POST.get("emoji", ""))
    notify.notice_reacted(notice, request.user, left)
    return redirect(_back_to(request, notice))


@require_POST
@login_required
def comment_react(request, pk):
    comment = get_object_or_404(
        Comment.objects.select_related("notice", "author"), pk=pk
    )
    left = CommentReaction.toggle(comment, request.user, request.POST.get("emoji", ""))
    notify.comment_reacted(comment, request.user, left)
    return redirect(_back_to(request, comment.notice, anchor=f"comment-{comment.pk}"))


@require_POST
@login_required
def comment_create(request, pk):
    """
    A comment on a notice, or a reply to one of its comments.

    Which of the two it is comes down to `parent`, and that is resolved
    against this notice's own comments — so a reply cannot be posted onto a
    thread somewhere else on the board by editing the form.
    """
    notice = get_object_or_404(Notice, pk=pk)
    parent = Comment.under(notice, request.POST.get("parent"))
    form = CommentForm(request.POST)

    if not form.is_valid():
        messages.error(request, "Write something before replying.")
        return redirect(_back_to(request, notice))

    comment = form.save(commit=False)
    comment.notice = notice
    comment.parent = parent
    comment.author = request.user
    comment.save()

    notify.comment_posted(comment)

    return redirect(_back_to(request, notice, anchor=f"comment-{comment.pk}"))


@require_POST
@login_required
def comment_delete(request, pk):
    # Only ever your own comment, whoever's notice it sits under.
    comment = get_object_or_404(Comment.editable_by(request.user), pk=pk)
    notice = comment.notice
    # Deleting a comment takes its replies with it: they answered something
    # that is no longer there, and read as non-sequiturs on their own.
    comment.delete()
    return redirect(_back_to(request, notice))


# ---------------------------------------------------------------------------
# Who is behind the numbers
# ---------------------------------------------------------------------------

@login_required
def notice_reactors(request, pk):
    """Who reacted to a notice, and with what."""
    notice = get_object_or_404(
        Notice.objects.select_related("author", "author__profile")
        .prefetch_related("reactions__user__profile"),
        pk=pk,
    )
    return _reactors_page(request, notice, notice.body)


@login_required
def comment_reactors(request, pk):
    """The same list, for a comment."""
    comment = get_object_or_404(
        Comment.objects.select_related("author", "author__profile", "notice")
        .prefetch_related("reactions__user__profile"),
        pk=pk,
    )
    return _reactors_page(request, comment, comment.body)


def _reactors_page(request, item, quoted):
    """
    The list behind a tally, for a notice or a comment alike.

    Each row carries the user themselves, not a copy of their name and
    colour: the face is drawn by the same `{% avatar %}` tag the board uses,
    so somebody who has set a photo is shown wearing it here too.
    """
    groups = [
        {
            "emoji": emoji,
            "people": [
                {
                    "user": user,
                    "username": user.get_username(),
                    "is_me": user.pk == request.user.pk,
                }
                for user in users
            ],
        }
        for emoji, users in item.reaction_people()
    ]

    return render(request, "noticeboard/reactors.html", {
        "item": item,
        "quoted": quoted,
        "groups": groups,
        "total": item.reaction_total(),
        "mine": item.emoji_of(request.user),
        "back": _safe_next(request, reverse("notices:board")),
    })


@login_required
def person(request, username):
    """
    Somebody's profile: who they are on the board, and what they have posted.

    Their notices are rendered by the same partial the board uses, so a
    profile is a view of the board filtered to one person rather than a
    second, thinner way of showing a notice that would need keeping in step.
    """
    people = get_user_model().objects.annotate(
        notice_count=Count("notices", distinct=True),
        comment_count=Count("comments", distinct=True),
    )
    profile = get_object_or_404(people, username=username)

    notices = decorate(
        list(Notice.visible().filter(author=profile)[:PROFILE_LIMIT]), request.user
    )

    return render(request, "noticeboard/person.html", board_context(
        request,
        profile=profile,
        notices=notices,
        is_me=profile.pk == request.user.pk,
        # What the board did back: reactions on their notices and on their
        # comments are the same compliment, so they are counted as one.
        received=(
            Reaction.objects.filter(notice__author=profile).count()
            + CommentReaction.objects.filter(comment__author=profile).count()
        ),
        given=(
            Reaction.objects.filter(user=profile).count()
            + CommentReaction.objects.filter(user=profile).count()
        ),
    ))
