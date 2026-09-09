"""
The two things you can change about yourself: your picture, and your details.

They are separate forms because they are separate decisions made in separate
places — the picture is changed from the menu on the picture itself, the rest
on an edit screen you go to on purpose. One combined form would mean picking a
photo could only be saved by also submitting whatever half-typed name happened
to be in the box at the time.
"""

from django import forms

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

    The email lives on the account rather than the profile — it is what an
    account is reached at, not how it is shown — so it is carried here as a
    field of its own and written back to the user on save. Registering never
    asks for one, which makes this the only place it can be set at all.
    """

    email = forms.EmailField(
        required=False,
        label="Email",
        widget=forms.EmailInput(attrs={
            "placeholder": "you@example.com",
            "autocomplete": "email",
            "inputmode": "email",
        }),
    )

    # Email is declared on the form rather than the model, so without this it
    # would render last, after the address — the reverse of how anyone reads a
    # set of contact details.
    field_order = ["display_name", "email", "phone", "address"]

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
        # The email is the account's, so it is read from there rather than
        # from the profile this form is otherwise bound to.
        self.fields["email"].initial = self.instance.user.email

        # What a blank display name falls back to, shown greyed in the box
        # itself. A line of explanation under the field would say the same
        # thing in more words and in a place you have to look away to read.
        self.fields["display_name"].widget.attrs["placeholder"] = (
            self.instance.user.get_username()
        )

    def clean_display_name(self):
        return self.cleaned_data["display_name"].strip()

    def clean_phone(self):
        return self.cleaned_data["phone"].strip()

    def clean_address(self):
        return self.cleaned_data["address"].strip()

    def save(self, commit=True):
        profile = super().save(commit=False)
        email = self.cleaned_data.get("email", "").strip()
        if commit:
            profile.save()
            if profile.user.email != email:
                profile.user.email = email
                profile.user.save(update_fields=["email"])
        return profile
