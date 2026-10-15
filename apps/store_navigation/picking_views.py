"""Private customer pick lists; catalogue editing follows Django permissions."""
from urllib.parse import urlencode

from django.contrib import messages
from django.contrib.auth.decorators import login_required, permission_required
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import F, Count, Sum, Q
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .forms import AddPickItemForm, ConfirmPickForm, PickOrderForm, WarehouseLocationForm
from .models import PickItem, PickOrder, ProductLocation
from .services.pathfinding import InvalidMap, NodeNotFound, PathNotFound
from .services.picking import plan_pick_route


@login_required
@require_http_methods(["GET", "POST"])
def orders(request):
    form = PickOrderForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        order = form.save(commit=False)
        order.owner = request.user
        order.save()
        return redirect("store_map:pick_order", pk=order.pk)
    owned = PickOrder.objects.filter(owner=request.user)
    counts = owned.aggregate(total=Count("pk"), open=Count("pk", filter=Q(completed_at__isnull=True)), ready=Count("pk", filter=Q(completed_at__isnull=False)))
    status = request.GET.get("status", "all")
    if status not in {"all", "open", "ready"}:
        status = "all"
    query = request.GET.get("q", "").strip()[:100]
    filtered = owned
    if status != "all":
        filtered = filtered.filter(completed_at__isnull=status == "open")
    if query:
        filtered = filtered.filter(Q(reference__icontains=query) | Q(store__name__icontains=query))
    filtered = filtered.select_related("store").annotate(line_count=Count("items"), requested_units=Sum("items__quantity"), collected_units=Sum("items__picked_quantity")).order_by("-created_at", "-pk")
    page = Paginator(filtered, 12).get_page(request.GET.get("page"))
    for order in page:
        order.requested_units = order.requested_units or 0
        order.collected_units = order.collected_units or 0
        order.progress_percent = round(100 * order.collected_units / order.requested_units) if order.requested_units else 0
    filters = [{"label": label, "value": value, "href": "?" + urlencode({"status": value, "q": query}), "active": value == status}
               for value, label in (("all", "All lists"), ("open", "Open"), ("ready", "Ready"))]
    return render(request, "store_navigation/orders.html", {
        "form": form, "orders": page, "page_obj": page, "counts": counts,
        "filters": filters, "status": status, "query": query,
    })


@login_required
@require_http_methods(["GET", "POST"])
def pick_order(request, pk):
    # Lock the parent first for every write: concurrent scans cannot over-pick.
    with transaction.atomic():
        queryset = PickOrder.objects.select_related("store", "current_node")
        if request.method == "POST":
            queryset = queryset.select_for_update(of=("self",))
        order = get_object_or_404(queryset, pk=pk, owner=request.user)
        product_query = request.GET.get("q", "")[:200].strip()
        add_form = AddPickItemForm(store=order.store, query=product_query)
        scan_form = ConfirmPickForm()
        scan_item_id = None
        action = request.POST.get("action")
        if request.method == "POST":
            if order.completed_at:
                messages.error(request, "This order is already ready for the customer. Create another pick list to collect more items.")
                return redirect("store_map:pick_order", pk=pk)
            if action == "add":
                add_form = AddPickItemForm(request.POST, store=order.store, query=product_query)
                if add_form.is_valid():
                    location = add_form.cleaned_data["location"]
                    quantity = add_form.cleaned_data["quantity"]
                    item = order.items.filter(location=location).first()
                    if item:
                        if item.quantity + quantity > 10000:
                            add_form.add_error("quantity", "The maximum per product is 10,000.")
                        else:
                            item.quantity += quantity
                            item.save(update_fields=["quantity"])
                    elif order.items.count() >= 100:
                        add_form.add_error(None, "Use at most 100 different products per pick list.")
                    else:
                        PickItem.objects.create(order=order, location=location, quantity=quantity)
                    if not add_form.errors:
                        messages.success(request, "Product added to the pick list.")
                        return redirect("store_map:pick_order", pk=pk)
            elif action == "remove":
                item = get_object_or_404(order.items, pk=request.POST.get("item", "0") if request.POST.get("item", "").isdigit() else 0)
                if item.picked_quantity:
                    messages.error(request, "A product with collected units cannot be removed.")
                else:
                    item.delete()
                return redirect("store_map:pick_order", pk=pk)
            elif action == "confirm":
                item = get_object_or_404(order.items.select_related("location__product", "location__map_node"),
                                         pk=request.POST.get("item", "0") if request.POST.get("item", "").isdigit() else 0)
                scan_item_id = item.pk
                scan_form = ConfirmPickForm(request.POST)
                if scan_form.is_valid():
                    location = item.location
                    if location.store_id != order.store_id or location.map_node.store_id != order.store_id:
                        scan_form.add_error(None, "This storage location is invalid. Ask an administrator to correct it.")
                    expected = {location.product.sku}
                    if location.product.barcode:
                        expected.add(location.product.barcode)
                    if scan_form.cleaned_data["product_code"] not in expected:
                        scan_form.add_error("product_code", "Wrong product. Scan this product's barcode or SKU label.")
                    if scan_form.cleaned_data["quantity"] > item.remaining:
                        scan_form.add_error("quantity", f"Only {item.remaining} units remain to collect.")
                    if not scan_form.errors:
                        item.picked_quantity += scan_form.cleaned_data["quantity"]
                        item.save(update_fields=["picked_quantity"])
                        order.current_node = location.map_node
                        if not order.items.exclude(picked_quantity__gte=F("quantity")).exists():
                            order.completed_at = timezone.now()
                        order.save(update_fields=["current_node", "completed_at"])
                        messages.success(request, "Pick confirmed." if not order.completed_at else "All products collected. Ready for the customer.")
                        return redirect("store_map:pick_order", pk=pk)
            else:
                messages.error(request, "Choose a valid pick-list action.")
    items = list(order.items.select_related("location__product", "location__map_node").order_by("pk"))
    plan, route_error = None, None
    try:
        plan = plan_pick_route(order, items)
        for stop in plan["stops"]:
            stop["map_url"] = reverse("store_map:index") + "?" + urlencode({"store": order.store_id, "sku": stop["item"].location.product.sku, "start_node_id": stop["start_node_id"]}) + "#floorplan"
    except (PathNotFound, NodeNotFound, InvalidMap) as exc:
        route_error = str(exc)
    total_units = sum(item.quantity for item in items)
    picked_units = sum(item.picked_quantity for item in items)
    return render(request, "store_navigation/pick_order.html", {
        "order": order, "items": items, "product_query": product_query, "add_form": add_form, "scan_form": scan_form,
        "scan_item_id": scan_item_id, "plan": plan, "route_error": route_error,
        "total_units": total_units, "picked_units": picked_units, "remaining_units": total_units - picked_units,
        "progress_percent": round(100 * picked_units / total_units) if total_units else 0,
        "completed_items": [item for item in items if not item.remaining],
        "pending_items": [item for item in items if item.remaining],
        "next_stop": plan["stops"][0] if plan and plan["stops"] else None,
        "polyline": " ".join(f"{x},{y}" for x, y in plan["path_points"]) if plan else "",
    })


