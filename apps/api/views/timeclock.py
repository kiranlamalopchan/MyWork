"""
TimeSheet for the app: the clock, the timesheet and its calendar, shifts,
workplaces, pay and the statement.

Every figure here is the one the site's own pages show, read through the
same helpers in apps.timeclock.views (`_summary`, `_limit_for`, `_pay_state`,
`_day_shape`…) and the same forms (`ShiftForm`, `BreakFormSet`,
`WorkplaceForm`, `TimePreferenceForm`) — so a total on the phone can never
disagree with the same total in the browser. Durations travel as whole
seconds with the words the site prints beside them ("7h 45m", "05:42:11"),
so the app draws and the server decides.
"""

import calendar as pycalendar
from datetime import date, timedelta
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.db.models import Prefetch
from django.http import QueryDict
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.timeclock import payslip as payslip_reader
from apps.timeclock import views as site
from apps.timeclock.forms import BreakFormSet, ShiftForm, TimePreferenceForm, WorkplaceForm
from apps.timeclock.models import (
    MAX_MONTH_START_DAY, WORKPLACE_COLORS, LimitPeriod, PaidIn, PayCycle, Payment, Shift,
    TimePreference, Weekday, Workplace, color_css, fortnight_runs, fortnight_start, fortnight_started_last_week,
)
from apps.timeclock.templatetags.timeclock_extras import decimal_hours, hm, hms, minutes

from .. import serialize
from ..errors import form_errors

# ---- words and numbers ----------------------------------------------------------


def duration(value):
    """A timedelta as the app draws it: seconds, and the site's words for it."""
    value = value or timedelta()
    return {
        "seconds": int(max(value.total_seconds(), 0)),
        "hm": hm(value) or "0m",
        "hms": hms(value),
        "minutes": minutes(value),
        "decimal": decimal_hours(value),
    }


def pay(value):
    return None if value is None else {"gross": value.gross, "tax": value.tax, "net": value.net}


def local_time(when):
    return timezone.localtime(when).strftime("%-I:%M %p") if when else None


def local_date(when):
    return timezone.localtime(when).date() if when else None


def day_label(day, form="%a %-d %b"):
    return day.strftime(form) if day else None


def workplace_brief(w):
    if w is None:
        return None
    return {"id": w.pk, "name": w.name, "hue": w.color, "css": color_css(w.color), "is_default": w.is_default}


def workplace_full(w):
    data = workplace_brief(w)
    limit = None
    if w.has_limit:
        limit = f"{float(w.hours_limit):g}h/{w.period_label}"
    data.update({
        "address": w.address,
        "hourly_rate": float(w.hourly_rate) if w.hourly_rate is not None else None,
        "tax_rate": float(w.tax_rate) if w.tax_rate is not None else None,
        "in_cash": w.in_cash,
        "withholds": w.withholds,
        "paid_in": w.paid_in,
        "pay_cycle": w.pay_cycle,
        "pay_cycle_label": w.get_pay_cycle_display(),
        "hours_limit": float(w.hours_limit) if w.hours_limit is not None else None,
        "limit_period": w.limit_period,
        "limit_label": limit,
        "week_starts_on": w.week_starts_on,
        "fortnight_starts_on": w.fortnight_anchor.weekday(),
        "fortnight_phase": "last" if fortnight_started_last_week(w.fortnight_anchor, timezone.localdate()) else "this",
        "fortnight_hint": _fortnight_hint(w.fortnight_anchor),
        "month_starts_on": w.month_starts_on,
        # The line under the name on the workplaces page.
        "sub": " · ".join(filter(None, [
            w.address or "No address",
            f"${float(w.hourly_rate):.2f}/hr" if w.hourly_rate else "",
            "cash" if w.in_cash else (f"{float(w.tax_rate):g}% tax" if w.tax_rate else ""),
            limit or "",
        ])),
    })
    return data


