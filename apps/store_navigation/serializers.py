from rest_framework import serializers

from .models import ProductLocation


class SearchQuerySerializer(serializers.Serializer):
    q = serializers.CharField(max_length=200)


class NavigationQuerySerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=50)
    start_node_id = serializers.CharField(max_length=50, required=False)

    def validate(self, attrs):
        # DRF treats an empty optional HTML query parameter as omitted.
        # A supplied empty identifier is an invalid start, not a default.
        if "start_node_id" in self.initial_data and not self.initial_data["start_node_id"].strip():
            raise serializers.ValidationError({"start_node_id": "This field may not be blank."})
        return attrs


class ProductLocationSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source="product.sku", read_only=True)
    title = serializers.CharField(source="product.title", read_only=True)
    image_url = serializers.URLField(source="product.image_url", read_only=True)
    map_node = serializers.SerializerMethodField()

    class Meta:
        model = ProductLocation
        fields = ("sku", "title", "image_url", "aisle_name", "bay_number", "zone", "rack", "shelf", "bin", "bin_code", "map_node")
        read_only_fields = fields

    def get_map_node(self, obj):
        return [obj.map_node.pos_x, obj.map_node.pos_y]


class RouteProductSerializer(serializers.Serializer):
    sku = serializers.CharField(source="product.sku")
    title = serializers.CharField(source="product.title")
    aisle = serializers.CharField(source="aisle_name")
    bay = serializers.IntegerField(source="bay_number")


class NodeSerializer(serializers.Serializer):
    node_id = serializers.CharField()
    coords = serializers.SerializerMethodField()

    def get_coords(self, obj):
        return [obj.pos_x, obj.pos_y]
