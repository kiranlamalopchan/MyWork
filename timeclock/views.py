"""
Clock-in dashboard, timesheet, and the workplace/preference screens behind them.

Every queryset in here is filtered by request.user before anything else, so one
signed-in user can never reach another's shifts or workplaces — the object
lookups 404 rather than 403 so they don't even confirm the row exists.
"""

import calendar as pycalendar
import mimetypes
import zoneinfo
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.db.models import Prefetch
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_POST

from accounts.models import Profile

from . import payslip as payslip_reader
from . import statement as statement_pdf
from .forms import (
    BreakFormSet,
    PayslipForm,
    PayslipUploadForm,
    ShiftForm,
    TimePreferenceForm,
    WorkplaceForm,
)
from .models import (
    color_css,
    Payment,
    Pay,
    Payslip,
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


def hm_words(worked):
    """A timedelta as "5h 19m", matching the `hm` filter the templates use."""
    total = int(worked.total_seconds())
    hours, minutes = total // 3600, (total % 3600) // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    return f"{hours}h" if hours else f"{minutes}m"


def _unpaid_shifts(workplace):
    """
    Every finished shift here that no payment has covered yet.

    Two kinds of cover to clear: a sweep, which settled everything before some
    instant, and a run, which settled one stretch and nothing either side of
    it. A shift is owed unless one of them has it.
    """
    shifts = workplace.shifts.filter(status=Shift.Status.COMPLETED)

    swept_to = workplace.paid_through
    if swept_to:
        shifts = shifts.filter(clock_in__gte=swept_to)

    runs = workplace.paid_runs()
    return [
        shift
        for shift in shifts.prefetch_related("breaks")
        if not any(start <= shift.clock_in < end for start, end in runs)
    ]


def _run(workplace, shifts, start=None, end=None, closed=False):
    """
    One stretch of unpaid work, priced.

    `payable` is the important one: a run can be settled from its payday, not
    from the day after it. You are paid on the Wednesday — that is what payday
    means — and a run that only opens for payment on Thursday leaves you
    looking at hours you have already been paid for on the one day you most
    want them gone.
    """
    worked = sum((shift.worked_duration for shift in shifts), timedelta())
    hours = worked.total_seconds() / 3600
    payday = workplace.payday_for(end) if end else None
    return {
        "start": start,
        "end": end,
        "payday": payday,
        "worked": worked,
        "hours": hours,
        "shifts": len(shifts),
        "pay": workplace.pay_for(hours) if hours else None,
        "closed": closed,
        "payable": closed or (payday is not None and payday <= timezone.localdate()),
    }


def _unpaid_days(workplace):
    """
    The unpaid work at one workplace, a day at a time, newest first.

    Some jobs pay you on a day of their choosing for work up to some earlier
    point — a Sunday shift paid for on the Monday, or the Sunday after that,
    and always for what you did before. "Everything up to now" is the wrong
    answer there: it clears the shift you are standing in the middle of.

    So each day carries what would be settled if the money covered up to and
    including it — the running total from the oldest unpaid day forwards, not
    that day on its own. That is the figure to check against a payslip.
    """
    by_day = {}
    for shift in _unpaid_shifts(workplace):
        day = timezone.localtime(shift.clock_in).date()
        by_day.setdefault(day, []).append(shift)

    days = []
    running = timedelta()
    for day in sorted(by_day):
        worked = sum((s.worked_duration for s in by_day[day]), timedelta())
        running += worked
        hours = running.total_seconds() / 3600
        days.append({
            "day": day,
            # The exclusive end a payment covering through this day settles to,
            # so it speaks the same language as a pay run's end date.
            "end": day + timedelta(days=1),
            "worked": worked,
            "shifts": sorted(by_day[day], key=lambda s: s.clock_in),
            "clears": running,
            "clears_hours": hours,
            "clears_pay": workplace.pay_for(hours) if hours else None,
        })

    days.reverse()
    return days


def _pay_state(workplace):
    """
    Where this job stands: what is still owed, and how it is divided up.

    Two shapes, because two jobs pay in two different ways.

    A job that pays whenever it likes has one open run — everything since the
    last payment — and it ends when the money arrives and you say so. That is
    the notepad: one running figure, wiped when you are paid.

    A job that pays on a cycle has periods that close on their own. The one
    containing today is still running; every closed period before it that
    nobody has paid for is listed on its own, because they are separate
    payments that may well arrive separately, and clearing one must not clear
    the other.
    """
    shifts = _unpaid_shifts(workplace)

    if not workplace.pays_on_a_cycle:
        return {
            "workplace": workplace,
            "scheduled": False,
            "since": workplace.paid_through,
            "current": _run(workplace, shifts),
            "due": [],
            "worked": sum((s.worked_duration for s in shifts), timedelta()),
            "last_payment": next(iter(workplace.payments.all()), None),
        }

    this_start, this_end = workplace.pay_window()

    # Each shift belongs to the period its clock-in falls in.
    buckets = {}
    for shift in shifts:
        day = timezone.localtime(shift.clock_in).date()
        buckets.setdefault(workplace.pay_window(day), []).append(shift)

    current = _run(workplace, buckets.pop((this_start, this_end), []),
                   this_start, this_end)

    # Closed and unpaid, most recently ended first. A period nobody worked is
    # not a period anybody is owed for, so it is not listed.
    due = [
        _run(workplace, rows, window[0], window[1], closed=True)
        for window, rows in sorted(buckets.items(), reverse=True)
        if window[1] <= this_start and rows
    ]

    return {
        "workplace": workplace,
        "scheduled": True,
        "since": workplace.paid_through,
        "current": current,
        "due": due,
        "worked": sum((s.worked_duration for s in shifts), timedelta()),
        "last_payment": next(iter(workplace.payments.all()), None),
    }


def unpaid_total(user):
    """Hours owed across every active workplace — what the More row shows."""
    places = Workplace.objects.filter(user=user, is_archived=False).prefetch_related(
        "payments"
    )
    return sum((_pay_state(w)["worked"] for w in places), timedelta())


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


def _paid_line_in(workplace, start, end):
    """
    The most recent payment line falling inside [start, end), or None.

    Where the counting starts again. Everything clocked in before a payment
    has been settled and put away, so what is left of the period is what has
    been worked since — which is the figure somebody watching a cap actually
    wants after being paid.
    """
    window_start, window_end = _day_bounds(start, end)
    lines = [
        payment.covers_through
        for payment in workplace.payments.all()
        if window_start <= payment.covers_through < window_end
    ]
    return max(lines) if lines else None


def _worked_since(user, workplace, since, until):
    """Net worked time at one workplace for shifts starting in [since, until)."""
    return _total_worked(
        _shifts_for(user).filter(
            workplace=workplace, clock_in__gte=since, clock_in__lt=until
        )
    )


def _limit_for(user, workplace, today=None):
    """
    How one workplace is tracking against its own cap, or None if it has none.

    Only that workplace's shifts count, over that workplace's own week or
    fortnight cycle — hours at another job never eat into this limit.

    Being paid restarts the count. The headline figure is the hours worked
    since the last payment landed, so the day the money arrives the number
    goes back to zero and the next stretch can be watched from a clean start
    — the same wiped notepad the pay screen keeps.

    What it does *not* do is forget. A cap of 48 hours a fortnight is 48 in
    the fortnight whether or not somebody paid you halfway through it, so the
    hours before the line stay in the bar, stay in the period total, and
    still turn the card amber and then red on their own. The reset is a place
    to count from, never a second allowance.
    """
    if workplace is None or not workplace.has_limit:
        return None

    today = today or timezone.localdate()
    start, end = workplace.limit_window(today)

    cap = timedelta(hours=float(workplace.hours_limit))
    used = _period_total(user, start, end, workplace)

    # The period's own hours, split either side of the last payment in it.
    paid_at = _paid_line_in(workplace, start, end)
    since = (
        _worked_since(user, workplace, paid_at, _day_bounds(start, end)[1])
        if paid_at
        else used
    )
    settled = max(used - since, timedelta())

    pct = min(used / cap * 100, 100) if cap else 0
    settled_pct = min(settled / cap * 100, 100) if cap else 0

    return {
        "workplace": workplace,
        "cap": cap,
        "used": used,
        "remaining": max(cap - used, timedelta()),
        "over": max(used - cap, timedelta()),
        "percent": round(pct, 1),
        # The two halves of the bar: what a payment has already closed off,
        # and what has been worked since. They sum to `percent`.
        "settled": settled,
        "settled_percent": round(settled_pct, 1),
        "since": since,
        "since_percent": round(max(pct - settled_pct, 0), 1),
        "paid_at": paid_at,
        "period_label": workplace.period_label,
        "period_start": start,
        # Amber once the last tenth is in sight, red once it's gone — measured
        # on the whole period, because that is what the cap is measured on.
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
        ).prefetch_related("payments")
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
    workplaces = list(
        Workplace.objects.filter(user=request.user, is_archived=False)
        .prefetch_related("payments")
    )
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
    workplaces = list(
        Workplace.objects.filter(user=request.user, is_archived=False)
        .prefetch_related("payments")
    )

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
        "payslip_count": Payslip.objects.filter(workplace__user=request.user).count(),
        "payslips_to_check": sum(
            1
            for slip in Payslip.objects.filter(
                workplace__user=request.user, confirmed=False
            )
        ),
        "unpaid_total": unpaid_total(request.user),
    })


