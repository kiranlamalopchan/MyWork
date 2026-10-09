from django.contrib import admin
from .models import Catalogue, PluItem


@admin.register(PluItem)
class PluItemAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "catalogue", "plu_no")
    search_fields = ("code", "title", "description")
    # Imports maintain mapped fields and the search index together.
    readonly_fields = ("catalogue", "plu_no", "code", "title", "description", "fields", "search_text")

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs if request.user.is_superuser else qs.filter(catalogue__owner=request.user)

    def has_add_permission(self, request):
        return False


@admin.register(Catalogue)
class CatalogueAdmin(admin.ModelAdmin):
    list_display = ("name", "owner")
    readonly_fields = ("owner", "name", "headers", "title_column", "description_column", "code_column", "search_columns")

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs if request.user.is_superuser else qs.filter(owner=request.user)

    def has_add_permission(self, request):
        return False
