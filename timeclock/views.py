"""
Clock-in dashboard, timesheet, and the workplace/preference screens behind them.

Every queryset in here is filtered by request.user before anything else, so one
signed-in user can never reach another's shifts or workplaces — the object
lookups 404 rather than 403 so they don't even confirm the row exists.
"""

import calendar as pycalendar
import zoneinfo
from datetime import date, datetime, time, timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .forms import BreakFormSet, ShiftForm, TimePreferenceForm, WorkplaceForm
from .models import (
    color_css,
    Pay,
    Shift,
    TimePreference,
    Workplace,
    fortnight_start,
    month_start,
    next_month_start,
    week_start,
)

# Remembers the workplace you picked last so the next shift starts on the
# right one without asking again.
SESSION_WORKPLACE = "timeclock_workplace_id"

# The dial is scaled to a 10-hour day, so a long shift still has ring left to
# fill instead of sitting pinned at full. Past this the shift is almost
# certainly a forgotten clock-out, and the dashboard says so.
SHIFT_TARGET_HOURS = 10

# How far the phone's clock may sit from the server's before we stop
# believing it. Generous on purpose: a phone in any timezone reports the same
# instant as the server, so a gap this large means the clock itself is wrong,
# not that the user is travelling.
CLIENT_CLOCK_TOLERANCE_HOURS = 24


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_now(request):
    """
    The instant the phone says it is, taken from the hidden fields app.js
    stamps onto every clock form.

    `client_time` is a full ISO string with the phone's UTC offset, so a
    correctly-set phone in any timezone resolves to the same instant the
    server would have used; it only diverges when the phone's own clock is
    off, which is exactly the case we're being asked to follow. Absurd values
    still fall back to the server so a badly wrong clock can't file a shift
    in the wrong decade.

    Also records the phone's IANA zone, which the middleware uses to render
    every page in the user's local time.
    """
    tz_name = (request.POST.get("client_tz") or "").strip()[:64]
    if tz_name:
        try:
            zoneinfo.ZoneInfo(tz_name)
        except Exception:
            tz_name = ""
        else:
            pref = TimePreference.for_user(request.user)
            if pref.timezone_name != tz_name:
                pref.timezone_name = tz_name
                pref.save(update_fields=["timezone_name"])

    raw = (request.POST.get("client_time") or "").strip()
    if not raw:
        return None

    try:
        stamp = datetime.fromisoformat(raw)
    except ValueError:
        return None

    if stamp.tzinfo is None:
        # Without an offset we can't place the instant; don't guess.
        return None

    if abs(stamp - timezone.now()) > timedelta(hours=CLIENT_CLOCK_TOLERANCE_HOURS):
        return None

    return stamp


def _shifts_for(user):
    """Base queryset: this user's shifts, with everything the totals need."""
    return (
        Shift.objects.filter(user=user)
        .select_related("workplace")
        .prefetch_related("breaks")
    )


def _day_bounds(start_date, end_date_exclusive):
    """Aware datetimes spanning [start_date, end_date_exclusive) in local time."""
    tz = timezone.get_current_timezone()
    return (
        timezone.make_aware(datetime.combine(start_date, time.min), tz),
        timezone.make_aware(datetime.combine(end_date_exclusive, time.min), tz),
    )


def _total_worked(shifts):
    return sum((s.worked_duration for s in shifts), timedelta())


def _in_order(day_shifts):
    """
    One day's shifts in the order they were actually worked.

    The timesheet reads newest day first, and inside a day that ordering is
    wrong: a day is a sequence — you clocked in, you finished, you started
    again — and reading it bottom-up makes you reconstruct the day backwards.
    So the days stay newest first and their shifts run earliest first.

    Each one is told where it sits in the day and how long since the one
    before it ended, which is what lets a day worth several shifts be drawn as
    a run rather than as three identical rows that happen to be adjacent.
    """
    ordered = sorted(day_shifts, key=lambda shift: shift.clock_in)

    previous_end = None
    for position, shift in enumerate(ordered, start=1):
        shift.seq = position
        # No gap before the first, and none after one still running — there is
        # no end to measure from until it has one.
        shift.gap_before = (
            shift.clock_in - previous_end
            if previous_end and shift.clock_in > previous_end
            else None
        )
        previous_end = shift.clock_out

    return ordered


