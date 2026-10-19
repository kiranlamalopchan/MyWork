from django.db import transaction
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.holidays.festivals import THEME_CHOICES
from apps.holidays.forms import FestivalBannerForm
from apps.holidays.models import FestivalThemeSettings
from apps.holidays.permissions import can_manage_festival
from mywork.seasons import festival_banner_for

from .. import serialize
from ..errors import form_errors


class CanManageFestival(BasePermission):
    message = "Only administrators with festival-management permission can change the Home banner."

    def has_permission(self, request, view):
        return can_manage_festival(request.user)


def settings_data(request, config):
    return {
        "theme": config.theme, "greeting": config.greeting, "description": config.description,
        "banner_url": serialize.absolute(request, config.banner.url) if config.banner else None,
        "preview": serialize.festival(request, festival_banner_for(config)),
        "choices": [{"value": value, "label": label, "preview": serialize.festival(request, festival_banner_for(FestivalThemeSettings(theme=value)))} for value, label in THEME_CHOICES],
    }


class FestivalSettings(APIView):
    permission_classes = [CanManageFestival]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def get(self, request):
        config = FestivalThemeSettings.objects.filter(pk=1).first() or FestivalThemeSettings()
        return Response(settings_data(request, config))

    @transaction.atomic
    def patch(self, request):
        config = FestivalThemeSettings.objects.select_for_update().filter(pk=1).first() or FestivalThemeSettings(pk=1)
        values = {"theme": config.theme, "greeting": config.greeting, "description": config.description}
        if not isinstance(request.data, dict):
            return Response({"detail": "Provide festival banner settings."}, status=400)
        values.update({key: request.data[key] for key in ("theme", "greeting", "description", "remove_banner", "banner") if key in request.data})
        form = FestivalBannerForm(values, request.FILES, instance=config)
        if not form.is_valid():
            return Response(form_errors(form), status=400)
        form.save()
        return Response(settings_data(request, config))
