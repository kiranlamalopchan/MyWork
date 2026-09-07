from django import forms
from django.core.exceptions import ValidationError
from django.forms import inlineformset_factory

from .models import Break, Shift, TimePreference, Workplace

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


class WorkplaceForm(forms.ModelForm):
    class Meta:
        model = Workplace
        fields = ["name", "address", "hourly_rate", "is_default"]
        labels = {
            "name": "Workplace name",
            "address": "Address (optional)",
            "hourly_rate": "Hourly rate (optional)",
            "is_default": "Use as my default workplace",
        }
        widgets = {
            "name": forms.TextInput(attrs={"placeholder": "e.g. Courtlands Aged Care", "autofocus": True}),
            "address": forms.TextInput(attrs={"placeholder": "Street, suburb"}),
            "hourly_rate": forms.NumberInput(attrs={"step": "0.01", "min": "0", "inputmode": "decimal"}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

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
    clock_in = LocalDateTimeField(label="Clock in")
    clock_out = LocalDateTimeField(label="Clock out", required=False)

    class Meta:
        model = Shift
        fields = ["workplace", "clock_in", "clock_out", "note"]
        widgets = {"note": forms.Textarea(attrs={"rows": 2, "placeholder": "Anything worth remembering"})}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        # Only ever offer this user's own workplaces, plus whichever one this
        # shift already points at even if it has since been archived.
        qs = Workplace.objects.filter(user=user, is_archived=False)
        if self.instance.pk and self.instance.workplace_id:
            qs = qs | Workplace.objects.filter(pk=self.instance.workplace_id)
        self.fields["workplace"].queryset = qs.distinct()
        self.fields["workplace"].empty_label = "No workplace"

    def clean(self):
        cleaned = super().clean()
        start, end = cleaned.get("clock_in"), cleaned.get("clock_out")
        if start and end and end <= start:
            self.add_error("clock_out", "Clock-out has to be after clock-in.")
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
    class Meta:
        model = TimePreference
        fields = ["hours_limit", "limit_period", "fortnight_anchor"]
        labels = {
            "hours_limit": "Hours limit",
            "limit_period": "Applies",
            "fortnight_anchor": "Fortnight starts from",
        }
        widgets = {
            "hours_limit": forms.NumberInput(
                attrs={"step": "0.5", "min": "0", "inputmode": "decimal", "placeholder": "e.g. 48"}
            ),
            "fortnight_anchor": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
        }
        help_texts = {
            "hours_limit": "Leave blank for no limit.",
            "fortnight_anchor": "Any Monday your fortnight cycle has started on.",
        }