def _period_figures(user, start_date, end_date_exclusive, workplace=None):
    """
    Worked time and what it earned, for shifts starting inside the range.

    Both come out of one pass over the same shifts, because they are read
    together on every screen that shows either — and because each shift has
    to be priced by its own workplace's rate and withholding. Two jobs on
    different rates add up; they never average.

    The pay half is None when nothing in the window has a rate to price it
    with. That is not the same as $0.00, and the templates say so.
    """
    start, end = _day_bounds(start_date, end_date_exclusive)
    qs = _shifts_for(user).filter(clock_in__gte=start, clock_in__lt=end)
    if workplace:
        qs = qs.filter(workplace=workplace)

    worked = timedelta()
    gross = tax = 0.0
    priced = False
    withheld = False

    for shift in qs:
        worked += shift.worked_duration
        pay = shift.pay
        if pay is None:
            continue
        priced = True
        withheld = withheld or shift.workplace.withholds
        gross += pay.gross
        tax += pay.tax

    if not priced:
        return worked, None

    money = Pay(round(gross, 2), round(tax, 2), round(gross - tax, 2))
    # Carried alongside so a screen can tell "nothing withheld" from "we were
    # never told what is withheld" and prompt for the missing setting.
    return worked, {"pay": money, "withheld": withheld}


def _period_total(user, start_date, end_date_exclusive, workplace=None):
    """Net worked time for shifts starting inside the given date range."""
    return _period_figures(user, start_date, end_date_exclusive, workplace)[0]


def hours_this_week(user):
    """
    Net worked time so far this week, over the account's own week start.

    Public because the profile page shows it too: one reading of "this week"
    for the whole of MyWork, rather than a second sum that rounds or starts
    the week differently from the timesheet it is meant to agree with.
    """
    pref = TimePreference.for_user(user)
    start = week_start(timezone.localdate(), pref.week_starts_on)
    return _period_total(user, start, start + timedelta(days=7))


def _limit_for(user, workplace, today=None):
    """
    How one workplace is tracking against its own cap, or None if it has none.

    Only that workplace's shifts count, over that workplace's own week or
    fortnight cycle — hours at another job never eat into this limit.
    """
    if workplace is None or not workplace.has_limit:
        return None

    today = today or timezone.localdate()
    start, end = workplace.limit_window(today)

    cap = timedelta(hours=float(workplace.hours_limit))
    used = _period_total(user, start, end, workplace)
    pct = min(used / cap * 100, 100) if cap else 0

    return {
        "workplace": workplace,
        "cap": cap,
        "used": used,
        "remaining": max(cap - used, timedelta()),
        "over": max(used - cap, timedelta()),
        "percent": round(pct, 1),
        "period_label": workplace.period_label,
        "period_start": start,
        # Amber once the last tenth is in sight, red once it's gone.
        "state": "over" if used >= cap else ("close" if pct >= 90 else "ok"),
    }


def _limits_for(user, workplace=None):
    """
    The limit cards to show: just this workplace's when one is filtered to,
    otherwise one per workplace that has a cap — each counted separately.
    """
    if workplace is not None:
        limit = _limit_for(user, workplace)
        return [limit] if limit else []

    today = timezone.localdate()
    return [
        limit
        for w in Workplace.objects.filter(
            user=user, is_archived=False, hours_limit__isnull=False
        )
        if (limit := _limit_for(user, w, today))
    ]