@login_required
def payments(request):
    """
    What each job still owes you, and the button that clears it.

    One card per workplace and never one total across them: two jobs pay on
    two different days, and a single figure would be cleared by whichever of
    them paid first, taking the other's hours with it.
    """
    places = (
        Workplace.objects.filter(user=request.user, is_archived=False)
        .prefetch_related("payments")
    )
    owing = [_pay_state(workplace) for workplace in places]

    return render(request, "timeclock/payments.html", {
        "owing": owing,
        "owed_total": sum((row["worked"] for row in owing), timedelta()),
    })


@login_required
@require_POST
def payment_record(request, pk):
    """
    Mark this workplace paid, up to a point.

    A job that pays whenever it likes is settled up to now — the money is in
    your hand, so everything worked before this moment is covered. A job on a
    cycle is settled up to the end of the period being paid for, which is sent
    with the form: paying for the fortnight that closed last Wednesday must
    not also clear the one that has been running since Thursday.

    Nothing is deleted either way. A line is drawn, the hours before it stop
    being counted as owed, and the timesheet behind it is untouched.
    """
    workplace = get_object_or_404(
        Workplace.objects.prefetch_related("payments"), pk=pk, user=request.user
    )
    state = _pay_state(workplace)

    run = _run_being_paid(request, state)
    if run is None:
        # Not a failure to parse so much as a run that isn't owed: already
        # settled, or still being worked. Saying which is more use than
        # saying the form was wrong.
        messages.info(
            request,
            f"That pay run at {workplace.name} isn't outstanding — it's either "
            "already marked paid, or it hasn't finished yet.",
        )
        return redirect("timeclock:payments")
    if run["hours"] <= 0:
        messages.info(request, f"Nothing outstanding at {workplace.name}.")
        return redirect("timeclock:payments")

    Payment.objects.create(
        workplace=workplace,
        # A sweep for a job with no cycle; one run for a job that has one.
        covers_from=_midnight(run["start"]) if run["start"] else None,
        # The run's own end, unless that is still in the future — being paid
        # on the Wednesday settles the run up to now, and an evening shift
        # after the money arrives is honestly still owed.
        covers_through=(
            min(_midnight(run["end"]), timezone.now()) if run["end"] else timezone.now()
        ),
        hours=round(run["hours"], 2),
        amount=round(run["pay"].gross, 2) if run["pay"] else None,
    )
    messages.success(
        request, f"{hm_words(run['worked'])} at {workplace.name} marked paid."
    )
    return redirect("timeclock:payments")


