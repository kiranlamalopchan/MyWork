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
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.template.defaultfilters import pluralize
from django.utils.text import slugify
from django.views.decorators.http import require_POST

from apps.accounts.models import Profile

from . import payslip as payslip_reader
from . import statement as statement_pdf
from .forms import (
    BreakFormSet,
    ShiftForm,
    TimePreferenceForm,
    WorkplaceForm,
)
from .models import (
    color_css,
    PayCycle,
    Payment,
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
    all_cash = True

    for shift in qs:
        worked += shift.worked_duration
        pay = shift.pay
        if pay is None:
            continue
        priced = True
        withheld = withheld or shift.workplace.withholds
        all_cash = all_cash and shift.workplace.in_cash
        gross += pay.gross
        tax += pay.tax

    if not priced:
        return worked, None

    money = Pay(round(gross, 2), round(tax, 2), round(gross - tax, 2))
    # Carried alongside so a screen can tell three things apart: tax we know,
    # tax nobody has told us about, and cash in hand — which has no tax to be
    # told about and must not be nagged for one.
    return worked, {"pay": money, "withheld": withheld, "cash": all_cash}


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
    worked = sum((s.worked_duration for s in shifts), timedelta())
    hours = worked.total_seconds() / 3600
    common = {
        "workplace": workplace,
        "since": workplace.paid_through,
        "worked": worked,
        "shifts": len(shifts),
        "owed_pay": workplace.pay_for(hours) if hours else None,
        # The oldest unpaid day: the date box accepts nothing before it,
        # since there is nothing before it left to settle.
        "earliest": min(
            (timezone.localtime(s.clock_in).date() for s in shifts), default=None
        ),
        "last_payment": next(iter(workplace.payments.all()), None),
    }

    if not workplace.pays_on_a_cycle:
        current = _run(workplace, shifts)
        return dict(
            common,
            scheduled=False,
            current=current,
            due=[],
            covers=[_covers_choice("now", "Everything up to now", current)],
        )

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

    # What the form can say a payment covered: each run that is owed, oldest
    # first — the order the money arrives in — and the one running now once
    # its payday has come.
    covers = [
        _covers_choice(
            f"run:{run['end'].isoformat()}",
            f"{run['start'].day} {run['start']:%b} \u2013 {run['payday'].day} {run['payday']:%b}",
            run,
        )
        for run in reversed(due)
    ]
    if current["payable"] and current["hours"]:
        covers.append(_covers_choice(
            f"run:{current['end'].isoformat()}",
            f"This {workplace.pay_cycle_label}, to {current['payday'].day} {current['payday']:%b}",
            current,
        ))

    return dict(common, scheduled=True, current=current, due=due, covers=covers)


def _covers_choice(value, label, run):
    """
    One answer to "what did this payment cover", with its hours on it.

    Hours only: the money is on the card above, and a phone's <select>
    clips a label long enough to carry both.
    """
    return {"value": value, "label": f"{label} \u2014 {run['hours']:.1f}h"}


def unpaid_total(user):
    """Hours owed across every active workplace — what the More row shows."""
    places = Workplace.objects.filter(user=user).prefetch_related(
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
        # The count goes back to zero on its own the day the next period
        # opens — a fortnightly cap resets every second Thursday whether or
        # not anyone does anything — and the card says which day that is.
        "period_end": end - timedelta(days=1),
        "resets_on": end,
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
            user=user, hours_limit__isnull=False
        ).prefetch_related("payments")
        if (limit := _limit_for(user, w, today))
    ]


# Which totals are worth showing, for each way of being paid.
#
# A period you are never paid over is a number with nothing to check it
# against. Paid weekly, a fortnight's hours answer no question you have; paid
# monthly, every one of the three is a step on the way to the figure that
# arrives. So the cards stop where the pay cycle does.
#
# A job that pays whenever it likes stops at the week. It has no fortnight and
# no month of its own — what is owed on it is a running total that ends when
# somebody hands you money, and that figure lives on the Pay screen. Letting
# it claim all three periods meant one such job dragged a month card onto a
# page where nothing was ever paid monthly.
CYCLE_PERIODS = {
    PayCycle.WEEK: ("week",),
    PayCycle.FORTNIGHT: ("week", "fortnight"),
    PayCycle.MONTH: ("week", "fortnight", "month"),
    PayCycle.IRREGULAR: ("week",),
}