def _summary(user, workplace=None):
    """
    The week / fortnight / month figures shown as cards on the timesheet.

    Every one of the three runs from a start the user chose. Filtered to a
    workplace, they follow that job's own cycle so the cards line up with the
    limit bar underneath them; unfiltered, they follow the account's.
    """
    pref = TimePreference.for_user(user)
    cycle = workplace or pref
    today = timezone.localdate()
    tomorrow = today + timedelta(days=1)

    w_start = week_start(today, cycle.week_starts_on)
    f_start = fortnight_start(today, cycle.fortnight_anchor)
    m_start = month_start(today, cycle.month_starts_on)

    week, week_pay = _period_figures(user, w_start, w_start + timedelta(days=7), workplace)
    fortnight, fortnight_pay = _period_figures(
        user, f_start, f_start + timedelta(days=14), workplace
    )
    # Month-to-date, not the whole cycle: the figure is what's been worked so
    # far, the way the week and fortnight cards read.
    month, month_pay = _period_figures(user, m_start, tomorrow, workplace)

    return {
        "today": _period_total(user, today, tomorrow, workplace),
        "week": week,
        "week_pay": week_pay,
        "week_start": w_start,
        "week_end": w_start + timedelta(days=6),
        "fortnight": fortnight,
        "fortnight_pay": fortnight_pay,
        "fortnight_start": f_start,
        "fortnight_end": f_start + timedelta(days=13),
        "month": month,
        "month_pay": month_pay,
        "month_start": m_start,
        "month_end": next_month_start(today, cycle.month_starts_on) - timedelta(days=1),
        "pref": pref,
        "limits": _limits_for(user, workplace),
    }


def _selected_workplace(request, workplaces):
    """
    The workplace the clock-in button will use: whatever was picked this
    session, else the default, else the only one there is.
    """
    picked = request.GET.get("workplace") or request.session.get(SESSION_WORKPLACE)
    if picked:
        for w in workplaces:
            if str(w.pk) == str(picked):
                return w
    for w in workplaces:
        if w.is_default:
            return w
    return workplaces[0] if workplaces else None


# ---------------------------------------------------------------------------
# Dashboard / clock
# ---------------------------------------------------------------------------

@login_required
def dashboard(request):
    """
    The clock screen. Shows one of three states — ready to clock in, working,
    or on a break — and the buttons that move between them.
    """
    workplaces = list(Workplace.objects.filter(user=request.user, is_archived=False))
    shift = Shift.open_for(request.user)

    if shift:
        selected = shift.workplace
    else:
        selected = _selected_workplace(request, workplaces)
        if selected:
            request.session[SESSION_WORKPLACE] = selected.pk

    running_break = shift.running_break if shift else None

    # Completed breaks are handed to the browser as a fixed number of seconds;
    # only the running one has to keep counting there.
    banked_break = timedelta()
    if shift:
        for b in shift.breaks.all():
            if b.break_end:
                banked_break += b.break_end - b.break_start

    today = timezone.localdate()
    today_shifts = list(
        _shifts_for(request.user).filter(
            clock_in__range=_day_bounds(today, today + timedelta(days=1))
        )
    )

    return render(request, "timeclock/dashboard.html", {
        "shift": shift,
        "running_break": running_break,
        "workplaces": workplaces,
        "selected_workplace": selected,
        "today_shifts": today_shifts,
        # Counts the shift in progress too, so this agrees with the week
        # figure beside it rather than sitting on 0m all morning.
        "today_total": _total_worked(today_shifts),
        "summary": _summary(request.user),
        # The bar under the clock is for the job in front of you, not a
        # total of every job.
        "limit": _limit_for(request.user, selected),
        "target_hours": SHIFT_TARGET_HOURS,
        # Flags a shift that's run past the target — nearly always someone who
        # walked off without clocking out, so it gets a visible prompt rather
        # than quietly piling up hours.
        "long_shift": bool(
            shift and shift.total_duration > timedelta(hours=SHIFT_TARGET_HOURS)
        ),
        # Timestamps the live ticker counts from, plus the server's own clock
        # so a phone with a skewed clock still shows the right elapsed time.
        "server_now_iso": timezone.now().isoformat(),
        "clock_in_iso": shift.clock_in.isoformat() if shift else "",
        "break_start_iso": running_break.break_start.isoformat() if running_break else "",
        "banked_break_seconds": int(banked_break.total_seconds()),
    })