def _midnight(day):
    """A local date as the instant it begins."""
    return timezone.make_aware(
        datetime.combine(day, time.min), timezone.get_current_timezone()
    )


def _run_being_paid(request, state):
    """
    Which stretch of work the form is settling.

    A job with no cycle has only one, so there is nothing to name. A job with
    one sends the end date of the run being paid, and it has to be a run that
    is actually owed — a period still running has not finished being worked,
    and one already settled must not be settled twice.
    """
    raw = (request.POST.get("through") or "").strip()

    if not state["scheduled"]:
        # No cut-off named: the money covered everything, which is the usual
        # case and the one the card's own button sends.
        if not raw:
            return state["current"]
        try:
            end = date.fromisoformat(raw)
        except ValueError:
            return None
        # Only the work before that cut-off, priced on its own.
        cutoff = _midnight(end)
        covered = [
            shift
            for shift in _unpaid_shifts(state["workplace"])
            if shift.clock_in < cutoff
        ]
        return _run(state["workplace"], covered, end=end) if covered else None

    try:
        end = date.fromisoformat(raw)
    except ValueError:
        return None

    payable = list(state["due"])
    if state["current"]["payable"]:
        payable.append(state["current"])
    return next((run for run in payable if run["end"] == end), None)


@login_required
def payment_choose(request, pk):
    """
    What did this payment cover?

    For a job that pays on its own schedule for work up to some earlier point.
    Rather than a date field to type into, it lists the unpaid days as they
    actually happened — the record the employer is paying against — and each
    one says what marking it would clear. You find the last day the money
    covered and tap that.
    """
    workplace = get_object_or_404(
        Workplace.objects.prefetch_related("payments"), pk=pk, user=request.user
    )
    if workplace.pays_on_a_cycle:
        # A job with runs already answers this question with its runs.
        return redirect("timeclock:payments")

    return render(request, "timeclock/payment_choose.html", {
        "workplace": workplace,
        "days": _unpaid_days(workplace),
        "state": _pay_state(workplace),
    })