@login_required
@permission_required("store_navigation.change_productlocation", raise_exception=True)
@require_http_methods(["GET", "POST"])
def edit_location(request, pk):
    location = get_object_or_404(ProductLocation.objects.select_related("product", "store"), pk=pk)
    form = WarehouseLocationForm(request.POST if request.method == "POST" else None, instance=location)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Warehouse location updated.")
        return redirect("store_map:index")
    return render(request, "store_navigation/edit_location.html", {"form": form, "location": location})


@login_required
@permission_required(("store_navigation.add_product", "store_navigation.add_productlocation"), raise_exception=True)
@require_http_methods(["GET", "POST"])
def add_product(request):
    """Save a new barcode, product and warehouse location together."""
    import uuid
    from django.db import IntegrityError
    from .forms import NewWarehouseProductForm
    from .models import Product, Store

    warehouses = Store.objects.order_by("name", "pk")
    selected = request.POST.get("store") if request.method == "POST" else request.GET.get("store")
    if selected and (not selected.isdigit() or len(selected) > 18):
        raise Http404("Warehouse not found.")
    warehouse = get_object_or_404(warehouses, pk=int(selected)) if selected else warehouses.first()
    form = None
    if warehouse:
        form = NewWarehouseProductForm(request.POST if request.method == "POST" else None, warehouse=warehouse)
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data
            try:
                with transaction.atomic():
                    product = Product.objects.create(sku="WH-" + uuid.uuid4().hex, title=data["title"], barcode=data["barcode"])
                    ProductLocation.objects.create(
                        store=warehouse, product=product, map_node=data["map_node"],
                        aisle_name=data["rack"], bay_number=1,
                        **{field: data[field] for field in ("zone", "rack", "shelf", "bin")},
                    )
            except IntegrityError:
                # The database constraint also covers simultaneous submissions.
                form.add_error("barcode", "This barcode was just added. Search for the existing product instead.")
            else:
                messages.success(request, f"{product.title} added with its warehouse location.")
                return redirect(reverse("store_map:index") + "?" + urlencode({"store": warehouse.pk, "q": product.barcode, "sku": product.sku}) + "#floorplan")
    return render(request, "store_navigation/add_product.html", {
        "form": form, "warehouse": warehouse, "warehouses": warehouses,
        "nodes": form.fields["map_node"].queryset if form else [],
    })