@require_POST
@login_required
def clock_in(request):
    workplace = None
    picked = request.POST.get("workplace")
    if picked:
        workplace = Workplace.objects.filter(
            pk=picked, user=request.user, is_archived=False
        ).first()

    if workplace is None:
        messages.error(request, "Pick a workplace before clocking in.")
        return redirect("timeclock:dashboard")

    try:
        Shift.clock_in_now(request.user, workplace, when=_client_now(request))
    except ValidationError as exc:
        messages.error(request, "; ".join(exc.messages))
    else:
        request.session[SESSION_WORKPLACE] = workplace.pk
        messages.success(request, f"Clocked in at {timezone.localtime():%-I:%M %p}.")

    return redirect("timeclock:dashboard")


def _open_shift_or_redirect(request):
    shift = Shift.open_for(request.user)
    if shift is None:
        messages.error(request, "You're not clocked in.")
    return shift


@require_POST
@login_required
def start_break(request):
    shift = _open_shift_or_redirect(request)
    if shift:
        try:
            shift.start_break(when=_client_now(request))
        except ValidationError as exc:
            messages.error(request, "; ".join(exc.messages))
        else:
            messages.success(request, f"Break started at {timezone.localtime():%-I:%M %p}.")
    return redirect("timeclock:dashboard")


@require_POST
@login_required
def end_break(request):
    shift = _open_shift_or_redirect(request)
    if shift:
        try:
            shift.end_break(when=_client_now(request))
        except ValidationError as exc:
            messages.error(request, "; ".join(exc.messages))
        else:
            messages.success(request, "Back on the clock.")
    return redirect("timeclock:dashboard")


@require_POST
@login_required
def clock_out(request):
    shift = _open_shift_or_redirect(request)
    if shift:
        try:
            shift.clock_out_now(when=_client_now(request))
        except ValidationError as exc:
            messages.error(request, "; ".join(exc.messages))
        else:
            # Land on the finished shift so the totals are the first thing seen.
            return redirect("timeclock:shift_detail", pk=shift.pk)
    return redirect("timeclock:dashboard")


# ---------------------------------------------------------------------------
# Timesheet
# ---------------------------------------------------------------------------

@login_required
def timesheet(request):
    workplaces = list(Workplace.objects.filter(user=request.user))
    workplace = None
    picked = request.GET.get("workplace")
    if picked:
        workplace = next((w for w in workplaces if str(w.pk) == picked), None)

    qs = _shifts_for(request.user)
    if workplace:
        qs = qs.filter(workplace=workplace)

    page_obj = Paginator(qs, 20).get_page(request.GET.get("page"))

    # Group the page's rows by day so the list reads like a calendar.
    days = []
    for shift in page_obj:
        day = timezone.localtime(shift.clock_in).date()
        if not days or days[-1]["date"] != day:
            days.append({"date": day, "shifts": [], "total": timedelta()})
        days[-1]["shifts"].append(shift)
        days[-1]["total"] += shift.worked_duration

    # The page arrives newest first, which is right for the days and wrong
    # inside them: a day reads forwards.
    for day in days:
        day["shifts"] = _in_order(day["shifts"])
        day["is_run"] = len(day["shifts"]) > 1

    return render(request, "timeclock/timesheet.html", {
        "page_obj": page_obj,
        "days": days,
        "workplaces": workplaces,
        "workplace": workplace,
        "summary": _summary(request.user, workplace),
    })