@login_required
@require_POST
def payment_undo(request, pk):
    """
    Take the last line back out.

    A button that resets a number to zero has to be undoable, or the first
    mis-tap costs somebody the record of hours they have not been paid for.
    """
    workplace = get_object_or_404(
        Workplace.objects.prefetch_related("payments"), pk=pk, user=request.user
    )
    last = workplace.payments.order_by("-created_at").first()

    if last is None:
        messages.info(request, f"No payments recorded at {workplace.name}.")
    else:
        last.delete()
        messages.success(
            request, f"Last payment at {workplace.name} undone — those hours are owed again."
        )
    return redirect("timeclock:payments")


# ---------------------------------------------------------------------------
#  The month statement
# ---------------------------------------------------------------------------

def _covering_payment(shift, payments):
    """
    The payment that settled this shift, or None if nothing has yet.

    Two shapes of cover, the same two `_unpaid_shifts` clears against: a sweep,
    which settled everything before an instant, and a run, which settled one
    stretch and nothing either side of it. The earliest one that covers the
    shift is the one that paid for it — a later payment covering the same
    ground did not pay for it twice.
    """
    covering = [
        payment
        for payment in payments
        if (
            payment.covers_from is None
            and shift.clock_in < payment.covers_through
        )
        or (
            payment.covers_from is not None
            and payment.covers_from <= shift.clock_in < payment.covers_through
        )
    ]
    return min(covering, key=lambda p: p.created_at) if covering else None


