"""
The two things you can change about yourself: your picture, and your details.

They are separate forms because they are separate decisions made in separate
places — the picture is changed from the menu on the picture itself, the rest
on an edit screen you go to on purpose. One combined form would mean picking a
photo could only be saved by also submitting whatever half-typed name happened
to be in the box at the time.
"""

from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.validators import UnicodeUsernameValidator

from .models import MAX_ADDRESS, MAX_DISPLAY_NAME, MAX_PHONE, Profile

# A phone photo is a couple of megabytes; anything past this is somebody
# uploading the wrong kind of file, and it is cheaper to say so than to hand
# it to Pillow.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


class PhotoForm(forms.Form):
    """
    The picture, on its own.

    Not a ModelForm field: `Profile.set_photo` squares and shrinks the upload,
    and assigning straight to `photo` would quietly bypass that.
    """

    photo = forms.ImageField(
        label="Profile photo",
        widget=forms.ClearableFileInput(attrs={
            "accept": "image/*",
            "class": "photo-menu__file",
            "id": "avatar-input",
        }),
    )

    def clean_photo(self):
        photo = self.cleaned_data["photo"]
        if photo.size > MAX_UPLOAD_BYTES:
            raise forms.ValidationError(
                f"That image is {photo.size // (1024 * 1024)} MB. "
                f"Please pick one under {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
            )
        return photo


class ProfileForm(forms.ModelForm):
    """
    Everything about you that is words rather than a picture.

    The username and the email live on the account rather than the profile —
    one is how you sign in and are found, the other is what the account is
    reached at; neither is how you are shown — so both are carried here as
    fields of their own and written back to the user on save. Registering
    never asks for an email, which makes this the only place it can be set;
    the username it does ask for, under the same rules that apply here, and
    this is the one place it can be changed. It has to stay unique, and
    "kiran" and "Kiran" count as the same name: two people a capital letter
    apart would be told apart by nobody.
    """

    username = forms.CharField(
        max_length=150,
        label="Username",
        validators=[UnicodeUsernameValidator()],
        widget=forms.TextInput(attrs={
            "placeholder": "e.g. kiran",
            "maxlength": 150,
            "autocomplete": "username",
            "autocapitalize": "none",
            "spellcheck": "false",
        }),
    )

    email = forms.EmailField(
        required=False,
        label="Email",
        widget=forms.EmailInput(attrs={
            "placeholder": "you@example.com",
            "autocomplete": "email",
            "inputmode": "email",
        }),
    )

    # Username and email are declared on the form rather than the model, so
    # without this they would render last, after the address — the reverse of
    # how anyone reads a set of contact details.
    field_order = ["username", "display_name", "email", "phone", "address"]

    class Meta:
        model = Profile
        fields = ["display_name", "phone", "address"]
        labels = {
            "display_name": "Display name",
            "phone": "Phone",
            "address": "Address",
        }
        widgets = {
            "display_name": forms.TextInput(attrs={
                "placeholder": "e.g. Kiran L.",
                "maxlength": MAX_DISPLAY_NAME,
                "autocomplete": "name",
                "autofocus": True,
            }),
            "phone": forms.TextInput(attrs={
                "placeholder": "e.g. 0412 345 678",
                "maxlength": MAX_PHONE,
                "autocomplete": "tel",
                "inputmode": "tel",
                "type": "tel",
            }),
            "address": forms.TextInput(attrs={
                "placeholder": "Street, suburb, postcode",
                "maxlength": MAX_ADDRESS,
                "autocomplete": "street-address",
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # The username and the email are the account's, so they are read from
        # there rather than from the profile this form is otherwise bound to.
        self.fields["username"].initial = self.instance.user.get_username()
        self.fields["email"].initial = self.instance.user.email

        # What a blank display name falls back to, shown greyed in the box
        # itself. A line of explanation under the field would say the same
        # thing in more words and in a place you have to look away to read.
        self.fields["display_name"].widget.attrs["placeholder"] = (
            self.instance.user.get_username()
        )

    def clean_username(self):
        username = self.cleaned_data["username"].strip()
        taken = (
            get_user_model().objects
            .filter(username__iexact=username)
            .exclude(pk=self.instance.user_id)
            .exists()
        )
        if taken:
            raise forms.ValidationError("That username is taken.")
        return username

    def clean_display_name(self):
        return self.cleaned_data["display_name"].strip()

    def clean_phone(self):
        return self.cleaned_data["phone"].strip()

    def clean_address(self):
        return self.cleaned_data["address"].strip()

    def save(self, commit=True):
        profile = super().save(commit=False)
        username = self.cleaned_data["username"]
        email = self.cleaned_data.get("email", "").strip()
        if commit:
            profile.save()
            changed = []
            if profile.user.get_username() != username:
                profile.user.username = username
                changed.append("username")
            if profile.user.email != email:
                profile.user.email = email
                changed.append("email")
            if changed:
                profile.user.save(update_fields=changed)
        return profile