# A workplace that took a sliver of the day still has to be visible on a line
# a few dozen pixels wide. Anything under this is widened to it, and the space
# is taken back off the longer jobs so the line still adds up to the day.
MIN_SHARE_PCT = 6.0


def _share_out(shares):
    """
    Percentages that add to 100 with nothing too thin to see.

    Widening a sliver has to come out of somewhere, or the line stops being
    the day. It comes off whatever is above the floor, in proportion, so the
    jobs that lose width are the ones that can afford to.
    """
    if len(shares) < 2:
        return [100.0] * len(shares)

    lifted = [max(share, MIN_SHARE_PCT) for share in shares]
    owed = sum(lifted) - 100.0
    if owed <= 0:
        return lifted

    spare = sum(share - MIN_SHARE_PCT for share in lifted if share > MIN_SHARE_PCT)
    if spare <= 0:
        # Every job is at the floor already: split the line evenly and admit
        # that at this width the difference between them can't be drawn.
        return [100.0 / len(lifted)] * len(lifted)

    return [
        share - (share - MIN_SHARE_PCT) / spare * owed if share > MIN_SHARE_PCT else share
        for share in lifted
    ]


def _day_shape(day_shifts):
    """
    How one day divides between the jobs worked on it, as a single line.

    The line is the day's work, end to end, and each workplace holds the share
    of it that it was worked for: six hours at one job and two at another is
    three quarters of the line against one quarter, which is the comparison
    you actually want to make when you glance at a month. Busiest first, so
    the line reads as a ranking as well as a split.

    Returns {"track", "lead", "legend"} — the segments, the colour of whichever
    job took most of the day, and what worked where, busiest first.
    """
    worked = {}
    names = {}
    for shift in day_shifts:
        hue = shift.workplace.color if shift.workplace else None
        names[hue] = shift.workplace.name if shift.workplace else "No workplace"
        worked[hue] = worked.get(hue, 0) + shift.worked_duration.total_seconds()

    if not worked:
        return {"track": [], "lead": None, "legend": []}

    order = sorted(worked.items(), key=lambda pair: (-pair[1], str(pair[0])))
    total = sum(seconds for _, seconds in order)
    if total > 0:
        shares = _share_out([seconds / total * 100 for _, seconds in order])
    else:
        # Every shift on the day is still zero-length (clocked in a moment
        # ago). Show the jobs evenly rather than dividing by nothing.
        shares = [100.0 / len(order)] * len(order)

    track = []
    at = 0.0
    for i, ((hue, _), share) in enumerate(zip(order, shares)):
        # The last segment is pinned to the end so rounding can't leave a
        # hairline of empty line showing past the final colour.
        width = 100.0 - at if i == len(order) - 1 else share
        track.append({
            "css": color_css(hue),
            "left": f"{at:.4g}",
            "width": f"{width:.4g}",
        })
        at += width

    return {
        "track": track,
        "lead": color_css(order[0][0]),
        "legend": [(names[hue], hue, seconds) for hue, seconds in order],
    }