def _day_words(when):
    """A date as "Sun 6 Sep" — the shape the screens use, no leading zero."""
    local = timezone.localtime(when) if hasattr(when, "tzinfo") else when
    return f"{local:%a} {local.day} {local:%b}"


def _statement_month(year, month):
    """The [first, next) dates of a month, or 404 for a month that isn't one."""
    try:
        first = date(year, month, 1)
    except ValueError as exc:
        raise Http404("No such month.") from exc
    return first, next_month_start(first, 1)


@login_required
def statement(request, year, month):
    """
    One month as a PDF, to hold next to the money.

    A payment lands in a bank account as one line: a date and an amount. This
    is the other side of it — what turned up, what it said it covered, and
    every shift behind it — so the two can be checked off against each other.

    It matters most straight after being paid, because marking a payment
    received sets the running total back to zero. The hours are still on the
    timesheet, but the figure you were watching is gone; a statement is that
    figure kept, on the day it was true.

    Scoped to one workplace with ?workplace=<pk> when a single job is being
    reconciled, and to everything otherwise.
    """
    first, last = _statement_month(year, month)
    start, end = _day_bounds(first, last)

    workplace = None
    if raw := (request.GET.get("workplace") or "").strip():
        workplace = get_object_or_404(Workplace, pk=raw, user=request.user)

    shifts = (
        _shifts_for(request.user)
        .filter(status=Shift.Status.COMPLETED, clock_in__gte=start, clock_in__lt=end)
        .order_by("clock_in")
    )
    if workplace:
        shifts = shifts.filter(workplace=workplace)

    # Every payment against the jobs in view, not just the month's — a shift
    # worked in September may well have been settled in October, and the Paid
    # column should say so rather than leave it looking outstanding.
    all_payments = Payment.objects.filter(workplace__user=request.user)
    if workplace:
        all_payments = all_payments.filter(workplace=workplace)
    by_workplace = {}
    for payment in all_payments.select_related("workplace"):
        by_workplace.setdefault(payment.workplace_id, []).append(payment)

    # ---- the shifts ----------------------------------------------------
    rows = []
    worked = timedelta()
    totals = {}
    estimated = False

    for shift in shifts:
        worked += shift.worked_duration
        paid_by = _covering_payment(shift, by_workplace.get(shift.workplace_id, []))
        rows.append({
            "date": _day_words(shift.clock_in),
            "workplace": shift.workplace.name if shift.workplace else "No workplace",
            "hue": shift.workplace.color if shift.workplace else None,
            "start": timezone.localtime(shift.clock_in).strftime("%I:%M %p").lstrip("0"),
            "finish": timezone.localtime(shift.clock_out).strftime("%I:%M %p").lstrip("0"),
            "break": statement_pdf.hm(shift.total_break) if shift.total_break else "—",
            "hours": statement_pdf.hm(shift.worked_duration),
            "paid": (
                f"{timezone.localtime(paid_by.created_at).day} "
                f"{timezone.localtime(paid_by.created_at):%b}"
                if paid_by else "—"
            ),
        })

        # Priced by its own job's rate, never by an average of two.
        place = shift.workplace
        key = place.pk if place else None
        bucket = totals.setdefault(key, {
            "workplace": place.name if place else "No workplace",
            "hue": place.color if place else None,
            "worked": timedelta(), "gross": 0.0, "tax": 0.0,
            "priced": False, "withholds": False,
        })
        bucket["worked"] += shift.worked_duration
        if (pay := shift.pay) is not None:
            estimated = True
            bucket["priced"] = True
            # $0.00 withheld and "nobody has told us what is withheld" are
            # different answers, and only one of them can be printed as a
            # take-home figure.
            bucket["withholds"] = bucket["withholds"] or place.withholds
            bucket["gross"] += pay.gross
            bucket["tax"] += pay.tax

    # ---- what arrived --------------------------------------------------
    received = (
        all_payments.filter(created_at__gte=start, created_at__lt=end)
        .select_related("workplace")
        .order_by("created_at")
    )
    payment_rows = []
    received_hours = 0.0
    received_amount = 0.0
    priced_any = False

    for payment in received:
        received_hours += float(payment.hours)
        if payment.amount is not None:
            priced_any = True
            received_amount += float(payment.amount)
        opens = (
            f"{timezone.localtime(payment.covers_from).day} "
            f"{timezone.localtime(payment.covers_from):%b}"
            if payment.covers_from else "everything"
        )
        closes = (
            f"{timezone.localtime(payment.covers_through).day} "
            f"{timezone.localtime(payment.covers_through):%b}"
        )
        payment_rows.append({
            "received": _day_words(payment.created_at),
            "workplace": payment.workplace.name,
            "hue": payment.workplace.color,
            "covers": f"{opens} – {closes}" if payment.covers_from else f"up to {closes}",
            "hours": f"{float(payment.hours):g}h",
            "amount": float(payment.amount) if payment.amount is not None else None,
        })

    me = Profile.of(request.user)
    scope = workplace.name if workplace else "All workplaces"
    label = first.strftime("%B %Y")

    pdf = statement_pdf.build({
        "month_label": label,
        "subtitle": f"{me.name} · {scope}",
        "payments": payment_rows,
        "received_hours": f"{received_hours:g}h",
        "received_amount": received_amount if priced_any else None,
        "shifts": rows,
        "worked_hours": statement_pdf.hm(worked),
        "totals": [
            {
                "workplace": row["workplace"],
                "hue": row["hue"],
                "hours": statement_pdf.hm(row["worked"]),
                "gross": round(row["gross"], 2) if row["priced"] else None,
                "tax": round(row["tax"], 2) if row["withholds"] else None,
                "net": (
                    round(row["gross"] - row["tax"], 2)
                    if row["priced"] and row["withholds"] else None
                ),
            }
            for row in totals.values()
        ],
        "estimated": estimated,
        "before_tax": any(
            row["priced"] and not row["withholds"] for row in totals.values()
        ),
        "footnote": (
            f"Prepared {timezone.localdate().strftime('%d %B %Y').lstrip('0')} from "
            "your own MyWork timesheet. It records what you entered, not what an "
            "employer has declared — keep it beside the payslip rather than "
            "instead of it."
        ),
        "filename": _statement_filename(first, workplace),
    })

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = (
        f'attachment; filename="{_statement_filename(first, workplace)}"'
    )
    return response


