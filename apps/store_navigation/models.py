"""Store maps use SVG coordinates; edges describe permitted walking directions."""

import math
import uuid

from django.conf import settings

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models


def validate_finite(value):
    if not math.isfinite(value):
        raise ValidationError("Enter a finite number.")


class Store(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    floorplan_svg = models.FileField(upload_to="floorplans/")
    viewbox_width = models.FloatField(default=1000.0, validators=[validate_finite, MinValueValidator(0.000001)])
    viewbox_height = models.FloatField(default=1000.0, validators=[validate_finite, MinValueValidator(0.000001)])

    def __str__(self):
        return self.name


class Product(models.Model):
    sku = models.CharField(max_length=50, unique=True, db_index=True)
    title = models.CharField(max_length=200)
    image_url = models.URLField(blank=True, null=True)
    barcode = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["barcode"], condition=~models.Q(barcode=""), name="warehouse_product_barcode")]

    def __str__(self):
        return f"{self.sku}: {self.title}"


class MapNode(models.Model):
    class NodeType(models.TextChoices):
        ENTRANCE = "ENTRANCE", "Entrance"
        CORRIDOR = "CORRIDOR", "Walkway Corridor"
        SHELF = "SHELF", "Product Shelf Bay"

    store = models.ForeignKey(Store, on_delete=models.CASCADE)
    node_id = models.CharField(max_length=50)
    node_type = models.CharField(max_length=10, choices=NodeType.choices)
    pos_x = models.FloatField(validators=[validate_finite])
    pos_y = models.FloatField(validators=[validate_finite])

    class Meta:
        unique_together = ("store", "node_id")

    def __str__(self):
        return f"{self.store}: {self.node_id}"


class MapEdge(models.Model):
    store = models.ForeignKey(Store, on_delete=models.CASCADE)
    from_node = models.ForeignKey(MapNode, on_delete=models.CASCADE, related_name="outgoing_edges")
    to_node = models.ForeignKey(MapNode, on_delete=models.CASCADE, related_name="incoming_edges")
    weight = models.FloatField(null=True, blank=True, validators=[validate_finite, MinValueValidator(0)])

    class Meta:
        constraints = [models.CheckConstraint(check=models.Q(weight__gte=0) | models.Q(weight__isnull=True), name="navigation_edge_weight_nonnegative")]

    def clean(self):
        super().clean()
        errors = {}
        for field in ("from_node", "to_node"):
            if getattr(self, f"{field}_id") and getattr(self, field).store_id != self.store_id:
                errors[field] = "The node must belong to this store."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        if self.weight is None:
            self.weight = math.hypot(self.from_node.pos_x - self.to_node.pos_x, self.from_node.pos_y - self.to_node.pos_y)
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"weight"}
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.from_node} → {self.to_node.node_id}"


class ProductLocation(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    store = models.ForeignKey(Store, on_delete=models.CASCADE)
    aisle_name = models.CharField(max_length=50)
    bay_number = models.IntegerField(default=1)
    map_node = models.ForeignKey(MapNode, on_delete=models.CASCADE)
    zone = models.CharField(max_length=50, blank=True)
    rack = models.CharField(max_length=50, blank=True)
    shelf = models.CharField(max_length=50, blank=True)
    bin = models.CharField(max_length=50, blank=True)
    bin_code = models.CharField(max_length=100, blank=True, help_text="Unique code printed on this storage bin label.")

    class Meta:
        unique_together = ("product", "store")

    def clean(self):
        super().clean()
        if self.map_node_id and self.map_node.store_id != self.store_id:
            raise ValidationError({"map_node": "The node must belong to this store."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.product} at {self.store}"

    @property
    def storage_label(self):
        parts = [f"{label} {value}" for label, value in
                 (("Zone", self.zone), ("Rack", self.rack), ("Shelf", self.shelf), ("Bin", self.bin)) if value]
        return " → ".join(parts) or f"{self.aisle_name} · Bay {self.bay_number}"


class PickOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    store = models.ForeignKey(Store, on_delete=models.PROTECT)
    reference = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    current_node = models.ForeignKey(MapNode, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.reference


class PickItem(models.Model):
    order = models.ForeignKey(PickOrder, on_delete=models.CASCADE, related_name="items")
    location = models.ForeignKey(ProductLocation, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    picked_quantity = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "location"], name="warehouse_order_location"),
            models.CheckConstraint(check=models.Q(quantity__gte=1), name="warehouse_pick_positive"),
            models.CheckConstraint(check=models.Q(picked_quantity__lte=models.F("quantity")), name="warehouse_pick_within_quantity"),
        ]

    @property
    def remaining(self):
        return self.quantity - self.picked_quantity

    def clean(self):
        super().clean()
        if self.order_id and self.location_id and self.order.store_id != self.location.store_id:
            raise ValidationError({"location": "The product must belong to the order's warehouse."})
