"""Read-only APIs; authentication follows the project's DRF settings."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MapNode, ProductLocation, Store
from .serializers import (
    NavigationQuerySerializer, NodeSerializer, ProductLocationSerializer,
    RouteProductSerializer, SearchQuerySerializer,
)
from .services.pathfinding import InvalidMap, NodeNotFound, PathNotFound, find_shortest_path


class ProductSearchView(ListAPIView):
    serializer_class = ProductLocationSerializer

    def get_queryset(self):
        store = get_object_or_404(Store, pk=self.kwargs["store_id"])
        query = SearchQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        term = query.validated_data["q"]
        return ProductLocation.objects.filter(store=store).filter(
            Q(product__title__icontains=term) | Q(product__sku__icontains=term) | Q(product__barcode__iexact=term) | Q(bin_code__iexact=term)
        ).select_related("product", "map_node").order_by("product__title", "product__sku")


class NavigateView(APIView):
    def get(self, request, store_id):
        store = get_object_or_404(Store, pk=store_id)
        query = NavigationQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        location = get_object_or_404(
            ProductLocation.objects.select_related("product", "map_node"),
            store=store, product__sku=query.validated_data["sku"],
        )
        nodes = MapNode.objects.filter(store=store)
        start_id = query.validated_data.get("start_node_id")
        if start_id is not None:
            start = get_object_or_404(nodes, node_id=start_id)
        else:
            entrances = nodes.filter(node_type=MapNode.NodeType.ENTRANCE)
            # The schema has no primary flag: prefer ENTRANCE_MAIN, then a
            # stable node_id ordering so adding workers never changes a route.
            start = entrances.filter(node_id="ENTRANCE_MAIN").first() or entrances.order_by("node_id").first()
            if start is None:
                raise NotFound("This store has no entrance node.")
        if location.map_node.store_id != store.pk:
            raise ValidationError({"detail": "The product location belongs to a different store."})
        try:
            route = find_shortest_path(store.pk, start.node_id, location.map_node.node_id)
        except (NodeNotFound, PathNotFound) as exc:
            raise NotFound(str(exc)) from exc
        except InvalidMap as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response({
            "store_id": store.pk,
            "product": RouteProductSerializer(location).data,
            "floorplan_svg": store.floorplan_svg.url if store.floorplan_svg else None,
            "viewbox": {"width": store.viewbox_width, "height": store.viewbox_height},
            "start": NodeSerializer(start).data,
            "target": NodeSerializer(location.map_node).data,
            "navigation_path": route["path_points"],
            "total_distance": route["total_distance"],
        })
