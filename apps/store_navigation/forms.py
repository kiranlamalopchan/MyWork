from django import forms

from .models import Store


class StoreMapForm(forms.Form):
    store = forms.ModelChoiceField(queryset=Store.objects.order_by("name", "pk"), empty_label="Choose a warehouse")
    q = forms.CharField(label="Product name, SKU, or barcode", max_length=200, required=False,
                        widget=forms.TextInput(attrs={"placeholder": "Name, SKU, or barcode", "type": "search", "data-scan-field": "product", "autocomplete": "off", "autocapitalize": "off", "spellcheck": "false"}))
    sku = forms.CharField(max_length=50, required=False, widget=forms.HiddenInput)
    start_node_id = forms.CharField(max_length=50, required=False, widget=forms.HiddenInput)


class PickOrderForm(forms.ModelForm):
    class Meta:
        from .models import PickOrder
        model = PickOrder
        fields = ("store", "reference")
        labels = {"store": "Warehouse", "reference": "Customer / order reference"}


class AddPickItemForm(forms.Form):
    location = forms.ModelChoiceField(queryset=None, label="Product")
    quantity = forms.IntegerField(min_value=1, max_value=10000, initial=1)

    def __init__(self, *args, store, query="", **kwargs):
        super().__init__(*args, **kwargs)
        from .models import ProductLocation
        from django.db.models import Q
        matches = ProductLocation.objects.filter(store=store)
        if query:
            matches = matches.filter(Q(product__title__icontains=query) | Q(product__sku__icontains=query) | Q(product__barcode__iexact=query))
        matches = matches.order_by("product__title", "pk")
        self.fields["location"].queryset = ProductLocation.objects.filter(pk__in=matches.values("pk")[:50]).select_related("product").order_by("product__title")
        self.fields["location"].label_from_instance = lambda obj: f"{obj.product.title} ({obj.product.sku}) — {obj.storage_label}"


class ConfirmPickForm(forms.Form):
    product_code = forms.CharField(max_length=100, label="Scan product barcode / SKU")
    quantity = forms.IntegerField(min_value=1, max_value=10000, initial=1, label="Quantity collected")


class WarehouseLocationForm(forms.ModelForm):
    class Meta:
        from .models import ProductLocation
        model = ProductLocation
        fields = ("zone", "rack", "shelf", "bin", "map_node")
        labels = {"map_node": "Walking destination on map"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from .models import MapNode
        self.fields["map_node"].queryset = MapNode.objects.filter(store=self.instance.store)
        for field in ("zone", "rack", "shelf", "bin"):
            self.fields[field].required = True


class NewWarehouseProductForm(forms.Form):
    store = forms.ModelChoiceField(queryset=Store.objects.all(), widget=forms.HiddenInput)
    barcode = forms.CharField(max_length=100, label="Product barcode", widget=forms.TextInput(attrs={
        "autocomplete": "off", "autocapitalize": "off", "spellcheck": "false", "data-scan-field": "product",
    }))
    title = forms.CharField(max_length=200, label="Product name")
    zone = forms.CharField(max_length=50)
    rack = forms.CharField(max_length=50)
    shelf = forms.CharField(max_length=50)
    bin = forms.CharField(max_length=50)
    map_node = forms.ModelChoiceField(queryset=None, label="Map destination", empty_label="Choose a point beside the rack")

    def __init__(self, *args, warehouse, **kwargs):
        super().__init__(*args, **kwargs)
        from .models import MapNode
        self.fields["barcode"].widget.attrs["data-scan-next"] = "#id_title"
        self.fields["store"].queryset = Store.objects.filter(pk=warehouse.pk)
        self.fields["store"].initial = warehouse.pk
        self.fields["map_node"].queryset = MapNode.objects.filter(store=warehouse).order_by("node_id")
        self.fields["map_node"].label_from_instance = lambda node: node.node_id.replace("_", " ").title()

    def clean_barcode(self):
        from .models import Product
        barcode = self.cleaned_data["barcode"]
        if Product.objects.filter(barcode=barcode).exists():
            raise forms.ValidationError("This barcode already belongs to a product. Search for it in the warehouse map instead.")
        return barcode
