"""Map-relative instructions, without claiming uncalibrated coordinates are metres."""


def route_instructions(points):
    directions = []
    for start, end in zip(points, points[1:]):
        dx, dy = end[0] - start[0], end[1] - start[1]
        if dx == 0 and dy == 0:
            continue
        if abs(dx) >= abs(dy):
            direction = "right" if dx > 0 else "left"
        else:
            direction = "bottom" if dy > 0 else "top"
        if not directions or directions[-1] != direction:
            directions.append(direction)
    return [f"Follow the highlighted walkway towards the {direction} of the map." for direction in directions]