# Widest last, so a set of periods can be ordered and its widest read off.
PERIOD_ORDER = ("week", "fortnight", "month")

PERIOD_LABELS = {"week": "This week", "fortnight": "This fortnight", "month": "This month"}


def _periods_shown(user, workplace=None):
    """
    Which totals the timesheet should carry.

    Filtered to one job, exactly the periods that job is paid over — pick
    weekly and you get the week, and nothing else is offered, because nothing
    else is ever paid to you.

    Unfiltered, the periods of the jobs you actually have, together. Two jobs
    paid two ways both need their own figure, and neither invents a period
    nobody is paid over: a weekly job beside a fortnightly one comes to a week
    and a fortnight, never a month.
    """
    if workplace is not None:
        cycles = [workplace.pay_cycle]
    else:
        cycles = [
            w.pay_cycle
            for w in Workplace.objects.filter(user=user)
        ] or [PayCycle.IRREGULAR]

    wanted = set()
    for cycle in cycles:
        wanted.update(CYCLE_PERIODS.get(cycle, CYCLE_PERIODS[PayCycle.IRREGULAR]))
    return [period for period in PERIOD_ORDER if period in wanted]


def _sole_workplace(user):
    """The user's only workplace, or None if they have more than one."""
    active = list(Workplace.objects.filter(user=user))
    return active[0] if len(active) == 1 else None


def _since_paid(workplace):
    """
    What has piled up at this job since the money last arrived.

    The notepad, as a card. There is no cycle to total over, so the only span
    that means anything is the one the payment button clears: everything not
    yet paid for. The day you are paid it reads zero and starts filling again,
    which is the whole of how a job like this is kept track of.
    """
    state = _pay_state(workplace)
    run = state["current"]
    since = state["since"]
    today = timezone.localdate()

    if since is not None:
        start = timezone.localtime(since).date()
        sub = f"since you were paid, {start.day} {start:%b}"
    else:
        unpaid = _unpaid_shifts(workplace)
        start = (
            min(timezone.localtime(s.clock_in).date() for s in unpaid)
            if unpaid else today
        )
        sub = "nothing paid yet" if not unpaid else f"from {start.day} {start:%b}"

    return {
        "key": "since_paid",
        "label": "Since you were paid",
        "total": run["worked"],
        "pay": (
            {
                "pay": run["pay"],
                "withheld": workplace.withholds,
                "cash": workplace.in_cash,
            }
            if run["pay"] else None
        ),
        "start": start,
        "end": today,
        "sub": sub,
        "pay_title": "Owed since your last payment",
    }


