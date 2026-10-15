"""Session-authenticated website UI for the shared navigation service."""
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.core.paginator import Paginator
from django.shortcuts import render
from django.views.decorators.http import require_GET
from urllib.parse import urlencode

from .services.guidance import route_instructions
from .forms import StoreMapForm
from .models import MapNode, ProductLocation, Store
from .services.pathfinding import InvalidMap, NodeNotFound, PathNotFound, find_shortest_path


PRODUCTS_PER_PAGE = 6


@login_required
def store_map(request):
    stores = Store.objects.order_by("name", "pk")
    initial = stores.first()
    data = request.GET.copy()
    if "store" not in data and initial:
        data["store"] = str(initial.pk)
    form = StoreMapForm(data if data else None)
    context = {"form": form, "has_stores": initial is not None, "results": [], "route": None}
    if initial and form.is_valid():
        store = form.cleaned_data["store"]
        q = form.cleaned_data["q"]
        sku = form.cleaned_data["sku"]
        locations = ProductLocation.objects.filter(store=store).select_related("product", "map_node")
        start_id = form.cleaned_data["start_node_id"]
        matches = locations.filter(
            Q(product__title__icontains=q) | Q(product__sku__icontains=q) | Q(product__barcode__iexact=q) | Q(bin_code__iexact=q)
        ).order_by("product__title", "product__sku")
        if request.GET.get("lookup") == "barcode" and q:
            matches = locations.filter(Q(product__barcode=q) | Q(product__sku=q)).order_by("product__title", "product__sku")
            exact = list(matches[:2])
            # Barcode capture opens a unique product directly, never a partial name match.
            sku = exact[0].product.sku if len(exact) == 1 else ""
        page = Paginator(matches, PRODUCTS_PER_PAGE).get_page(request.GET.get("page"))
        params = {"store": store.pk, "q": q, "sku": sku, "page": page.number}
        route_params = {**params, "start_node_id": start_id}
        choosing_position = request.GET.get("position") == "pick"
        position_nodes = []
        if choosing_position:
            # Only the position picker needs the full graph and aisle labels.
            # Ordinary browsing loads six product rows, not the whole catalogue.
            nodes = MapNode.objects.filter(store=store).order_by("node_id")
            labels = {node_pk: f"{aisle} · Bay {bay}" for node_pk, aisle, bay in
                      locations.values_list("map_node_id", "aisle_name", "bay_number")}
            position_nodes = [
                {"node": node, "label": labels.get(node.pk, node.node_id.replace("_", " ").title()),
                 "href": "?" + urlencode({**params, "start_node_id": node.node_id}) + "#floorplan"}
                for node in nodes
            ]
        context.update(
            store=store, q=q, start_id=start_id, results=page.object_list,
            open_products=(request.GET.get("view") == "products" or bool(q) or "page" in request.GET) and not sku and not choosing_position,
            open_map=bool(sku) or choosing_position or request.GET.get("view") == "map",
            page_obj=page, result_count=page.paginator.count,
            position_nodes=position_nodes, choosing_position=choosing_position,
            pick_position_url="?" + urlencode({**route_params, "position": "pick"}) + "#floorplan",
            entrance_url="?" + urlencode(params) + "#floorplan",
            previous_page_url=("?" + urlencode({**route_params, "page": page.previous_page_number()}) + "#products") if page.has_previous() else None,
            next_page_url=("?" + urlencode({**route_params, "page": page.next_page_number()}) + "#products") if page.has_next() else None,
            marker_radius=min(store.viewbox_width, store.viewbox_height) * 0.012,
        )
        if sku:
            location = locations.filter(product__sku=sku).first()
            context["location"] = location
            if location is None:
                context["route_error"] = "This product has no location in the selected store."
            elif location.map_node.store_id != store.pk:
                context["route_error"] = "This product's map location needs to be corrected."
            else:
                entrances = MapNode.objects.filter(store=store, node_type=MapNode.NodeType.ENTRANCE)
                start_id = form.cleaned_data["start_node_id"]
                start = (MapNode.objects.filter(store=store, node_id=start_id).first() if start_id else
                         entrances.filter(node_id="ENTRANCE_MAIN").first() or entrances.order_by("node_id").first())
                if start is None:
                    context["route_error"] = "The starting point is unavailable. Please ask staff to configure an entrance."
                else:
                    try:
                        route = find_shortest_path(store.pk, start.node_id, location.map_node.node_id)
                        context.update(route=route, start=start, target=location.map_node,
                                       instructions=route_instructions(route["path_points"]),
                                       route_svg_path="M " + " L ".join(f"{x},{y}" for x, y in route["path_points"]),
                                       has_walking_route=len(route["path_points"]) > 1,
                                       polyline=" ".join(f"{x},{y}" for x, y in route["path_points"]),
                                       marker_radius=min(store.viewbox_width, store.viewbox_height) * 0.012)
                    except (InvalidMap, NodeNotFound, PathNotFound) as exc:
                        context["route_error"] = str(exc)
    return render(request, "store_navigation/map.html", context)


@login_required
@require_GET
def face_texture(request):
    """Only the requesting account's face; no user ID is accepted."""
    import hashlib
    from django.core.cache import cache
    from django.http import HttpResponse, JsonResponse
    from django.utils.cache import patch_cache_control
    from apps.accounts.models import Profile
    from .services.faces import FaceUnavailable, extract_face_texture

    profile = Profile.of(request.user)
    try:
        if not profile.photo:
            raise FaceUnavailable("Add a profile photo to personalise your 3D guide.")
        with profile.photo.open("rb") as photo:
            source = photo.read()
        key = "navigation-face-v1:" + hashlib.sha256(source).hexdigest()
        texture = cache.get(key)
        if texture is None:
            texture = extract_face_texture(source)
            cache.set(key, texture, 3600)
        response = HttpResponse(texture, content_type="image/png")
    except FaceUnavailable as exc:
        response = JsonResponse({"detail": str(exc)}, status=404)
    except (OSError, ValueError):
        response = JsonResponse({"detail": "Profile photo could not be read. Please upload a new one."}, status=404)
    except ImportError:
        response = JsonResponse({"detail": "Face detection is unavailable on this server."}, status=503)
    patch_cache_control(response, private=True, no_store=True)
    response["X-Content-Type-Options"] = "nosniff"
    return response
