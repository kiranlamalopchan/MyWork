from django import forms

from apps.moderation.filter import REFUSED, objectionable

from .models import MAX_BODY, MAX_COMMENT, Comment, Notice, Visibility


class NoticeForm(forms.ModelForm):
    """
    One box, and who it's for. Posting to a shared board should cost a
    sentence and a tap, so audience is one extra choice on the same form
    rather than a screen of its own — and it defaults to Public, what
    posting here has always meant, so leaving it alone changes nothing.
    """

    # Not required: an omitted audience — an older client, a request built by
    # hand, a test written before this existed — should post Public, what
    # posting here has always meant, rather than fail the whole notice over
    # a field it never knew to send.
    visibility = forms.ChoiceField(
        choices=Visibility.choices,
        required=False,
        label="Who can see this",
        widget=forms.Select(attrs={"aria-label": "Who can see this notice"}),
    )

    class Meta:
        model = Notice
        fields = ["body", "visibility"]
        labels = {"body": "Notice", "visibility": "Who can see this"}
        # Django strips the field before it gets to clean_body, so a box of
        # spaces arrives here as empty — this is the message that reaches the
        # writer for both.
        error_messages = {"body": {"required": "Write something before posting."}}
        widgets = {
            "body": forms.Textarea(attrs={
                "rows": 3,
                "maxlength": str(MAX_BODY),
                "placeholder": "Share something with everyone…",
                "aria-label": "Write a notice",
            }),
        }

    def clean_body(self):
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Write something before posting.")
        if objectionable(body):
            raise forms.ValidationError(REFUSED)
        return body

    def clean_visibility(self):
        return self.cleaned_data.get("visibility") or Visibility.PUBLIC


class CommentForm(forms.ModelForm):
    """A one-line reply under a notice, with its own audience."""

    visibility = forms.ChoiceField(
        choices=Visibility.choices,
        required=False,
        label="Who can see this",
        widget=forms.Select(attrs={"aria-label": "Who can see this comment"}),
    )

    class Meta:
        model = Comment
        fields = ["body", "visibility"]
        labels = {"body": "Comment", "visibility": "Who can see this"}
        error_messages = {"body": {"required": "Write something before replying."}}
        widgets = {
            "body": forms.TextInput(attrs={
                "maxlength": str(MAX_COMMENT),
                "placeholder": "Write a comment…",
                "aria-label": "Write a comment",
                "autocomplete": "off",
            }),
        }

    def clean_body(self):
        body = (self.cleaned_data.get("body") or "").strip()
        if objectionable(body):
            raise forms.ValidationError(REFUSED)
        return body

    def clean_visibility(self):
        return self.cleaned_data.get("visibility") or Visibility.PUBLIC


# What the audience picker offers, with the icon each wears on the board —
# see `templates/noticeboard/_visibility_badge.html`.
VISIBILITY_ICONS = {
    Visibility.PUBLIC: "globe",
    Visibility.FRIENDS: "people",
    Visibility.PRIVATE: "lock",
}
