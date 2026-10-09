from django.conf import settings
from django.db import models
from django.db.models.functions import Lower
import uuid


class Catalogue(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="item_catalogues")
    name = models.CharField(max_length=100, default="My items")
    headers = models.JSONField(default=list)
    title_column = models.CharField(max_length=100)
    description_column = models.CharField(max_length=100, blank=True)
    code_column = models.CharField(max_length=100, blank=True)
    search_columns = models.JSONField(default=list)

    class Meta:
        constraints = [models.UniqueConstraint(Lower("name"), "owner", name="private_catalogue_name")]

    def __str__(self):
        return f"{self.name} ({self.owner})"


class PluItem(models.Model):
    # Unassigned legacy rows stay stored, but are never shown to app users.
    catalogue = models.ForeignKey(Catalogue, null=True, blank=True, on_delete=models.CASCADE, related_name="items")
    plu_no = models.IntegerField(null=True, blank=True)
    description = models.TextField()
    title = models.TextField(blank=True)
    code = models.CharField(max_length=100, blank=True)
    fields = models.JSONField(default=dict)
    search_text = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["catalogue", "plu_no"], name="private_plu_number")]

    def __str__(self):
        return f"{self.code or self.plu_no or ''} - {self.title or self.description}"


class CatalogueUpload(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    filename = models.CharField(max_length=255, default="items.csv")
    headers = models.JSONField()
    rows = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