def _summary(user, workplace=None):
    """
    The figures shown as cards on the timesheet.

    Every one runs from a start the user chose. Filtered to a workplace, they
    follow that job's own cycle so the cards line up with the limit bar
    underneath them; unfiltered, they follow the account's.

    How many of them there are follows how you are paid — see CYCLE_PERIODS.
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

    def span(key, label, total, pay, start, end):
        return {
            "key": key, "label": label, "total": total, "pay": pay,
            "start": start, "end": end,
            "sub": f"from {start.day} {start:%b}",
            "pay_title": f"{label}\u2019s pay",
        }

    spans = {
        "week": span("week", PERIOD_LABELS["week"], week, week_pay,
                     w_start, w_start + timedelta(days=6)),
        "fortnight": span("fortnight", PERIOD_LABELS["fortnight"], fortnight,
                          fortnight_pay, f_start, f_start + timedelta(days=13)),
        "month": span("month", PERIOD_LABELS["month"], month, month_pay, m_start,
                      next_month_start(today, cycle.month_starts_on) - timedelta(days=1)),
    }

    shown = _periods_shown(user, workplace)
    cards = [spans[key] for key in shown]
    period = spans[shown[-1]]

    # A job that pays whenever it likes has no week or fortnight worth
    # showing. The figure that matters there is what has piled up since the
    # money last arrived — the one that goes to zero the day it arrives again
    # — so it replaces the cards outright.
    #
    # Only ever for one job at a time: two jobs were last paid on two
    # different days and cannot share a starting line. So it stands in when
    # the page is looking at a single such job, which includes "All" for
    # somebody who has only the one.
    solo = workplace or _sole_workplace(user)
    if solo is not None and not solo.pays_on_a_cycle:
        period = _since_paid(solo)
        cards = [period]

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
        # The cards to draw, and the one the pay breakdown is written over —
        # the longest of them, which is the period the money arrives in.
        "cards": cards,
        "period": period,
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

    That, where you are, and the hours cap you are working against. Nothing
    else: a screen you open to press one button is not the place for figures
    you read, and the timesheet is one tap away for those.
    """
    workplaces = list(
        Workplace.objects.filter(user=request.user)
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

    return render(request, "timeclock/dashboard.html", {
        "shift": shift,
        "running_break": running_break,
        "workplaces": workplaces,
        "selected_workplace": selected,
        # The one figure the clock screen keeps: the cap you are working
        # against at the job in front of you, which is what you want to know
        # before pressing the button rather than after. Today's hours and the
        # week's live on the timesheet, one tap away, and repeating them here
        # made a clock into a dashboard.
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
            pk=picked, user=request.user
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
        Workplace.objects.filter(user=request.user)
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
    """
    Your jobs — and, at the foot of them, where your own cycles begin.

    One screen for everything about where you work. How a job pays, what it
    caps you at and which cycle it counts over all live on the job itself, so
    there is one way in to each of them and no second page repeating the list.
    """
    return _workplaces_page(request)


@login_required
def workplace_create(request):
    if request.method == "POST":
        form = WorkplaceForm(request.POST, user=request.user)
        if form.is_valid():
            workplace = form.save(commit=False)
            workplace.user = request.user
            # The very first workplace becomes the default; there's nothing
            # else for the clock-in button to pick.
            first = not Workplace.objects.filter(user=request.user).exists()
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
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user)

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


@login_required
@require_POST
def workplace_payslip(request):
    """
    Reads an uploaded payslip and says what the workplace form should hold.

    The small button on the workplace form. JSON either way: the figures
    found (`fields`, keyed by the form's own boxes) with the trail of where
    each came from (`read`) and anything worth a warning (`notes`); or
    `error`, with a 400, in words for the user. Nothing is saved here —
    app.js (initPayslipFill) puts the figures in the boxes, and the form
    is sent as it always is, with the user having seen every value.
    """
    uploaded = request.FILES.get("payslip")
    if uploaded is None:
        return JsonResponse({"error": "Choose a payslip — a PDF, or a photo or screenshot of one."}, status=400)
    try:
        text = payslip_reader.read_text(uploaded)
    except payslip_reader.Unreadable as why:
        return JsonResponse({"error": str(why)}, status=400)
    slip = payslip_reader.parse(text)
    if not slip.fields():
        return JsonResponse({
            "error": "Nothing on that payslip could be made out — no rate, tax or pay period. Type them in instead.",
        }, status=400)
    return JsonResponse(slip.as_json(timezone.localdate()))


def _removable(request, pk):
    """
    The workplace being removed, and why it can't be, if it can't be.

    Clocking out first is the one hard stop: removing the job you are standing
    in the middle of a shift at would delete the shift out from under the
    running clock.
    """
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user)
    clocked_in = Shift.objects.filter(
        user=request.user, workplace=workplace, status__in=Shift.OPEN_STATUSES
    ).exists()
    return workplace, clocked_in


@login_required
def workplace_confirm_delete(request, pk):
    """
    What removing this workplace would take with it.

    A screen rather than a pop-up, because the answer is a list of counts and
    a pop-up can only hold a sentence. Everything on it is irreversible, so it
    is worth reading before it is agreed to.
    """
    workplace, clocked_in = _removable(request, pk)
    if clocked_in:
        messages.error(request, "You're clocked in at that workplace. Clock out first.")
        return redirect("timeclock:workplaces")

    return render(request, "timeclock/workplace_confirm_delete.html", {
        "workplace": workplace,
        "going": workplace.belongings(),
    })


@require_POST
@login_required
def workplace_delete(request, pk):
    """
    Remove a workplace and everything recorded against it.

    No archiving. Asked to remove a job, MyWork removes it — the shifts, the
    breaks and the payments — because a list of jobs quietly
    keeping the one you deleted is a list you stop trusting.
    """
    workplace, clocked_in = _removable(request, pk)
    if clocked_in:
        messages.error(request, "You're clocked in at that workplace. Clock out first.")
        return redirect("timeclock:workplaces")

    name = workplace.name
    going = workplace.belongings()
    workplace.remove()

    # The clock remembers which job you picked last. That one is gone.
    if str(request.session.get(SESSION_WORKPLACE)) == str(pk):
        request.session.pop(SESSION_WORKPLACE, None)

    told = [f"{going['shifts']} shift{pluralize(going['shifts'])}"] if going["shifts"] else []
    if going["payments"]:
        told.append(f"{going['payments']} payment{pluralize(going['payments'])}")

    messages.success(
        request,
        f"Removed {name} and {', '.join(told)}." if told else f"Removed {name}.",
    )
    return redirect("timeclock:workplaces")


@require_POST
@login_required
def workplace_make_default(request, pk):
    workplace = get_object_or_404(Workplace, pk=pk, user=request.user)
    workplace.make_default()
    request.session[SESSION_WORKPLACE] = workplace.pk
    messages.success(request, f"{workplace.name} is now your default.")
    return redirect("timeclock:workplaces")


# ---------------------------------------------------------------------------
# Preferences / menu
# ---------------------------------------------------------------------------

@login_required
def _workplaces_page(request, cycles=None):
    """The Workplaces screen: your jobs, and where your own cycles begin."""
    return render(request, "timeclock/workplace_list.html", {
        "workplaces": Workplace.objects.filter(user=request.user),
        "cycles": cycles or TimePreferenceForm(instance=TimePreference.for_user(request.user)),
    })


@login_required
def preferences(request):
    """
    Where your own week, fortnight and month begin.

    No screen of its own any more. A workplace already carries how it pays and
    what it caps you at, so a second page listing every workplace to say the
    same thing was a second way to reach one thing — and the only setting that
    genuinely spanned every job was this one. It now sits in a panel at the
    foot of Workplaces, and this is just where that form posts.
    """
    if request.method != "POST":
        return redirect("timeclock:workplaces")

    pref = TimePreference.for_user(request.user)
    form = TimePreferenceForm(request.POST, instance=pref)
    if not form.is_valid():
        return _workplaces_page(request, cycles=form)

    form.save()
    messages.success(request, "Saved where your week, fortnight and month begin.")
    return redirect("timeclock:workplaces")


@login_required
def more(request):
    """Menu page for everything that doesn't earn a slot in the tab bar."""
    return render(request, "timeclock/more.html", {
        "workplace_count": Workplace.objects.filter(user=request.user).count(),
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
        Workplace.objects.filter(user=request.user)
        .prefetch_related("payments")
    )
    owing = [_pay_state(workplace) for workplace in places]

    return render(request, "timeclock/payments.html", {
        "owing": owing,
        "owed_total": sum((row["worked"] for row in owing), timedelta()),
        "today": timezone.localdate(),
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
        picked = (request.POST.get("up_to") or "").strip()
        if picked:
            # A date that covers nothing is worth saying back, because the
            # date is the thing the person chose and probably mistyped.
            messages.info(
                request,
                f"Nothing unpaid at {workplace.name} on or before {picked} — "
                "the hours you're looking at are all after that day.",
            )
        else:
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


def _swept_to(workplace, end):
    """
    Everything worked before `end` (exclusive), as one stretch to be settled.

    A sweep rather than a run: "I was paid up to here" says nothing about
    where the money started, only where it stopped, and it settles whatever
    was outstanding before that — including an older run nobody had got round
    to paying. Which is what being paid up to a date means.
    """
    cutoff = _midnight(end)
    covered = [shift for shift in _unpaid_shifts(workplace) if shift.clock_in < cutoff]
    return _run(workplace, covered, end=end) if covered else None


def _cut_off_named(request):
    """
    The end date the form is asking for, or None if it named no date at all.

    Two ways of saying it, because two different things are doing the asking.
    A run button and a day in the list send `through`, which is the exclusive
    end they already speak in. A person picking a date off a calendar means
    the day itself — "paid up to and including Saturday" — so `up_to` is
    inclusive and the day after it is what actually gets settled.

    Returns False for a date that will not parse, which is not the same as no
    date: one is a form to reject and the other is the ordinary case.

    The Pay screen asks it as one question, `covers`: a run ("run:<end>"),
    "now", or "date" — meaning the `up_to` box beside it. Each is turned
    into the through / up_to it stands for, so a form that still speaks in
    those directly is read the same way.
    """
    covers = (request.POST.get("covers") or "").strip()
    through = (request.POST.get("through") or "").strip()
    up_to = (request.POST.get("up_to") or "").strip()
    if covers.startswith("run:"):
        through, up_to = covers[4:], ""
    elif covers == "now":
        through, up_to = "", ""
    elif covers == "date":
        through = ""
        # The box left empty is a form to reject, not a sweep to now.
        if not up_to:
            return False

    if raw := up_to:
        try:
            return date.fromisoformat(raw) + timedelta(days=1)
        except ValueError:
            return False

    if raw := through:
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return False

    return None


def _run_being_paid(request, state):
    """
    Which stretch of work the form is settling.

    Named no date, a job with no cycle settles everything up to now — the
    money is in your hand. A job on a cycle has to say which run, because
    paying for the fortnight that closed last Wednesday must not also clear
    the one that has been running since Thursday.

    Named a date, either kind settles everything worked before it. For a job
    on a cycle the run buttons are tried first, so pressing one still records
    that run exactly; a date that is not one of them is taken at its word and
    sweeps up whatever it covers, which may well be more than one run.
    """
    end = _cut_off_named(request)
    if end is False:
        return None

    if end is None:
        # No cut-off named: the money covered everything, which is the usual
        # case and the one an irregular job's own button sends. A job on a
        # cycle has runs to choose between and must name one.
        return None if state["scheduled"] else state["current"]

    if state["scheduled"]:
        payable = list(state["due"])
        if state["current"]["payable"]:
            payable.append(state["current"])
        run = next((r for r in payable if r["end"] == end), None)
        if run is not None:
            return run

    return _swept_to(state["workplace"], end)


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


# The longest stretch one statement covers. A year is the most anyone
# reconciles in one go; past that the PDF is a database dump.
STATEMENT_MAX_DAYS = 366


def statement_range(request):
    """
    The [first, last] dates asked for, inclusive both ends, or None.

    From the profile's form: `from` and `to` as ISO dates. Left out, it is
    the month so far — the period the calendar used to hand out — and a
    range that is backwards, unparseable or absurdly long is refused rather
    than guessed at.
    """
    today = timezone.localdate()
    raw_from = (request.GET.get("from") or "").strip()
    raw_to = (request.GET.get("to") or "").strip()
    if not raw_from and not raw_to:
        return today.replace(day=1), today
    try:
        first = date.fromisoformat(raw_from) if raw_from else today.replace(day=1)
        last = date.fromisoformat(raw_to) if raw_to else today
    except ValueError:
        return None
    if last < first or (last - first).days >= STATEMENT_MAX_DAYS:
        return None
    return first, last


def _period_label(first, last):
    """"September 2026", or "6 – 19 Sep 2026", or "28 Aug – 3 Sep 2026"."""
    if first.day == 1 and last == (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1):
        return first.strftime("%B %Y")
    if first.month == last.month and first.year == last.year:
        return f"{first.day} \u2013 {last.day} {last:%b %Y}"
    if first.year == last.year:
        return f"{first.day} {first:%b} \u2013 {last.day} {last:%b %Y}"
    return f"{first.day} {first:%b %Y} \u2013 {last.day} {last:%b %Y}"


@login_required
def statement(request):
    """
    A stretch of your record as a PDF, laid out like a payslip.

    A payment lands in a bank account as one line: a date and an amount. This
    is the other side of it — what turned up, what it said it covered, and
    every shift behind it — so the two can be checked off against each other.

    It matters most straight after being paid, because marking a payment
    received sets the running total back to zero. The hours are still on the
    timesheet, but the figure you were watching is gone; a statement is that
    figure kept, on the day it was true.

    Asked for from the profile: any dates, and one job with ?workplace=<pk>
    or every job without.
    """
    span = statement_range(request)
    if span is None:
        messages.error(request, "Pick a start and an end date, the end after the start and no more than a year apart.")
        return redirect("accounts:profile")
    first, last = span
    start, end = _day_bounds(first, last + timedelta(days=1))

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

    # Every payment against the jobs in view, not just the period's — a shift
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
            "break": statement_pdf.hm(shift.total_break) if shift.total_break else "\u2014",
            "hours": statement_pdf.hm(shift.worked_duration),
            "paid": (
                f"{timezone.localtime(paid_by.created_at).day} "
                f"{timezone.localtime(paid_by.created_at):%b}"
                if paid_by else "\u2014"
            ),
        })

        # Priced by its own job's rate, never by an average of two.
        place = shift.workplace
        key = place.pk if place else None
        bucket = totals.setdefault(key, {
            "workplace": place.name if place else "No workplace",
            "hue": place.color if place else None,
            "rate": (
                f"${place.hourly_rate:,.2f}/h" if place and place.hourly_rate else "\u2014"
            ),
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
            "covers": f"{opens} \u2013 {closes}" if payment.covers_from else f"up to {closes}",
            "hours": f"{float(payment.hours):g}h",
            "amount": float(payment.amount) if payment.amount is not None else None,
        })

    # ---- the figures at the top --------------------------------------
    priced = [row for row in totals.values() if row["priced"]]
    withheld = [row for row in priced if row["withholds"]]
    gross_total = round(sum(row["gross"] for row in priced), 2) if priced else None
    tax_total = round(sum(row["tax"] for row in withheld), 2) if withheld else None
    # Take-home is only honest when every priced job says what it withholds.
    net_total = (
        round(gross_total - tax_total, 2)
        if priced and len(withheld) == len(priced) else None
    )
    paid_hours = sum(
        (shift.worked_duration for shift, row in zip(shifts, rows) if row["paid"] != "\u2014"),
        timedelta(),
    )

    me = Profile.of(request.user)
    today = timezone.localdate()
    scope = workplace.name if workplace else "All workplaces"
    label = _period_label(first, last)
    filename = _statement_filename(first, last, workplace)
    lines = [f"@{request.user.get_username()}"]
    if request.user.email:
        lines.append(request.user.email)
    if me.phone:
        lines.append(me.phone)
    if me.address:
        lines.append(me.address)

    pdf = statement_pdf.build({
        "period_label": label,
        "reference": f"MW-{request.user.pk}-{first:%Y%m%d}-{last:%Y%m%d}",
        "issued": f"{today.day} {today:%b %Y}",
        "person": {"name": me.name, "lines": lines},
        "details": [
            ("Period", f"{first.day} {first:%b %Y} \u2013 {last.day} {last:%b %Y}"),
            ("Workplace", scope),
            ("Shifts", f"{len(rows)} shift{'' if len(rows) == 1 else 's'}"),
        ],
        "summary": [
            {"label": "Hours worked", "value": statement_pdf.hm(worked),
             "sub": f"{statement_pdf.hm(paid_hours)} paid for" if rows else "no shifts"},
            {"label": "Gross pay", "value": statement_pdf.money(gross_total),
             "sub": "before tax" if gross_total is not None else "no rate saved"},
            {"label": "Tax withheld", "value": statement_pdf.money(tax_total),
             "sub": "estimated" if tax_total is not None else "not recorded"},
            {"label": "Take-home", "value": statement_pdf.money(net_total),
             "sub": (
                 f"{statement_pdf.money(received_amount)} received" if priced_any
                 else "nothing marked received"
             ), "lead": True},
        ],
        "payments": payment_rows,
        "received_hours": f"{received_hours:g}h",
        "received_amount": received_amount if priced_any else None,
        "shifts": rows,
        "worked_hours": statement_pdf.hm(worked),
        "gross_total": gross_total,
        "tax_total": tax_total,
        "net_total": net_total,
        "totals": [
            {
                "workplace": row["workplace"],
                "hue": row["hue"],
                "rate": row["rate"],
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
            f"Prepared {today.strftime('%d %B %Y').lstrip('0')} from your own "
            "MyWork timesheet. It records what you entered, not what an "
            "employer has declared — keep it beside the payslip rather than "
            "instead of it."
        ),
        "filename": filename,
    })

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _statement_filename(first, last, workplace):
    """Sorts by date in a downloads folder, and says which job it is for."""
    who = f"-{slugify(workplace.name)}" if workplace else ""
    return f"MyWork-statement{who}-{first:%Y-%m-%d}-to-{last:%Y-%m-%d}.pdf"