@login_required
def calendar_month(request):
    """
    Month grid with the hours worked on each day, and the shifts behind
    whichever day is tapped.
    """
    today = timezone.localdate()

    try:
        year = int(request.GET.get("year", today.year))
        month = int(request.GET.get("month", today.month))
        first = date(year, month, 1)
    except (TypeError, ValueError):
        # A hand-edited query string shouldn't 500 the page.
        first = today.replace(day=1)
        year, month = first.year, first.month

    last = date(year, month, pycalendar.monthrange(year, month)[1])

    # One query for the month; the grid and the day panel both read this list
    # rather than going back to the database per cell.
    shifts = list(
        _shifts_for(request.user).filter(
            clock_in__range=_day_bounds(first, last + timedelta(days=1))
        )
    )

    totals = {}
    by_day = {}
    for shift in shifts:
        day = timezone.localtime(shift.clock_in).date()
        totals[day] = totals.get(day, timedelta()) + shift.worked_duration
        by_day.setdefault(day, []).append(shift)

    # How each day divides between its jobs, and what worked where this month.
    shapes = {day: _day_shape(day_shifts) for day, day_shifts in by_day.items()}

    month_by_place = {}
    for shape in shapes.values():
        for name, hue, seconds in shape["legend"]:
            entry = month_by_place.setdefault(name, {"name": name, "hue": hue, "seconds": 0})
            entry["seconds"] += seconds

    # The grid starts on whichever day the user's week starts on, so the
    # columns line up with the week the totals are counted over.
    first_weekday = TimePreference.for_user(request.user).week_starts_on
    weeks = []
    for week in pycalendar.Calendar(firstweekday=first_weekday).monthdatescalendar(year, month):
        weeks.append([
            {
                "date": day,
                "in_month": day.month == month,
                "is_today": day == today,
                "total": totals.get(day),
                # Where in the day each shift sat, on a midnight-to-midnight
                # line, and the colour of whichever job took most of it.
                "track": shapes[day]["track"] if day in shapes else [],
                "lead": shapes[day]["lead"] if day in shapes else None,
                "places": [
                    name for name, _, _ in (shapes[day]["legend"] if day in shapes else [])
                ],
            }
            for day in week
        ])

    selected, selected_shifts = None, []
    raw_day = request.GET.get("day")
    if raw_day:
        try:
            selected = date.fromisoformat(raw_day)
        except ValueError:
            selected = None
    if selected:
        selected_shifts = _in_order(
            [s for s in shifts if timezone.localtime(s.clock_in).date() == selected]
        )

    return render(request, "timeclock/calendar.html", {
        "weeks": weeks,
        # Column headings have to follow the same rotation as the grid.
        "weekday_labels": [
            {
                "letter": pycalendar.day_abbr[(first_weekday + i) % 7][0],
                "name": pycalendar.day_name[(first_weekday + i) % 7],
            }
            for i in range(7)
        ],
        "month_date": first,
        # The key under the grid: without it the colours are decoration.
        # Only the jobs actually worked this month, busiest first.
        "legend": sorted(
            (
                {**entry, "css": color_css(entry["hue"]),
                 "worked": timedelta(seconds=entry["seconds"])}
                for entry in month_by_place.values()
            ),
            key=lambda entry: -entry["seconds"],
        ),
        "month_total": sum(totals.values(), timedelta()),
        "worked_days": len(totals),
        "prev_month": first - timedelta(days=1),
        "next_month": last + timedelta(days=1),
        "selected": selected,
        "selected_shifts": selected_shifts,
        "selected_total": sum((s.worked_duration for s in selected_shifts), timedelta()),
    })


@login_required
def shift_detail(request, pk):
    shift = get_object_or_404(
        _shifts_for(request.user).prefetch_related(Prefetch("breaks")), pk=pk
    )
    return render(request, "timeclock/shift_detail.html", {"shift": shift})


def _new_shift_initial(request, workplaces):
    """
    Sensible starting times for a shift being typed in.

    A day picked from the calendar prefills a 9-to-5 on that day; today
    prefills the last eight hours up to now, which is the shape of "I forgot
    to clock in this morning". Either way the pickers open on the right date
    instead of making someone scroll a year.
    """
    now = timezone.localtime()
    today = now.date()

    day = today
    raw = request.GET.get("day")
    if raw:
        try:
            day = date.fromisoformat(raw)
        except ValueError:
            day = today
    # Nothing was worked tomorrow; a hand-edited date falls back to today.
    day = min(day, today)

    if day == today:
        end = now
        start = end - timedelta(hours=8)
    else:
        tz = timezone.get_current_timezone()
        start = timezone.make_aware(datetime.combine(day, time(9, 0)), tz)
        end = start + timedelta(hours=8)

    return {
        "clock_in": start,
        "clock_out": end,
        "workplace": _selected_workplace(request, workplaces),
    }


