"""
How the API says no.

DRF already turns its own exceptions into {"detail": …}; this adds the
site's — a story that can't be used, a form that didn't validate — so the
app can show the same sentence the site would have.
"""

from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.stories.models import Unusable


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        return response
    if isinstance(exc, Unusable):
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, ValidationError):
        return Response({"detail": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
    return None


def form_errors(form):
    """A Django form's errors as {detail, fields} — the first message as the
    sentence to show, every field's under its name."""
    fields = {name: [str(e) for e in errors] for name, errors in form.errors.items()}
    first = next((errors[0] for errors in fields.values() if errors), "Please check what you entered.")
    return {"detail": first, "fields": fields}
