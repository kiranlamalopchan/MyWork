"""A practical nearest-reachable-stop route over directed warehouse walkways."""
from .pathfinding import PathNotFound, find_shortest_path, load_graph


def plan_pick_route(order, items):
    pending = [item for item in items if item.remaining]
    if not pending:
        return {"stops": [], "unreachable": [], "path_points": [], "total_distance": 0}
    nodes = order.store.mapnode_set.all()
    start = order.current_node
    if start is None or start.store_id != order.store_id:
        entrances = nodes.filter(node_type="ENTRANCE")
        start = entrances.filter(node_id="ENTRANCE_MAIN").first() or entrances.order_by("node_id").first()
    if start is None:
        raise PathNotFound("Configure a warehouse entrance before creating a collection route.")
    graph = load_graph(order.store_id)
    current = start.node_id
    points, stops, total = [], [], 0
    while pending:
        choices = []
        for item in pending:
            if item.location.store_id != order.store_id or item.location.map_node.store_id != order.store_id:
                continue
            try:
                route = find_shortest_path(order.store_id, current, item.location.map_node.node_id, graph_data=graph)
                choices.append((route["total_distance"], item.pk, item, route))
            except PathNotFound:
                continue
        if not choices:
            break
        _, _, item, route = min(choices, key=lambda entry: (entry[0], entry[1]))
        stops.append({"item": item, "number": len(stops) + 1, "start_node_id": current})
        points.extend(route["path_points"] if not points else route["path_points"][1:])
        total += route["total_distance"]
        current = item.location.map_node.node_id
        pending.remove(item)
    return {"stops": stops, "unreachable": pending, "path_points": points, "total_distance": total, "start": start}