def _statement_filename(first, workplace):
    """Sorts by date in a downloads folder, and says which job it is for."""
    who = f"-{slugify(workplace.name)}" if workplace else ""
    return f"MyWork-statement{who}-{first:%Y-%m}.pdf"


# ---------------------------------------------------------------------------
#  Payslips — the employer's own statement, checked against yours
# ---------------------------------------------------------------------------

def _payslip_or_404(request, pk):
    """One of this user's payslips, by way of the workplace that owns it."""
    return get_object_or_404(
        Payslip.objects.select_related("workplace"),
        pk=pk, workplace__user=request.user,
    )


def _reconcile(payslip):
    """
    The payslip against your own record of the same days.

    This is the whole reason for uploading one. The slip says how many hours
    they paid for; the timesheet says how many you worked. Where those two
    disagree is the only place a conversation with an employer can start, and
    it is worth putting a figure and a dollar value on rather than a feeling
    that the pay looked light.

    None when the slip does not say which days it covers — there is nothing
    to compare it against until it does.
    """
    if not payslip.covers_a_period:
        return None

    workplace = payslip.workplace
    start, end = _day_bounds(payslip.period_start, payslip.period_end + timedelta(days=1))
    shifts = list(
        _shifts_for(workplace.user).filter(
            workplace=workplace, status=Shift.Status.COMPLETED,
            clock_in__gte=start, clock_in__lt=end,
        ).order_by("clock_in")
    )

    recorded = _total_worked(shifts)
    recorded_hours = (
        Decimal(recorded.total_seconds()) / Decimal(3600)
    ).quantize(Decimal("0.0001"))

    gap = None if payslip.hours is None else payslip.hours - recorded_hours
    rate = payslip.rate or workplace.hourly_rate
    return {
        "shifts": shifts,
        "days": len({timezone.localtime(s.clock_in).date() for s in shifts}),
        "recorded": recorded,
        "recorded_hours": recorded_hours,
        "slip_hours": payslip.hours,
        "gap": gap,
        # Under an hour and a half either way is a rounding difference and a
        # break policy, not a shortfall worth chasing.
        "agrees": None if gap is None else abs(gap) <= Decimal("0.02"),
        "short": None if gap is None else gap < Decimal("-0.02"),
        "gap_money": (
            None if gap is None or rate is None
            else (gap * rate).quantize(Decimal("0.01"))
        ),
    }