def _fortnight_hint(anchor):
    today = timezone.localdate()
    start = fortnight_start(today, anchor)
    end = start + timedelta(days=13)
    return f"{fortnight_runs(anchor)}. This one runs {start:%-d %b} – {end:%-d %b}."


def shift_row(shift, seq=None):
    """One shift as the timesheet lists it."""
    return {
        "id": shift.pk,
        "workplace": workplace_brief(shift.workplace),
        "status": shift.status,
        "status_label": shift.get_status_display(),
        "is_open": shift.is_open,
        "clock_in": shift.clock_in.isoformat(),
        "clock_out": shift.clock_out.isoformat() if shift.clock_out else None,
        "in_at": local_time(shift.clock_in),
        "out_at": local_time(shift.clock_out),
        "date": local_date(shift.clock_in).isoformat(),
        "worked": duration(shift.worked_duration),
        "total_break": duration(shift.total_break),
        "seq": seq,
        "gap_before": duration(shift.gap_before) if getattr(shift, "gap_before", None) else None,
    }


def shift_detail(shift):
    data = shift_row(shift)
    w = shift.workplace
    data.update({
        "date_label": timezone.localtime(shift.clock_in).strftime("%A, %-d %B"),
        "total": duration(shift.total_duration),
        "pay": pay(shift.pay),
        "in_cash": bool(w and w.in_cash),
        "withholds": bool(w and w.withholds),
        "note": shift.note,
        "breaks": [
            {
                "id": b.pk,
                "break_start": b.break_start.isoformat(),
                "break_end": b.break_end.isoformat() if b.break_end else None,
                "start_at": local_time(b.break_start),
                "end_at": local_time(b.break_end),
                "is_running": b.is_running,
                "duration": duration(b.duration),
            }
            for b in shift.breaks.all()
        ],
    })
    return data


def limit_card(limit):
    if not limit:
        return None
    return {
        "workplace": workplace_brief(limit["workplace"]),
        "cap": duration(limit["cap"]),
        "used": duration(limit["used"]),
        "remaining": duration(limit["remaining"]),
        "over": duration(limit["over"]),
        "percent": limit["percent"],
        "settled": duration(limit["settled"]),
        "settled_percent": limit["settled_percent"],
        "since": duration(limit["since"]),
        "since_percent": limit["since_percent"],
        "paid_at": day_label(timezone.localtime(limit["paid_at"]).date(), "%-d %b") if limit["paid_at"] else None,
        "period_label": limit["period_label"],
        "period": f"{limit['period_start']:%-d %b} – {limit['period_end']:%-d %b}",
        "resets_on": day_label(limit["resets_on"]),
        "state": limit["state"],
    }


def _period_pay(block):
    """The pay block of a summary period: {pay, withheld, cash} or None."""
    if not block:
        return None
    return {"pay": pay(block["pay"]), "withheld": block["withheld"], "cash": block["cash"]}


def summary_json(summary):
    period = summary["period"]
    return {
        "cards": [
            {
                "key": card["key"], "label": card["label"], "sub": card["sub"],
                "total": duration(card["total"]),
                "net": card["pay"]["pay"].net if card.get("pay") else None,
            }
            for card in summary["cards"]
        ],
        "period": {
            "key": period["key"],
            "title": period["pay_title"],
            "dates": f"{period['start']:%-d %b} – {period['end']:%-d %b}",
            "total": duration(period["total"]),
            "pay": _period_pay(period.get("pay")),
        },
        "limits": [limit_card(limit) for limit in summary["limits"]],
    }


def _shim(request):
    """The site's helpers read request.POST; the app sends JSON."""
    return SimpleNamespace(POST=request.data, user=request.user, session={})


def _form_data(data, prefix=None):
    """A JSON body as the QueryDict a Django form expects."""
    qd = QueryDict(mutable=True)
    for key, value in data.items():
        if isinstance(value, (list, dict)):
            continue
        if isinstance(value, bool):
            value = "on" if value else ""
        qd[f"{prefix}-{key}" if prefix else key] = "" if value is None else str(value)
    return qd


