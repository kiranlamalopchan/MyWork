from django.contrib import admin
from .models import PluItem

@admin.register(PluItem)
class PluItemAdmin(admin.ModelAdmin):
    list_display = ("plu_no", "description")
    search_fields = ("plu_no", "description")