@login_required
def payslips(request):
    """
    Every payslip you have uploaded, newest first.

    Grouped by nothing and sorted by period, because what you come here for is
    the last one — and after that, the one from the fortnight somebody is
    arguing about.
    """
    rows = (
        Payslip.objects.filter(workplace__user=request.user)
        .select_related("workplace")
    )
    places = list(
        Workplace.objects.filter(user=request.user, is_archived=False)
    )
    return render(request, "timeclock/payslips.html", {
        "payslips": rows,
        "workplaces": places,
        "unchecked": sum(1 for row in rows if row.needs_checking),
    })


@login_required
def payslip_upload(request, pk):
    """
    Take a payslip for this workplace and read what is on it.

    The reading is never the last word. What comes out of a photograph is a
    good guess, and it goes straight to a screen that shows every figure in a
    box you can correct — because "exactly" is a promise only the person
    holding the paper can make. Nothing is trusted anywhere else in the app
    until that screen is confirmed.
    """
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user)

    if request.method != "POST":
        return render(request, "timeclock/payslip_upload.html", {
            "workplace": workplace, "form": PayslipUploadForm(),
        })

    form = PayslipUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        return render(request, "timeclock/payslip_upload.html", {
            "workplace": workplace, "form": form,
        })

    upload = form.cleaned_data["file"]
    try:
        text, how = payslip_reader.text_from(upload)
        read = payslip_reader.parse(text)
    except payslip_reader.Unreadable as problem:
        # Failing to read it is not a reason to lose it. The slip is kept with
        # its figures empty, and typing them in works from there exactly as
        # confirming a reading would — which is a far better answer than
        # sending somebody back to the file picker with nothing.
        messages.warning(
            request, f"{problem} The payslip is saved — type its figures in below."
        )
        text = ""
        how = "pdf" if (upload.name or "").lower().endswith(".pdf") else "photo"
        read = dict.fromkeys(
            ("period_start", "period_end", "paid_on", "hours", "rate",
             "gross", "tax", "net", "super")
        )

    # A slip that names only the day its period ended still tells you when it
    # started, if the job pays on a cycle — that is what a cycle is.
    opens = read["period_start"]
    if opens is None and read["period_end"] and workplace.pays_on_a_cycle:
        opens = workplace.pay_window(read["period_end"])[0]

    upload.seek(0)
    slip = Payslip.objects.create(
        workplace=workplace,
        file=upload,
        source=Payslip.Source.PDF if how == "pdf" else Payslip.Source.PHOTO,
        period_start=opens,
        period_end=read["period_end"],
        paid_on=read["paid_on"],
        hours=read["hours"],
        rate=read["rate"],
        gross=read["gross"],
        tax=read["tax"],
        net=read["net"],
        super_amount=read["super"],
        raw_text=text,
    )
    return redirect("timeclock:payslip_detail", pk=slip.pk)