# ---- the clock ------------------------------------------------------------------


def cash_tally(workplace):
    """
    What a cash job has piled up since the money last came.

    A job paid in hand has no cycle to count over and — where no cap is set —
    nothing to draw a bar against, so the dial had nothing under it at all.
    The figure that means something there is the one the payment button
    clears: the hours not yet paid for, the same notepad the pay screen keeps
    (`_since_paid`). A cap, where there is one, is the more useful thing to
    show and keeps its place.
    """
    if workplace is None or workplace.has_limit or not workplace.in_cash:
        return None
    card = site._since_paid(workplace)
    return {
        "workplace": workplace_brief(workplace),
        "label": card["label"],
        "sub": card["sub"],
        "total": duration(card["total"]),
        "pay": pay(card["pay"]["pay"]) if card["pay"] else None,
    }


def clock_state(user, selected_id=None):
    workplaces = list(Workplace.objects.filter(user=user).prefetch_related("payments"))
    shift = Shift.open_for(user)
    if shift:
        selected = shift.workplace
    else:
        selected = next((w for w in workplaces if str(w.pk) == str(selected_id)), None)
        if selected is None:
            selected = next((w for w in workplaces if w.is_default), workplaces[0] if workplaces else None)
    running = shift.running_break if shift else None
    banked = timedelta()
    if shift:
        for b in shift.breaks.all():
            if b.break_end:
                banked += b.break_end - b.break_start
    return {
        "server_now": timezone.now().isoformat(),
        "today": timezone.localdate().strftime("%A, %-d %B"),
        "workplaces": [workplace_brief(w) for w in workplaces],
        "selected": selected.pk if selected else None,
        "shift": {
            "id": shift.pk,
            "status": shift.status,
            "status_label": shift.get_status_display(),
            "workplace": workplace_brief(shift.workplace),
            "clock_in": shift.clock_in.isoformat(),
            "in_at": local_time(shift.clock_in),
            "worked": duration(shift.worked_duration),
            "total_break": duration(shift.total_break),
            "banked_break_seconds": int(banked.total_seconds()),
            "running_break": {
                "start": running.break_start.isoformat(), "start_at": local_time(running.break_start),
                "duration": duration(running.duration),
            } if running else None,
        } if shift else None,
        "target_hours": site.SHIFT_TARGET_HOURS,
        "long_shift": bool(shift and shift.total_duration > timedelta(hours=site.SHIFT_TARGET_HOURS)),
        "limit": limit_card(site._limit_for(user, selected)),
        # A cash job with no cap: the hours owed for, in the cap's place.
        "tally": cash_tally(selected),
    }


class Clock(APIView):
    def get(self, request):
        return Response(clock_state(request.user, request.GET.get("workplace")))


class ClockIn(APIView):
    def post(self, request):
        workplace = Workplace.objects.filter(pk=request.data.get("workplace"), user=request.user).first()
        if workplace is None:
            return Response({"detail": "Pick a workplace before clocking in."}, status=400)
        try:
            Shift.clock_in_now(request.user, workplace, when=site._client_now(_shim(request)))
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        state = clock_state(request.user, workplace.pk)
        state["message"] = f"Clocked in at {timezone.localtime():%-I:%M %p}."
        return Response(state)


def _open_shift(request):
    shift = Shift.open_for(request.user)
    if shift is None:
        return None, Response({"detail": "You're not clocked in."}, status=400)
    return shift, None


class StartBreak(APIView):
    def post(self, request):
        shift, err = _open_shift(request)
        if err:
            return err
        try:
            shift.start_break(when=site._client_now(_shim(request)))
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        state = clock_state(request.user)
        state["message"] = f"Break started at {timezone.localtime():%-I:%M %p}."
        return Response(state)


