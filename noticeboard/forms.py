from django import forms

from .models import MAX_BODY, MAX_COMMENT, Comment, Notice


class NoticeForm(forms.ModelForm):
    """
    One box. Posting to a shared board should cost a sentence and a tap, so
    there is no title, no category and nothing else to fill in first.
    """

    class Meta:
        model = Notice
        fields = ["body"]
        labels = {"body": "Notice"}
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
            })
        }

    def clean_body(self):
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Write something before posting.")
        return body


class CommentForm(forms.ModelForm):
    """A one-line reply under a notice."""

    class Meta:
        model = Comment
        fields = ["body"]
        labels = {"body": "Comment"}
        error_messages = {"body": {"required": "Write something before replying."}}
        widgets = {
            "body": forms.TextInput(attrs={
                "maxlength": str(MAX_COMMENT),
                "placeholder": "Write a comment…",
                "aria-label": "Write a comment",
                "autocomplete": "off",
            })
        }