@login_required
def shift_create(request):
    """
    Add a shift by hand, for a day the clock was never started on.

    Deliberately the same form and break rows as editing, so a forgotten day
    is filled in the same way a wrong time is corrected. ShiftForm refuses a
    future time or one that overlaps a shift already recorded, which are the
    two ways an entry from memory goes wrong.
    """
    shift = Shift(user=request.user)
    workplaces = list(Workplace.objects.filter(user=request.user, is_archived=False))

    if request.method == "POST":
        form = ShiftForm(request.POST, instance=shift, user=request.user)
        formset = BreakFormSet(request.POST, instance=shift)

        if form.is_valid():
            # The formset checks its breaks against the shift's span, so it
            # has to see the times being saved now.
            formset.instance.clock_in = form.cleaned_data["clock_in"]
            formset.instance.clock_out = form.cleaned_data.get("clock_out")

        if form.is_valid() and formset.is_valid():
            shift = form.save(commit=False)
            shift.user = request.user
            # No clock-out means the shift is still running — the fix for
            # realising mid-shift that you never clocked in.
            shift.status = Shift.Status.COMPLETED if shift.clock_out else Shift.Status.WORKING
            shift.save()
            formset.save()

            if shift.is_open and shift.breaks.filter(break_end__isnull=True).exists():
                shift.status = Shift.Status.ON_BREAK
                shift.save(update_fields=["status", "updated_at"])

            messages.success(request, "Shift added to your timesheet.")
            return redirect("timeclock:shift_detail", pk=shift.pk)

        messages.error(request, "Please fix the errors below.")
    else:
        form = ShiftForm(
            instance=shift, user=request.user,
            initial=_new_shift_initial(request, workplaces),
        )
        formset = BreakFormSet(instance=shift)

    return render(request, "timeclock/shift_form.html", {
        "shift": None, "form": form, "formset": formset,
    })


@login_required
def shift_edit(request, pk):
    """
    Correct a shift's times, and add, fix or remove its breaks. Every total is
    recomputed from these timestamps on the next read, so nothing else needs
    updating once this saves.
    """
    shift = get_object_or_404(_shifts_for(request.user), pk=pk)

    if request.method == "POST":
        form = ShiftForm(request.POST, instance=shift, user=request.user)
        formset = BreakFormSet(request.POST, instance=shift)

        if form.is_valid():
            # The formset checks breaks against the shift's span, so it has to
            # see the times being saved now, not the ones already stored.
            formset.instance.clock_in = form.cleaned_data["clock_in"]
            formset.instance.clock_out = form.cleaned_data.get("clock_out")

        if form.is_valid() and formset.is_valid():
            shift = form.save(commit=False)
            # A shift that has been given a clock-out is finished, and one
            # that's had it cleared is back to running.
            if shift.clock_out:
                shift.status = Shift.Status.COMPLETED
            elif shift.status == Shift.Status.COMPLETED:
                shift.status = Shift.Status.WORKING
            shift.save()
            formset.save()

            # An open break decides the status regardless of the above.
            if shift.is_open:
                shift.status = (
                    Shift.Status.ON_BREAK if shift.breaks.filter(break_end__isnull=True).exists()
                    else Shift.Status.WORKING
                )
                shift.save(update_fields=["status", "updated_at"])

            messages.success(request, "Shift updated.")
            return redirect("timeclock:shift_detail", pk=shift.pk)

        messages.error(request, "Please fix the errors below.")
    else:
        form = ShiftForm(instance=shift, user=request.user)
        formset = BreakFormSet(instance=shift)

    return render(request, "timeclock/shift_form.html", {
        "shift": shift, "form": form, "formset": formset,
    })