class EndBreak(APIView):
    def post(self, request):
        shift, err = _open_shift(request)
        if err:
            return err
        try:
            shift.end_break(when=site._client_now(_shim(request)))
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        state = clock_state(request.user)
        state["message"] = "Back on the clock."
        return Response(state)


class ClockOut(APIView):
    def post(self, request):
        shift, err = _open_shift(request)
        if err:
            return err
        try:
            shift.clock_out_now(when=site._client_now(_shim(request)))
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        state = clock_state(request.user)
        state["finished"] = shift.pk
        return Response(state)


# ---- the timesheet --------------------------------------------------------------


class Timesheet(APIView):
    def get(self, request):
        workplaces = list(Workplace.objects.filter(user=request.user))
        picked = request.GET.get("workplace")
        workplace = next((w for w in workplaces if str(w.pk) == str(picked)), None) if picked else None

        qs = site._shifts_for(request.user)
        if workplace:
            qs = qs.filter(workplace=workplace)
        page, meta = serialize.page_of(request, qs, 20)

        days = []
        for shift in page.object_list:
            day = timezone.localtime(shift.clock_in).date()
            if not days or days[-1]["date"] != day:
                days.append({"date": day, "shifts": [], "total": timedelta()})
            days[-1]["shifts"].append(shift)
            days[-1]["total"] += shift.worked_duration
        for day in days:
            day["shifts"] = site._in_order(day["shifts"])

        def day_json(day):
            return {
                "date": day["date"].isoformat(),
                "label": day_label(day["date"]),
                "total": duration(day["total"]),
                "is_run": len(day["shifts"]) > 1,
                "shifts": [shift_row(s, getattr(s, "seq", None)) for s in day["shifts"]],
            }

        # The week being read comes as days; everything older comes already
        # gathered into weeks, by the site's own helper, so the two agree on
        # where a week starts. A week split across two pages arrives as two
        # entries with the same `start` — the app joins them back up.
        recent, weeks = site.group_by_week(days, request.user)
        meta["days"] = [day_json(day) for day in recent]
        meta["weeks"] = [
            {
                "start": week["start"].isoformat(),
                # The two ends of what is in the fold, apart, so the app can
                # write the range again after joining a week split over a page.
                "first_label": day_label(week["first"], "%-d %b"),
                "last_label": day_label(week["last"], "%-d %b"),
                "total": duration(week["total"]),
                "shifts": week["shifts"],
                "days": [day_json(day) for day in week["days"]],
            }
            for week in weeks
        ]
        meta["workplaces"] = [workplace_brief(w) for w in workplaces]
        meta["workplace"] = workplace.pk if workplace else None
        meta["summary"] = summary_json(site._summary(request.user, workplace))
        return Response(meta)


