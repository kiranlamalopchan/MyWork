from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User


class CsvImportForm(forms.Form):
    csv_file = forms.FileField()

    def clean_csv_file(self):
        f = self.cleaned_data["csv_file"]
        if not f.name.lower().endswith(".csv"):
            raise forms.ValidationError("Please upload a .csv file")
        return f


class RegisterForm(UserCreationForm):
    email = forms.EmailField(required=False)

    class Meta:
        model = User
        fields = ("username", "email", "password1", "password2")