@login_required
def payslip_detail(request, pk):
    """
    What the slip says, what your timesheet says, and the gap between them.

    The figures sit in boxes rather than in print, because the reading has to
    be correctable — and confirming them is a deliberate act, not something
    that happened while the file uploaded.
    """
    slip = _payslip_or_404(request, pk)

    if request.method == "POST":
        form = PayslipForm(request.POST, instance=slip)
        if form.is_valid():
            slip = form.save(commit=False)
            # Typed over by hand is as good as it gets, and better than what
            # any reading of a photograph can claim.
            slip.confirmed = True
            slip.save()
            messages.success(
                request,
                f"Payslip confirmed. Take-home {_dollars(slip.take_home)}."
                if slip.take_home is not None else "Payslip saved.",
            )
            return redirect("timeclock:payslip_detail", pk=slip.pk)
    else:
        form = PayslipForm(instance=slip)

    return render(request, "timeclock/payslip_detail.html", {
        "slip": slip,
        "form": form,
        "check": _reconcile(slip),
        "withheld": slip.withheld_percent,
        # Whether saving that percentage would actually change anything.
        "differs_from_saved": (
            slip.withheld_percent is not None
            and slip.workplace.tax_rate != slip.withheld_percent
        ),
    })


def _dollars(amount):
    return "—" if amount is None else f"${amount:,.2f}"


@login_required
@require_POST
def payslip_apply(request, pk):
    """
    Teach the workplace what this payslip knows.

    The withheld percentage and the hourly rate come off the paper and onto
    the job, and from then on every figure MyWork shows for it is after tax
    rather than before. This is a separate button on purpose: reading a slip
    is looking something up, and changing what the app believes about a job
    is a decision.
    """
    slip = _payslip_or_404(request, pk)
    workplace = slip.workplace
    changed = []

    if slip.withheld_percent is not None and workplace.tax_rate != slip.withheld_percent:
        workplace.tax_rate = slip.withheld_percent
        changed.append(f"withholding {slip.withheld_percent}%")
    if slip.rate is not None and workplace.hourly_rate != slip.rate:
        workplace.hourly_rate = slip.rate
        changed.append(f"rate ${slip.rate}")

    if changed:
        workplace.save(update_fields=["tax_rate", "hourly_rate"])
        messages.success(
            request,
            f"{workplace.name} updated from your payslip — {' and '.join(changed)}. "
            "Every figure for this job is now after tax.",
        )
    else:
        messages.info(request, f"{workplace.name} already matches this payslip.")
    return redirect("timeclock:payslip_detail", pk=slip.pk)


@login_required
def payslip_file(request, pk):
    """
    The stored file, to whoever it belongs to and nobody else.

    Never linked straight off the media URL. A payslip carries a full name, an
    address, a tax file figure and often a bank account, and a URL that serves
    it without asking who is holding it is a URL that can be forwarded.
    """
    slip = _payslip_or_404(request, pk)
    if not slip.file:
        raise Http404("No file was kept for this payslip.")

    kind, _ = mimetypes.guess_type(slip.file.name)
    return FileResponse(
        slip.file.open("rb"),
        content_type=kind or "application/octet-stream",
        # Shown, not downloaded: you open it to read a figure back off it.
        as_attachment=False,
        filename=f"payslip-{slip.period_end or slip.created_at.date()}"
                 f"{Path(slip.file.name).suffix}",
    )


@login_required
@require_POST
def payslip_delete(request, pk):
    """Remove a payslip and the file behind it."""
    slip = _payslip_or_404(request, pk)
    name = slip.workplace.name
    if slip.file:
        slip.file.delete(save=False)
    slip.delete()
    messages.success(request, f"Payslip removed from {name}.")
    return redirect("timeclock:payslips")