class Calendar(APIView):
    def get(self, request):
        today = timezone.localdate()
        try:
            year = int(request.GET.get("year", today.year))
            month = int(request.GET.get("month", today.month))
            first = date(year, month, 1)
        except (TypeError, ValueError):
            first = today.replace(day=1)
            year, month = first.year, first.month
        last = date(year, month, pycalendar.monthrange(year, month)[1])

        shifts = list(site._shifts_for(request.user).filter(
            clock_in__range=site._day_bounds(first, last + timedelta(days=1))
        ))
        totals, by_day = {}, {}
        for shift in shifts:
            day = timezone.localtime(shift.clock_in).date()
            totals[day] = totals.get(day, timedelta()) + shift.worked_duration
            by_day.setdefault(day, []).append(shift)
        shapes = {day: site._day_shape(rows) for day, rows in by_day.items()}

        by_place = {}
        for shape in shapes.values():
            for name, hue, seconds in shape["legend"]:
                entry = by_place.setdefault(name, {"name": name, "hue": hue, "seconds": 0})
                entry["seconds"] += seconds

        first_weekday = TimePreference.for_user(request.user).week_starts_on
        weeks = [
            [
                {
                    "date": day.isoformat(),
                    "day": day.day,
                    "in_month": day.month == month,
                    "is_today": day == today,
                    "total": duration(totals[day]) if day in totals else None,
                    "track": [
                        {"css": seg["css"], "left": float(seg["left"]), "width": float(seg["width"])}
                        for seg in (shapes[day]["track"] if day in shapes else [])
                    ],
                    "lead": shapes[day]["lead"] if day in shapes else None,
                }
                for day in week
            ]
            for week in pycalendar.Calendar(firstweekday=first_weekday).monthdatescalendar(year, month)
        ]

        selected, selected_shifts = None, []
        if raw := request.GET.get("day"):
            try:
                selected = date.fromisoformat(raw)
            except ValueError:
                selected = None
        if selected:
            selected_shifts = site._in_order(
                [s for s in shifts if timezone.localtime(s.clock_in).date() == selected]
            )

        prev_month, next_month = first - timedelta(days=1), last + timedelta(days=1)
        return Response({
            "year": year, "month": month,
            "label": first.strftime("%B %Y"),
            "weekday_labels": [pycalendar.day_abbr[(first_weekday + i) % 7][0] for i in range(7)],
            "weeks": weeks,
            "legend": sorted(
                ({"name": e["name"], "css": color_css(e["hue"]), "worked": duration(timedelta(seconds=e["seconds"]))} for e in by_place.values()),
                key=lambda e: -e["worked"]["seconds"],
            ),
            "month_total": duration(sum(totals.values(), timedelta())),
            "worked_days": len(totals),
            "prev": {"year": prev_month.year, "month": prev_month.month},
            "next": {"year": next_month.year, "month": next_month.month},
            "selected": selected.isoformat() if selected else None,
            "selected_label": selected.strftime("%A, %-d %B") if selected else None,
            "selected_shifts": [shift_row(s, getattr(s, "seq", None)) for s in selected_shifts],
            "selected_total": duration(sum((s.worked_duration for s in selected_shifts), timedelta())),
        })


# ---- shifts ---------------------------------------------------------------------


def _shift(request, pk):
    return get_object_or_404(site._shifts_for(request.user).prefetch_related(Prefetch("breaks")), pk=pk)


def _save_shift(request, shift, creating):
    """The site's shift form and break rows, fed from JSON, saved the site's way."""
    data = _form_data(request.data)
    breaks = request.data.get("breaks") or []
    prefix = BreakFormSet.get_default_prefix()
    data[f"{prefix}-TOTAL_FORMS"] = str(len(breaks))
    data[f"{prefix}-INITIAL_FORMS"] = str(sum(1 for b in breaks if b.get("id")))
    data[f"{prefix}-MIN_NUM_FORMS"] = "0"
    data[f"{prefix}-MAX_NUM_FORMS"] = "1000"
    # Existing rows first, as the formset counts them, then the new ones.
    ordered = [b for b in breaks if b.get("id")] + [b for b in breaks if not b.get("id")]
    for i, b in enumerate(ordered):
        for key in ("id", "break_start", "break_end"):
            data[f"{prefix}-{i}-{key}"] = "" if b.get(key) in (None, "") else str(b.get(key))
        if b.get("delete"):
            data[f"{prefix}-{i}-DELETE"] = "on"

    form = ShiftForm(data, instance=shift, user=request.user)
    formset = BreakFormSet(data, instance=shift)
    if form.is_valid():
        formset.instance.clock_in = form.cleaned_data["clock_in"]
        formset.instance.clock_out = form.cleaned_data.get("clock_out")
    if not (form.is_valid() and formset.is_valid()):
        errors = form_errors(form)
        rows = []
        for bf in formset.forms:
            # A row being deleted is not being checked; its errors are noise.
            going = formset.can_delete and bool(getattr(bf, "cleaned_data", {}).get("DELETE"))
            rows.append({} if going else {k: [str(e) for e in v] for k, v in bf.errors.items()})
        if formset.non_form_errors():
            errors["detail"] = " ".join(str(e) for e in formset.non_form_errors())
            errors.setdefault("fields", {})["breaks"] = [str(e) for e in formset.non_form_errors()]
        elif any(rows):
            errors.setdefault("fields", {})["breaks"] = rows
            errors.setdefault("detail", "Please fix the breaks.")
        return None, Response(errors, status=400)

    shift = form.save(commit=False)
    shift.user = request.user
    if creating:
        shift.status = Shift.Status.COMPLETED if shift.clock_out else Shift.Status.WORKING
    elif shift.clock_out:
        shift.status = Shift.Status.COMPLETED
    elif shift.status == Shift.Status.COMPLETED:
        shift.status = Shift.Status.WORKING
    shift.save()
    formset.save()
    if shift.is_open:
        shift.status = (
            Shift.Status.ON_BREAK if shift.breaks.filter(break_end__isnull=True).exists() else Shift.Status.WORKING
        )
        shift.save(update_fields=["status", "updated_at"])
    return _shift(request, shift.pk), None


