from datetime import timedelta

from django import forms
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.forms import inlineformset_factory
from django.utils import timezone

from .models import (
    MAX_MONTH_START_DAY, Break, PaidIn, Payslip, Shift, TimePreference,
    Workplace, fortnight_runs,
)

# What a payslip can arrive as. HEIC is missing on purpose: iPhones send JPEG
# to anything that asks for an upload, and a format the server cannot open
# would fail after the wait rather than before it.
PAYSLIP_TYPES = (".pdf", ".jpg", ".jpeg", ".png", ".webp")

# A phone photo of one page. Anything larger is a video, a scan of a whole
# folder, or a mistake.
PAYSLIP_MAX_MB = 12

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


def _say_which_days(form):
    """
    Spell out the cycle the chosen anchor actually produces.

    The field asks for a date, but what it sets is a weekday: every cycle
    from then on starts on the same day of the week. Saying so under the box
    turns a date nobody can read a rule out of into a rule you can check.
    """
    field = form.fields["fortnight_anchor"]
    anchor = getattr(form.instance, "fortnight_anchor", None)
    if anchor:
        field.help_text = f"{field.help_text} Fortnights run {fortnight_runs(anchor)}."


class WorkplaceForm(forms.ModelForm):
    """
    Everything about one workplace, its own hours cap included — the cap is
    per workplace, so this is the only screen that sets it.
    """

    class Meta:
        model = Workplace
        fields = [
            "name", "address", "color", "pay_cycle", "paid_in", "hourly_rate", "tax_rate",
            "hours_limit", "limit_period",
            "week_starts_on", "fortnight_anchor", "month_starts_on",
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
            "fortnight_anchor": "Fortnight starts from",
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
            "fortnight_anchor": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
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
            "fortnight_anchor": "Any date this job's fortnight cycle has started on.",
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
        _say_which_days(self)

    def clean_pay_cycle(self):
        return self.cleaned_data.get("pay_cycle") or self.instance.pay_cycle

    def clean_paid_in(self):
        return self.cleaned_data.get("paid_in") or self.instance.paid_in

    def clean(self):
        """
        A cash job keeps no withholding percentage.

        The field is hidden the moment cash is chosen, but a form can be sent
        without ever seeing that — so the value is dropped here rather than
        left on the row to reappear if the job is switched back and confuse
        the next payslip that gets read.
        """
        cleaned = super().clean()
        if cleaned.get("paid_in") == PaidIn.CASH:
            cleaned["tax_rate"] = None
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
        clash = Workplace.objects.filter(user=self.user, name__iexact=name, is_archived=False)
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
        qs = Workplace.objects.filter(user=user, is_archived=False)
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


class TimePreferenceForm(forms.ModelForm):
    """
    Where your own week, fortnight and month begin.

    These drive the figures that span every workplace, and the calendar grid.
    A workplace's own limit is measured over that workplace's cycle instead,
    set on the workplace itself.
    """

    class Meta:
        model = TimePreference
        fields = ["week_starts_on", "fortnight_anchor", "month_starts_on"]
        labels = {
            "week_starts_on": "Week starts on",
            "fortnight_anchor": "Fortnight starts from",
            "month_starts_on": "Month starts on day",
        }
        widgets = {
            "fortnight_anchor": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
            "month_starts_on": forms.NumberInput(
                attrs={"min": "1", "max": str(MAX_MONTH_START_DAY), "inputmode": "numeric"}
            ),
        }
        help_texts = {
            "week_starts_on": "Also sets which day the calendar grid starts on.",
            "fortnight_anchor": "Any date your fortnight cycle has started on.",
            "month_starts_on": f"1–{MAX_MONTH_START_DAY}. Use 1 for the calendar month.",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _say_which_days(self)


class PayslipUploadForm(forms.Form):
    """
    The file itself, and nothing else.

    Deliberately one field. Reading the numbers off it is the app's job, and
    asking somebody to type the figures they are in the middle of uploading
    would make the upload pointless.
    """

    file = forms.FileField(
        label="Payslip",
        help_text="A PDF from payroll, or a photo of the paper one.",
        widget=forms.ClearableFileInput(
            attrs={
                "accept": ",".join(PAYSLIP_TYPES) + ",image/*",
                "class": "visually-hidden-input",
                "id": "payslip-input",
            }
        ),
    )

    def clean_file(self):
        upload = self.cleaned_data["file"]
        name = (upload.name or "").lower()

        if not name.endswith(PAYSLIP_TYPES):
            raise ValidationError(
                "That has to be a PDF or a photo — "
                f"{', '.join(t.lstrip('.') for t in PAYSLIP_TYPES)}."
            )
        if upload.size > PAYSLIP_MAX_MB * 1024 * 1024:
            raise ValidationError(
                f"That file is over {PAYSLIP_MAX_MB}MB. A photo of one page "
                "is usually well under it."
            )
        return upload


class PayslipForm(forms.ModelForm):
    """
    The figures, for a person to read back off the paper and correct.

    Every one of them is optional. A slip that prints no net, or a photo that
    cut off the super line, is still worth keeping for the figures it does
    have — and an empty box is an honest way to say "this was not on it",
    which a zero would not be.
    """

    class Meta:
        model = Payslip
        fields = [
            "period_start", "period_end", "paid_on",
            "hours", "rate", "gross", "tax", "net", "super_amount",
        ]
        labels = {
            "period_start": "Period from",
            "period_end": "Period to",
            "paid_on": "Paid on",
            "hours": "Hours",
            "rate": "Hourly rate",
            "gross": "Gross",
            "tax": "Tax withheld",
            "net": "Net (take-home)",
            "super_amount": "Super",
        }
        widgets = {
            "period_start": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
            "period_end": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
            "paid_on": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
            "hours": forms.NumberInput(
                attrs={"step": "0.0001", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 51.7834"}
            ),
            "rate": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 33.25"}
            ),
            "gross": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 1721.80"}
            ),
            "tax": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 186.00"}
            ),
            "net": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 1535.80"}
            ),
            "super_amount": forms.NumberInput(
                attrs={"step": "0.01", "min": "0", "inputmode": "decimal",
                       "placeholder": "e.g. 198.01"}
            ),
        }

    def clean(self):
        cleaned = super().clean()
        opens, closes = cleaned.get("period_start"), cleaned.get("period_end")
        if opens and closes and opens > closes:
            self.add_error("period_end", "The period ends before it starts.")

        gross, tax, net = cleaned.get("gross"), cleaned.get("tax"), cleaned.get("net")
        # Not an error. A payslip with a rounding cent out of place is still
        # the real payslip, and refusing to save it would help nobody — but
        # the page says so, loudly, beside the figure.
        if gross is not None and tax is not None and net is None:
            cleaned["net"] = gross - tax
        return cleaned
