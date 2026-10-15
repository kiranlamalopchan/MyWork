"""A* over a store's directed walkways, loaded in two database queries."""

import heapq
import math

from ..models import MapEdge, MapNode


class NodeNotFound(ValueError):
    pass


class PathNotFound(ValueError):
    pass


class InvalidMap(ValueError):
    pass


def load_graph(store_id):
    """Load and validate a warehouse graph in two queries."""
    points = {
        node_id: (x, y)
        for node_id, x, y in MapNode.objects.filter(store_id=store_id).values_list("node_id", "pos_x", "pos_y")
    }
    if any(not all(math.isfinite(v) for v in point) for point in points.values()):
        raise InvalidMap("Map coordinates must be finite.")

    graph = {node_id: [] for node_id in points}
    scale = 1.0
    edges = MapEdge.objects.filter(store_id=store_id).values_list(
        "from_node__node_id", "to_node__node_id", "from_node__store_id", "to_node__store_id", "weight"
    )
    for source, target, source_store, target_store, weight in edges:
        # Guard against invalid data inserted with bulk_create/update (which skip save).
        if source_store != store_id or target_store != store_id:
            raise InvalidMap("An edge connects nodes from different stores.")
        distance = math.dist(points[source], points[target])
        cost = distance if weight is None else weight
        if not math.isfinite(cost) or cost < 0:
            raise InvalidMap("Edge weights must be finite and nonnegative.")
        graph[source].append((target, cost))
        if distance:
            scale = min(scale, cost / distance)

    return points, graph, scale


def find_shortest_path(store_id, start_node_id, target_node_id, *, graph_data=None):
    """Node IDs are warehouse-local strings. Distance is the sum of edge weights."""
    points, graph, scale = graph_data if graph_data is not None else load_graph(store_id)
    for node_id in (start_node_id, target_node_id):
        if node_id not in points:
            raise NodeNotFound(f"Node '{node_id}' was not found in this store.")
    # Custom costs can be smaller than physical distance. Scaling Euclidean
    # distance keeps the heuristic admissible; zero-cost edges may reduce it to 0.
    def heuristic(node_id):
        return scale * math.dist(points[node_id], points[target_node_id])

    costs = {start_node_id: 0.0}
    parents = {}
    queue = [(heuristic(start_node_id), 0.0, start_node_id)]
    while queue:
        _, cost, current = heapq.heappop(queue)
        if cost != costs.get(current):
            continue  # An improved entry has already superseded this one.
        if current == target_node_id:
            path = [current]
            while current in parents:
                current = parents[current]
                path.append(current)
            return {
                "start_node": list(points[start_node_id]),
                "target_node": list(points[target_node_id]),
                "total_distance": cost,
                "path_points": [list(points[node]) for node in reversed(path)],
            }
        for neighbour, edge_cost in graph[current]:
            candidate = cost + edge_cost
            if candidate < costs.get(neighbour, math.inf):
                costs[neighbour] = candidate
                parents[neighbour] = current
                heapq.heappush(queue, (candidate + heuristic(neighbour), candidate, neighbour))
    raise PathNotFound("No walkable route connects the start and product location.")