class Shifts(APIView):
    def post(self, request):
        shift, err = _save_shift(request, Shift(user=request.user), creating=True)
        return err or Response(shift_detail(shift), status=201)


class NewShift(APIView):
    """Where the Add-a-shift form opens: the times, and the workplace, it starts with."""

    def get(self, request):
        workplaces = list(Workplace.objects.filter(user=request.user).prefetch_related("payments"))
        req = SimpleNamespace(GET=request.GET, session={}, user=request.user)
        initial = site._new_shift_initial(req, workplaces)
        return Response({
            "workplaces": [workplace_brief(w) for w in workplaces],
            "workplace": initial["workplace"].pk if initial["workplace"] else None,
            "clock_in": timezone.localtime(initial["clock_in"]).strftime("%Y-%m-%dT%H:%M"),
            "clock_out": timezone.localtime(initial["clock_out"]).strftime("%Y-%m-%dT%H:%M"),
        })


class ShiftDetail(APIView):
    def get(self, request, pk):
        return Response(shift_detail(_shift(request, pk)))

    def patch(self, request, pk):
        shift, err = _save_shift(request, _shift(request, pk), creating=False)
        return err or Response(shift_detail(shift))

    def delete(self, request, pk):
        get_object_or_404(Shift.objects.filter(user=request.user), pk=pk).delete()
        return Response(status=204)


# ---- workplaces -----------------------------------------------------------------


def cycles_json(pref):
    today = timezone.localdate()
    return {
        "week_starts_on": pref.week_starts_on,
        "week_label": Weekday(pref.week_starts_on).label,
        "fortnight_starts_on": pref.fortnight_anchor.weekday(),
        "fortnight_phase": "last" if fortnight_started_last_week(pref.fortnight_anchor, today) else "this",
        "fortnight_hint": _fortnight_hint(pref.fortnight_anchor),
        "month_starts_on": pref.month_starts_on,
    }


def _choices():
    return {
        "weekdays": [{"value": v, "label": l} for v, l in Weekday.choices],
        "phases": [{"value": v, "label": l} for v, l in WorkplaceForm.PHASES],
        "colors": [{"value": hue, "label": label, "css": color_css(hue)} for hue, label in WORKPLACE_COLORS],
        "pay_cycles": [{"value": v, "label": l} for v, l in PayCycle.choices],
        "paid_in": [{"value": v, "label": l} for v, l in PaidIn.choices],
        "limit_periods": [{"value": v, "label": l} for v, l in LimitPeriod.choices],
        "max_month_start": MAX_MONTH_START_DAY,
    }