@require_POST
@login_required
def shift_delete(request, pk):
    shift = get_object_or_404(Shift.objects.filter(user=request.user), pk=pk)
    shift.delete()
    messages.success(request, "Shift deleted.")
    return redirect("timeclock:timesheet")


# ---------------------------------------------------------------------------
# Workplaces
# ---------------------------------------------------------------------------

@login_required
def workplace_list(request):
    workplaces = Workplace.objects.filter(user=request.user, is_archived=False)
    return render(request, "timeclock/workplace_list.html", {"workplaces": workplaces})


@login_required
def workplace_create(request):
    if request.method == "POST":
        form = WorkplaceForm(request.POST, user=request.user)
        if form.is_valid():
            workplace = form.save(commit=False)
            workplace.user = request.user
            # The very first workplace becomes the default; there's nothing
            # else for the clock-in button to pick.
            first = not Workplace.objects.filter(user=request.user, is_archived=False).exists()
            workplace.is_default = False
            workplace.save()
            if form.cleaned_data.get("is_default") or first:
                workplace.make_default()
            messages.success(request, f"Added {workplace.name}.")
            return redirect("timeclock:workplaces")
    else:
        form = WorkplaceForm(user=request.user)

    return render(request, "timeclock/workplace_form.html", {"form": form, "workplace": None})


@login_required
def workplace_edit(request, pk):
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user, is_archived=False)

    if request.method == "POST":
        form = WorkplaceForm(request.POST, instance=workplace, user=request.user)
        if form.is_valid():
            workplace = form.save(commit=False)
            wants_default = form.cleaned_data.get("is_default")
            workplace.is_default = False
            workplace.save()
            if wants_default:
                workplace.make_default()
            messages.success(request, "Workplace updated.")
            return redirect("timeclock:workplaces")
    else:
        form = WorkplaceForm(instance=workplace, user=request.user)

    return render(request, "timeclock/workplace_form.html", {"form": form, "workplace": workplace})


@require_POST
@login_required
def workplace_delete(request, pk):
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user, is_archived=False)

    if Shift.objects.filter(user=request.user, workplace=workplace, status__in=Shift.OPEN_STATUSES).exists():
        messages.error(request, "You're clocked in at that workplace. Clock out first.")
        return redirect("timeclock:workplaces")

    name = workplace.name
    if workplace.delete_or_archive() == "archived":
        messages.success(request, f"Removed {name}. Its past shifts are still on your timesheet.")
    else:
        messages.success(request, f"Deleted {name}.")
    return redirect("timeclock:workplaces")


@require_POST
@login_required
def workplace_make_default(request, pk):
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user, is_archived=False)
    workplace.make_default()
    request.session[SESSION_WORKPLACE] = workplace.pk
    messages.success(request, f"{workplace.name} is now your default.")
    return redirect("timeclock:workplaces")


# ---------------------------------------------------------------------------
# Preferences / menu
# ---------------------------------------------------------------------------

@login_required
def preferences(request):
    """
    The hours-limit screen. Each cap belongs to a workplace and is edited
    there, so this lists them side by side and keeps only the settings that
    genuinely span every workplace.
    """
    pref = TimePreference.for_user(request.user)

    if request.method == "POST":
        form = TimePreferenceForm(request.POST, instance=pref)
        if form.is_valid():
            form.save()
            messages.success(request, "Preferences saved.")
            return redirect("timeclock:preferences")
    else:
        form = TimePreferenceForm(instance=pref)

    return render(request, "timeclock/preferences.html", {
        "form": form,
        "limits": _limits_for(request.user),
        "workplaces": Workplace.objects.filter(user=request.user, is_archived=False),
    })


@login_required
def more(request):
    """Menu page for everything that doesn't earn a slot in the tab bar."""
    return render(request, "timeclock/more.html", {
        "workplace_count": Workplace.objects.filter(user=request.user, is_archived=False).count(),
    })
