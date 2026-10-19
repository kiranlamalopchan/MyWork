from django import forms

from .models import FestivalThemeSettings


class BannerImageField(forms.ImageField):
    def to_python(self, data):
        if data and getattr(data, "size", 0) > 8 * 1024 * 1024:
            raise forms.ValidationError("Choose a banner image smaller than 8 MB.")
        image = super().to_python(data)
        if image and image.image.width * image.image.height > 24_000_000:
            raise forms.ValidationError("Choose a banner image smaller than 24 megapixels.")
        return image


class FestivalBannerForm(forms.ModelForm):
    banner = BannerImageField(required=False)
    remove_banner = forms.BooleanField(required=False)

    class Meta:
        model = FestivalThemeSettings
        fields = ("theme", "banner", "greeting", "description", "remove_banner")

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("remove_banner"):
            if self.files.get("banner"):
                self.add_error("banner", "Choose a new image or remove the current image, not both.")
            else:
                cleaned["banner"] = False
        return cleaned