class Workplaces(APIView):
    def get(self, request):
        return Response({
            "workplaces": [workplace_full(w) for w in Workplace.objects.filter(user=request.user)],
            "cycles": cycles_json(TimePreference.for_user(request.user)),
            "choices": _choices(),
        })

    def post(self, request):
        form = WorkplaceForm(_form_data(request.data), user=request.user)
        if not form.is_valid():
            return Response(form_errors(form), status=400)
        workplace = form.save(commit=False)
        workplace.user = request.user
        first = not Workplace.objects.filter(user=request.user).exists()
        workplace.is_default = False
        workplace.save()
        if form.cleaned_data.get("is_default") or first:
            workplace.make_default()
        return Response(workplace_full(workplace), status=201)


class WorkplaceDetail(APIView):
    def _get(self, request, pk):
        return get_object_or_404(Workplace, pk=pk, user=request.user)

    def get(self, request, pk):
        return Response(workplace_full(self._get(request, pk)))

    def patch(self, request, pk):
        workplace = self._get(request, pk)
        form = WorkplaceForm(_form_data(request.data), instance=workplace, user=request.user)
        if not form.is_valid():
            return Response(form_errors(form), status=400)
        workplace = form.save(commit=False)
        wants_default = form.cleaned_data.get("is_default")
        workplace.is_default = False
        workplace.save()
        if wants_default:
            workplace.make_default()
        return Response(workplace_full(workplace))

    def delete(self, request, pk):
        workplace = self._get(request, pk)
        clocked_in = Shift.objects.filter(user=request.user, workplace=workplace, status__in=Shift.OPEN_STATUSES).exists()
        if clocked_in:
            return Response({"detail": "You're clocked in at that workplace. Clock out first."}, status=400)
        going = _going(workplace.belongings())
        workplace.remove()
        return Response({"removed": going})


def _going(going):
    """What a removal takes with it, as words and numbers."""
    return {
        "shifts": going["shifts"],
        "breaks": going["breaks"],
        "payments": going["payments"],
        "worked": duration(going["worked"]),
        "span": f"{going['first']:%-d %b %Y} – {going['last']:%-d %b %Y}" if going.get("first") else None,
    }


class WorkplaceRemoval(APIView):
    """What removing this workplace would take with it."""

    def get(self, request, pk):
        workplace = get_object_or_404(Workplace, pk=pk, user=request.user)
        clocked_in = Shift.objects.filter(user=request.user, workplace=workplace, status__in=Shift.OPEN_STATUSES).exists()
        return Response({"workplace": workplace_brief(workplace), "going": _going(workplace.belongings()), "clocked_in": clocked_in})


class WorkplaceDefault(APIView):
    def post(self, request, pk):
        workplace = get_object_or_404(Workplace, pk=pk, user=request.user)
        workplace.make_default()
        return Response(workplace_full(workplace))


class Payslip(APIView):
    """Reads an uploaded payslip and says what the workplace form should hold."""

    def post(self, request):
        uploaded = request.FILES.get("payslip")
        if uploaded is None:
            return Response({"detail": "Choose a payslip — a PDF, or a photo or screenshot of one."}, status=400)
        try:
            text = payslip_reader.read_text(uploaded)
        except payslip_reader.Unreadable as why:
            return Response({"detail": str(why)}, status=400)
        slip = payslip_reader.parse(text)
        if not slip.fields():
            return Response({"detail": "Nothing on that payslip could be made out — no rate, tax or pay period. Type them in instead."}, status=400)
        return Response(slip.as_json(timezone.localdate()))


class Preferences(APIView):
    def put(self, request):
        pref = TimePreference.for_user(request.user)
        form = TimePreferenceForm(_form_data(request.data), instance=pref)
        if not form.is_valid():
            return Response(form_errors(form), status=400)
        form.save()
        return Response(cycles_json(pref))


# ---- pay ------------------------------------------------------------------------


