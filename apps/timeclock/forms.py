from datetime import timedelta

from django import forms
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.forms import inlineformset_factory
from django.utils import timezone
from django.utils.html import escape
from django.utils.safestring import mark_safe

from .models import (
    DEFAULT_FORTNIGHT_START, MAX_MONTH_START_DAY, Break, PaidIn, Shift,
    TimePreference, Weekday, Workplace, fortnight_anchor_for, fortnight_runs,
    fortnight_start, fortnight_started_last_week,
)

# Phones give a proper date+time spinner for this input type, which beats
# typing a timestamp into a text box while standing at a time clock.
DATETIME_LOCAL = "%Y-%m-%dT%H:%M"


class LocalDateTimeField(forms.DateTimeField):
    def __init__(self, **kwargs):
        kwargs.setdefault("input_formats", [DATETIME_LOCAL, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"])
        kwargs.setdefault(
            "widget",
            forms.DateTimeInput(attrs={"type": "datetime-local"}, format=DATETIME_LOCAL),
        )
        super().__init__(**kwargs)


class FortnightFields:
    """
    The fortnight, asked for the way a person knows it.

    The model stores a date the cycle opened on and counts forward 14 days at
    a time from it, which is the right thing to store and the wrong thing to
    ask for — a box wanting "any date the cycle has started on" reads as a
    date to look up every fortnight. What somebody actually knows is the day
    of the week their fortnight starts, and whether the one they are in now
    began this week or last. Those are the two fields here; the date is
    worked out from them on save (`fortnight_anchor_for`) and read back into
    them when the form is opened again, so the cycle then rolls over on its
    own, fortnight after fortnight, with nothing more to set.

    Mixed into both forms that carry a fortnight — a workplace's and your
    own — so the two ask the same question the same way.
    """

    PHASES = [
        ("this", "This week"),
        ("last", "Last week"),
    ]

    def _add_fortnight_fields(self):
        anchor = getattr(self.instance, "fortnight_anchor", None)
        today = timezone.localdate()
        self.fields["fortnight_starts_on"] = forms.TypedChoiceField(
            label="Fortnight starts on",
            choices=Weekday.choices,
            coerce=int,
            initial=anchor.weekday() if anchor else DEFAULT_FORTNIGHT_START,
            help_text="Every fortnight opens on this day; the count starts again with it.",
        )
        self.fields["fortnight_phase"] = forms.ChoiceField(
            label="The fortnight you are in now began",
            choices=self.PHASES,
            initial="last" if anchor and fortnight_started_last_week(anchor, today) else "this",
            help_text=mark_safe('<span data-fortnight-hint>%s</span>' % escape(
                _fortnight_hint(anchor, today) if anchor else ""
            )),
        )

    def _resolve_fortnight(self, cleaned):
        """Turn the two answers into the date the model keeps."""
        starts_on = cleaned.get("fortnight_starts_on")
        if starts_on is None or starts_on == "":
            return
        self.instance.fortnight_anchor = fortnight_anchor_for(
            starts_on, started_last_week=cleaned.get("fortnight_phase") == "last"
        )


def _fortnight_hint(anchor, today):
    """"Thursday → Wednesday. This one: 10 Sep – 23 Sep." — under the box."""
    start = fortnight_start(today, anchor)
    end = start + timedelta(days=13)
    return "%s. This one runs %s – %s." % (
        fortnight_runs(anchor), start.strftime("%-d %b"), end.strftime("%-d %b")
    )


class WorkplaceForm(FortnightFields, forms.ModelForm):
    """
    Everything about one workplace, its own hours cap included — the cap is
    per workplace, so this is the only screen that sets it.
    """

    class Meta:
        model = Workplace
        # The fortnight is asked for as a weekday and a this-week-or-last
        # (FortnightFields), not as the date the model keeps.
        fields = [
            "name", "address", "color", "pay_cycle", "paid_in", "hourly_rate", "tax_rate",
            "hours_limit", "limit_period",
            "week_starts_on", "month_starts_on",
            "is_default",
        ]
        labels = {
            "name": "Workplace name",
            "address": "Address (optional)",
            "color": "Colour",
            "pay_cycle": "How this job pays",
            "paid_in": "How you're paid",
            "hourly_rate": "Hourly rate (optional)",
            "tax_rate": "Tax withheld % (optional)",
            "hours_limit": "Hours limit here (optional)",
            "limit_period": "Applies",
            "week_starts_on": "Week starts on",
            "month_starts_on": "Month starts on day",
            "is_default": "Use as my default workplace",
        }
        widgets = {
            "name": forms.TextInput(attrs={"placeholder": "e.g. Courtlands Aged Care", "autofocus": True}),
            # Swatches rather than a dropdown of colour names: the choice is
            # which colour, and a list reading "Blue, Green, Orange" makes you
            # picture the thing you could simply have been shown.
            "color": forms.RadioSelect,
            "address": forms.TextInput(attrs={"placeholder": "Street, suburb"}),
            "hourly_rate": forms.NumberInput(attrs={"step": "0.01", "min": "0", "inputmode": "decimal"}),
            "tax_rate": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "max": "100",
                       "inputmode": "decimal", "placeholder": "e.g. 10.8"}
            ),
            "hours_limit": forms.NumberInput(
                attrs={"step": "0.5", "min": "0", "inputmode": "decimal", "placeholder": "e.g. 48"}
            ),
            "month_starts_on": forms.NumberInput(
                attrs={"min": "1", "max": str(MAX_MONTH_START_DAY), "inputmode": "numeric"}
            ),
        }
        help_texts = {
            "color": "How this job is marked on the calendar and beside its shifts.",
            "pay_cycle": (
                "On a cycle, the pay run uses the same week / fortnight / month "
                "settings below — payday is the last day of each run."
            ),
            "paid_in": (
                "Cash in hand has no tax to take off, so the withholding "
                "below drops away and every figure is simply what you earned."
            ),
            "tax_rate": "From a payslip: tax withheld ÷ gross × 100. Leave blank to show pay before tax.",
            "hours_limit": "Counted against this workplace only. Leave blank for no limit.",
            "week_starts_on": "Used for a weekly limit, and for this job's week totals.",
            "month_starts_on": f"1–{MAX_MONTH_START_DAY}. Use the day your pay month opens.",
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        # A colour is never something you have to choose: one is always
        # already selected, and anything posting this form without one — a
        # script, an older client — gets the next free colour rather than an
        # error about a field it never saw.
        self.fields["color"].required = False
        # Nor is how it pays: left out, a workplace keeps what it has, and a
        # new one opens as "whenever I'm paid" — which is the case that needs
        # no setting up at all.
        self.fields["pay_cycle"].required = False
        # Nor is how you are handed it: an older client that never saw the
        # field leaves a workplace as it was rather than failing on it.
        self.fields["paid_in"].required = False
        self._add_fortnight_fields()
        # Asked for in the order the cap is: which period, then where each
        # period starts — the fortnight's two answers beside the week's one.
        self.order_fields([
            "name", "address", "color", "pay_cycle", "paid_in", "hourly_rate", "tax_rate",
            "hours_limit", "limit_period",
            "week_starts_on", "fortnight_starts_on", "fortnight_phase", "month_starts_on",
            "is_default",
        ])

    def clean_pay_cycle(self):
        return self.cleaned_data.get("pay_cycle") or self.instance.pay_cycle

    def clean_paid_in(self):
        return self.cleaned_data.get("paid_in") or self.instance.paid_in

    def clean(self):
        """
        A cash job keeps no withholding percentage.

        The field is hidden the moment cash is chosen, but a form can be sent
        without ever seeing that — so the value is dropped here rather than
        left on the row to reappear if the job is switched back.
        """
        cleaned = super().clean()
        if cleaned.get("paid_in") == PaidIn.CASH:
            cleaned["tax_rate"] = None
        self._resolve_fortnight(cleaned)
        return cleaned

    def clean_color(self):
        """Blank keeps what this workplace already has; a new one is dealt a
        free colour by `Workplace.save`."""
        return self.cleaned_data.get("color") or self.instance.color

    def clean_hours_limit(self):
        hours = self.cleaned_data.get("hours_limit")
        if hours is not None and hours <= 0:
            raise ValidationError("An hours limit has to be more than zero. Leave it blank for no limit.")
        return hours

    def clean_name(self):
        name = (self.cleaned_data.get("name") or "").strip()
        if not name:
            raise ValidationError("Give the workplace a name.")

        # The model's unique constraint would raise IntegrityError at save
        # time; catching it here turns it into a normal field error.
        clash = Workplace.objects.filter(user=self.user, name__iexact=name)
        if self.instance.pk:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise ValidationError("You already have a workplace with that name.")
        return name


class ShiftForm(forms.ModelForm):
    """
    One shift's times, used both to correct a recorded shift and to enter a
    day you forgot to clock in on. Because a typed-in shift has none of the
    guards a live clock-in has, the checks it would have got at the button —
    not two shifts at once, not a time that hasn't happened — are done here.
    """

    clock_in = LocalDateTimeField(label="Clock in")
    clock_out = LocalDateTimeField(label="Clock out", required=False)

    # A typed date can land anywhere; a few minutes of tolerance keeps a phone
    # whose clock runs slightly fast from arguing about "now".
    FUTURE_GRACE = timedelta(minutes=5)

    class Meta:
        model = Shift
        fields = ["workplace", "clock_in", "clock_out", "note"]
        widgets = {"note": forms.Textarea(attrs={"rows": 2, "placeholder": "Anything worth remembering"})}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        # Only ever offer this user's own workplaces, plus whichever one this
        # shift already points at even if it has since been archived.
        qs = Workplace.objects.filter(user=user)
        if self.instance.pk and self.instance.workplace_id:
            qs = qs | Workplace.objects.filter(pk=self.instance.workplace_id)
        self.fields["workplace"].queryset = qs.distinct()
        self.fields["workplace"].empty_label = "No workplace"

    def _clashing_shift(self, start, end):
        """
        Another of this user's shifts covering any of the same time.

        Entering a day from memory is exactly when a shift gets added twice,
        or added over one that was recorded after all, so the overlap is worth
        catching before it quietly doubles a total. An unfinished shift has no
        end yet, so it's treated as running up to the far edge of the range.
        """
        if self.user is None:
            return None

        far_future = timezone.now() + timedelta(days=365 * 10)
        others = Shift.objects.filter(user=self.user).select_related("workplace")
        if self.instance.pk:
            others = others.exclude(pk=self.instance.pk)

        return (
            others.filter(clock_in__lt=end or far_future)
            .filter(Q(clock_out__isnull=True) | Q(clock_out__gt=start))
            .order_by("-clock_in")
            .first()
        )

    def clean(self):
        cleaned = super().clean()
        start, end = cleaned.get("clock_in"), cleaned.get("clock_out")

        if start and end and end <= start:
            self.add_error("clock_out", "Clock-out has to be after clock-in.")
            return cleaned

        cutoff = timezone.now() + self.FUTURE_GRACE
        if start and start > cutoff:
            self.add_error("clock_in", "That's in the future. A shift can only be added once it's been worked.")
        if end and end > cutoff:
            self.add_error("clock_out", "That's in the future. Leave it empty if the shift is still running.")

        if start and not self.errors:
            clash = self._clashing_shift(start, end)
            if clash is not None:
                where = clash.workplace.name if clash.workplace else "no workplace"
                when = timezone.localtime(clash.clock_in)
                if clash.clock_out:
                    span = f"{when:%-I:%M %p}–{timezone.localtime(clash.clock_out):%-I:%M %p}"
                else:
                    span = f"{when:%-I:%M %p} and still running"
                self.add_error(
                    "clock_in",
                    f"This overlaps a shift you already have at {where} on {when:%-d %b} ({span}).",
                )

        return cleaned


class BreakForm(forms.ModelForm):
    break_start = LocalDateTimeField(label="Break start")
    break_end = LocalDateTimeField(label="Break end", required=False)

    class Meta:
        model = Break
        fields = ["break_start", "break_end"]

    def clean(self):
        cleaned = super().clean()
        start, end = cleaned.get("break_start"), cleaned.get("break_end")
        if start and end and end <= start:
            self.add_error("break_end", "A break can't end before it started.")
        return cleaned


class BaseBreakFormSet(forms.BaseInlineFormSet):
    """Checks the breaks against each other and against the shift's own span."""

    def clean(self):
        super().clean()
        if any(self.errors):
            return

        spans = []
        for form in self.forms:
            if not form.cleaned_data or form.cleaned_data.get("DELETE"):
                continue
            start = form.cleaned_data.get("break_start")
            end = form.cleaned_data.get("break_end")
            if not start:
                continue

            shift_in = self.instance.clock_in
            shift_out = self.instance.clock_out
            if shift_in and start < shift_in:
                form.add_error("break_start", "A break can't start before the shift did.")
            if shift_out:
                if start > shift_out:
                    form.add_error("break_start", "A break can't start after the shift ended.")
                if end and end > shift_out:
                    form.add_error("break_end", "A break can't end after the shift did.")
            spans.append((start, end, form))

        # Overlapping breaks would double-count against the worked total.
        spans.sort(key=lambda s: s[0])
        for (a_start, a_end, _), (b_start, b_end, b_form) in zip(spans, spans[1:]):
            if a_end is None or b_start < a_end:
                b_form.add_error("break_start", "This break overlaps the one before it.")


BreakFormSet = inlineformset_factory(
    Shift, Break, form=BreakForm, formset=BaseBreakFormSet, extra=0, can_delete=True
)


class TimePreferenceForm(FortnightFields, forms.ModelForm):
    """
    Where your own week, fortnight and month begin.

    These drive the figures that span every workplace, and the calendar grid.
    A workplace's own limit is measured over that workplace's cycle instead,
    set on the workplace itself.
    """

    class Meta:
        model = TimePreference
        fields = ["week_starts_on", "month_starts_on"]
        labels = {
            "week_starts_on": "Week starts on",
            "month_starts_on": "Month starts on day",
        }
        widgets = {
            "month_starts_on": forms.NumberInput(
                attrs={"min": "1", "max": str(MAX_MONTH_START_DAY), "inputmode": "numeric"}
            ),
        }
        help_texts = {
            "week_starts_on": "Also sets which day the calendar grid starts on.",
            "month_starts_on": f"1–{MAX_MONTH_START_DAY}. Use 1 for the calendar month.",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._add_fortnight_fields()
        self.order_fields(["week_starts_on", "fortnight_starts_on", "fortnight_phase", "month_starts_on"])

    def clean(self):
        cleaned = super().clean()
        self._resolve_fortnight(cleaned)
        return cleaned