def _run_json(run):
    if not run:
        return None
    return {
        "start": run["start"].isoformat() if run["start"] else None,
        "end": run["end"].isoformat() if run["end"] else None,
        "dates": f"{run['start']:%-d %b} – {run['payday']:%-d %b}" if run["start"] and run["payday"] else None,
        "payday": day_label(run["payday"]) if run["payday"] else None,
        "hours": round(run["hours"], 1),
        "worked": duration(run["worked"]),
        "shifts": run["shifts"],
        "pay": pay(run["pay"]),
        "closed": run["closed"],
        "payable": run["payable"],
    }


def pay_row(state):
    w = state["workplace"]
    last = state["last_payment"]
    since = timezone.localtime(state["since"]).date() if state["since"] else None
    return {
        "workplace": workplace_brief(w),
        "cycle_label": w.get_pay_cycle_display().lower(),
        "period_label": w.pay_cycle_label,
        "scheduled": state["scheduled"],
        "worked": duration(state["worked"]),
        "shifts": state["shifts"],
        "owed_pay": pay(state["owed_pay"]),
        "since": since.strftime("%-d %b") if since else None,
        "earliest": state["earliest"].isoformat() if state["earliest"] else None,
        "current": _run_json(state["current"]),
        "due": [_run_json(r) for r in state["due"]],
        "covers": state["covers"],
        "last_payment": {
            "covers_through": timezone.localtime(last.covers_through).strftime("%-d %b"),
            "hours": float(last.hours),
            "amount": float(last.amount) if last.amount is not None else None,
        } if last else None,
    }


def pay_page(user):
    places = Workplace.objects.filter(user=user).prefetch_related("payments")
    rows = [pay_row(site._pay_state(w)) for w in places]
    return {
        "owing": rows,
        "owed_total": duration(sum((site._pay_state(w)["worked"] for w in places), timedelta())),
        "today": timezone.localdate().isoformat(),
    }


class Pay(APIView):
    def get(self, request):
        return Response(pay_page(request.user))


class PaymentRecord(APIView):
    def post(self, request, pk):
        workplace = get_object_or_404(Workplace.objects.prefetch_related("payments"), pk=pk, user=request.user)
        state = site._pay_state(workplace)
        run = site._run_being_paid(_shim(request), state)
        if run is None:
            picked = (request.data.get("up_to") or "").strip()
            if picked:
                detail = f"Nothing unpaid at {workplace.name} on or before {picked} — the hours you're looking at are all after that day."
            else:
                detail = f"That pay run at {workplace.name} isn't outstanding — it's either already marked paid, or it hasn't finished yet."
            return Response({"detail": detail}, status=400)
        if run["hours"] <= 0:
            return Response({"detail": f"Nothing outstanding at {workplace.name}."}, status=400)
        Payment.objects.create(
            workplace=workplace,
            covers_from=site._midnight(run["start"]) if run["start"] else None,
            covers_through=(min(site._midnight(run["end"]), timezone.now()) if run["end"] else timezone.now()),
            hours=round(run["hours"], 2),
            amount=round(run["pay"].gross, 2) if run["pay"] else None,
        )
        page = pay_page(request.user)
        page["message"] = f"{site.hm_words(run['worked'])} at {workplace.name} marked paid."
        return Response(page)


class PaymentUndo(APIView):
    def post(self, request, pk):
        workplace = get_object_or_404(Workplace.objects.prefetch_related("payments"), pk=pk, user=request.user)
        last = workplace.payments.order_by("-created_at").first()
        if last is None:
            return Response({"detail": f"No payments recorded at {workplace.name}."}, status=400)
        last.delete()
        page = pay_page(request.user)
        page["message"] = f"Undone — those hours at {workplace.name} are owed again."
        return Response(page)


# ---- more, and the statement ----------------------------------------------------


class More(APIView):
    def get(self, request):
        return Response({
            "workplace_count": Workplace.objects.filter(user=request.user).count(),
            "unpaid_total": duration(site.unpaid_total(request.user)),
        })


class Statement(APIView):
    """The PDF itself, the site's own bytes — the app saves and shares it."""

    def get(self, request):
        return site.statement(request._request)
