#!/usr/bin/env python3
"""JSON-lines yard generator.

Reads one JSON object per stdin line:
  { "cmd": "ping" }
  { "cmd": "generate", "id": "...", "boundary": GeoJSON Polygon,
    "bufferMeters": 50, "cacheDir": "...", "rotationDeg": 0 }

Writes one JSON object per stdout line. Heavy GIS libraries are optional:
Overpass + shapely is the default path. OpenCV pavement detection runs when
an ortho JPEG can be fetched from a keyless public WMS.
"""

from __future__ import annotations

import json
import math
import os
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

GENERATOR_VERSION = '1'
BUFFER_METERS = 50
SIMPLIFY_METERS = 0.8
METERS_PER_DEG_LAT = 110540.0
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
USER_AGENT = 'SensibleLogistics/1.0 (yard-visualizer; https://github.com/zodyking/Sensible-Logistics)'

WMS_SOURCES = [
    # NY statewide orthos — no API key
    'https://orthos.its.ny.gov/arcgis/services/wms/latest/MapServer/WMSServer',
    # NJ statewide imagery — no API key
    'https://maps.nj.gov/arcgis/services/Imagery/Latest/ImageServer/WMSServer',
    # USGS NAIP nationwide fallback
    'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage',
]


def _meters_per_deg_lon(lat: float) -> float:
    return 111320.0 * math.cos(math.radians(lat))


def _bbox_from_polygon(polygon: dict) -> dict | None:
    ring = (polygon.get('coordinates') or [[]])[0]
    if not ring:
        return None
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return {
        'west': min(lons),
        'east': max(lons),
        'south': min(lats),
        'north': max(lats),
    }


def _buffer_bbox(box: dict, meters: float) -> dict:
    lat_mid = (box['north'] + box['south']) / 2.0
    d_lat = meters / METERS_PER_DEG_LAT
    d_lon = meters / max(_meters_per_deg_lon(lat_mid), 1.0)
    return {
        'west': box['west'] - d_lon,
        'east': box['east'] + d_lon,
        'south': box['south'] - d_lat,
        'north': box['north'] + d_lat,
    }


def _origin_from_box(box: dict, rotation_deg: float) -> dict:
    lat_mid = (box['north'] + box['south']) / 2.0
    width = abs(box['east'] - box['west']) * max(_meters_per_deg_lon(lat_mid), 1.0)
    height = abs(box['north'] - box['south']) * METERS_PER_DEG_LAT
    return {
        'originLng': box['west'],
        'originLat': box['south'],
        'planeWidth': max(24.0, width),
        'planeHeight': max(24.0, height),
        'rotationDeg': rotation_deg,
    }


def _lnglat_to_local(origin: dict, lat: float, lng: float) -> tuple[float, float]:
    lat_mid = origin['originLat'] + (origin['planeHeight'] / 2.0) / METERS_PER_DEG_LAT
    x = (lng - origin['originLng']) * max(_meters_per_deg_lon(lat_mid), 1.0)
    y = (lat - origin['originLat']) * METERS_PER_DEG_LAT
    return x, y


def _local_to_lnglat(origin: dict, x: float, y: float) -> tuple[float, float]:
    lat_mid = origin['originLat'] + (origin['planeHeight'] / 2.0) / METERS_PER_DEG_LAT
    lat = origin['originLat'] + y / METERS_PER_DEG_LAT
    lng = origin['originLng'] + x / max(_meters_per_deg_lon(lat_mid), 1.0)
    return lat, lng


def _map_coords(coords: Any, fn) -> Any:
    if not coords:
        return coords
    if isinstance(coords[0], (int, float)):
        return list(fn(coords[0], coords[1]))
    return [_map_coords(item, fn) for item in coords]


def _geo_to_local(geometry: dict, origin: dict) -> dict:
    def fn(lng: float, lat: float):
        x, y = _lnglat_to_local(origin, lat, lng)
        return x, y
    return {'type': geometry['type'], 'coordinates': _map_coords(geometry.get('coordinates'), fn)}


def _local_to_geo(geometry: dict, origin: dict) -> dict:
    def fn(x: float, y: float):
        lat, lng = _local_to_lnglat(origin, x, y)
        return lng, lat
    return {'type': geometry['type'], 'coordinates': _map_coords(geometry.get('coordinates'), fn)}


def _http_json(url: str, data: bytes | None = None, timeout: int = 25) -> Any:
    req = urllib.request.Request(
        url,
        data=data,
        headers={'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        method='POST' if data else 'GET',
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _http_bytes(url: str, timeout: int = 20) -> bytes | None:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status >= 400:
                return None
            return resp.read()
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def _fetch_overpass(box: dict) -> list[dict]:
    query = (
        f'[out:json][timeout:25];('
        f'way["building"]({box["south"]},{box["west"]},{box["north"]},{box["east"]});'
        f'way["highway"]({box["south"]},{box["west"]},{box["north"]},{box["east"]});'
        f'way["railway"]({box["south"]},{box["west"]},{box["north"]},{box["east"]});'
        f'way["barrier"~"^(fence|wall|gate)$"]({box["south"]},{box["west"]},{box["north"]},{box["east"]});'
        f'relation["building"]({box["south"]},{box["west"]},{box["north"]},{box["east"]});'
        f');out geom;'
    )
    try:
        payload = _http_json(OVERPASS_URL, data=f'data={urllib.parse.quote(query)}'.encode(), timeout=28)
    except Exception:
        return []
    return payload.get('elements') or []


def _way_line(element: dict) -> list[list[float]]:
    geom = element.get('geometry') or []
    return [[pt['lon'], pt['lat']] for pt in geom if 'lon' in pt and 'lat' in pt]


def _closed(line: list[list[float]]) -> bool:
    return len(line) >= 4 and line[0] == line[-1]


def _highway_width(highway: str) -> float:
    if highway in {'motorway', 'trunk', 'primary'}:
        return 12.0
    if highway in {'secondary', 'tertiary'}:
        return 9.0
    if highway in {'residential', 'unclassified', 'living_street'}:
        return 7.0
    if highway in {'service', 'industrial'}:
        return 5.5
    if highway == 'driveway':
        return 4.0
    return 6.0


def _buffer_line(line: list[list[float]], width: float) -> dict | None:
    try:
        from shapely.geometry import LineString
        poly = LineString(line).buffer(width / 2.0, cap_style=2, join_style=2)
        if poly.is_empty:
            return None
        if poly.geom_type == 'MultiPolygon':
            poly = max(poly.geoms, key=lambda g: g.area)
        coords = [list(poly.exterior.coords)]
        return {'type': 'Polygon', 'coordinates': coords}
    except Exception:
        if len(line) < 2:
            return None
        half = width / 2.0
        left, right = [], []
        for i in range(len(line) - 1):
            ax, ay = line[i]
            bx, by = line[i + 1]
            dx, dy = bx - ax, by - ay
            length = math.hypot(dx, dy) or 1.0
            nx, ny = (-dy / length) * half, (dx / length) * half
            left.append([ax + nx, ay + ny])
            right.append([ax - nx, ay - ny])
            if i == len(line) - 2:
                left.append([bx + nx, by + ny])
                right.append([bx - nx, by - ny])
        ring = left + list(reversed(right)) + [left[0]]
        return {'type': 'Polygon', 'coordinates': [ring]}


def _simplify(geometry: dict) -> dict:
    try:
        from shapely.geometry import shape
        geom = shape(geometry)
        simple = geom.simplify(SIMPLIFY_METERS, preserve_topology=True)
        if simple.is_empty:
            return geometry
        mapped = json.loads(json.dumps(simple.__geo_interface__))
        return mapped
    except Exception:
        return geometry


def _square_building(geometry: dict) -> dict:
    if geometry.get('type') != 'Polygon':
        return geometry
    ring = geometry['coordinates'][0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    box_area = max(0.01, (maxx - minx) * (maxy - miny))
    area = 0.0
    for i in range(len(ring) - 1):
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    area = abs(area) / 2.0
    if area / box_area < 0.82:
        return geometry
    squared = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
    return {'type': 'Polygon', 'coordinates': [squared]}


def _feature(kind: str, local: dict, origin: dict, source: str, confidence: float) -> dict:
    return {
        'type': kind,
        'localGeometry': local,
        'geoGeometry': _local_to_geo(local, origin),
        'source': source,
        'confidence': confidence,
    }


def _osm_features(elements: list[dict], origin: dict) -> list[dict]:
    features: list[dict] = []
    for element in elements:
        tags = element.get('tags') or {}
        line = _way_line(element)
        if len(line) < 2:
            continue
        local_line = [_lnglat_to_local(origin, lat, lng) for lng, lat in line]
        local_line_xy = [[x, y] for x, y in local_line]

        if tags.get('building'):
            ring = local_line_xy if _closed(local_line_xy) else local_line_xy + [local_line_xy[0]]
            geom = _square_building(_simplify({'type': 'Polygon', 'coordinates': [ring]}))
            features.append(_feature('BUILDING', geom, origin, 'OSM', 0.9))
            continue

        railway = tags.get('railway')
        if railway in {'rail', 'light_rail', 'tram'}:
            geom = _buffer_line(local_line_xy, 3.2)
            if geom:
                features.append(_feature('RAIL', _simplify(geom), origin, 'OSM', 0.85))
            continue

        barrier = tags.get('barrier')
        if barrier in {'fence', 'wall'}:
            geom = _buffer_line(local_line_xy, 0.4)
            if geom:
                features.append(_feature('FENCE', _simplify(geom), origin, 'OSM', 0.7))
            continue
        if barrier == 'gate':
            geom = _buffer_line(local_line_xy, 1.2)
            if geom:
                features.append(_feature('GATE', _simplify(geom), origin, 'OSM', 0.7))
            continue

        highway = tags.get('highway')
        if not highway:
            continue
        width = _highway_width(highway)
        geom = _buffer_line(local_line_xy, width)
        if not geom:
            continue
        kind = 'DRIVEWAY' if highway in {'driveway', 'service'} else 'ROAD'
        features.append(_feature(kind, _simplify(geom), origin, 'OSM', 0.8))
    return features


def _fetch_ortho(box: dict, cache_dir: str | None) -> bytes | None:
    width, height = 1024, 1024
    bbox = f'{box["west"]},{box["south"]},{box["east"]},{box["north"]}'
    queries = [
        f'{WMS_SOURCES[0]}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=0&SRS=EPSG:4326&BBOX={bbox}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg&STYLES=',
        f'{WMS_SOURCES[1]}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=0&SRS=EPSG:4326&BBOX={bbox}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg&STYLES=',
        f'{WMS_SOURCES[2]}?bbox={bbox}&bboxSR=4326&imageSR=4326&size={width},{height}&format=jpgpng&f=image',
    ]
    for url in queries:
        blob = _http_bytes(url)
        if not blob or len(blob) < 400:
            continue
        if blob[:2] != b'\xff\xd8' and blob[:8] != b'\x89PNG\r\n\x1a\n':
            continue
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
            path = os.path.join(cache_dir, 'ortho.jpg')
            with open(path, 'wb') as handle:
                handle.write(blob)
        return blob
    return None


def _detect_pavement_and_angle(blob: bytes, origin: dict, box: dict) -> tuple[list[dict], float | None]:
    try:
        import cv2
        import numpy as np
    except Exception:
        return [], None

    array = np.frombuffer(blob, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        return [], None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Pavement is usually brighter than vegetation; keep the bright class.
    if mask.mean() < 127:
        mask = cv2.bitwise_not(mask)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    h, w = mask.shape[:2]
    min_area = (h * w) * 0.01
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    features: list[dict] = []
    angles: list[float] = []

    def pixel_to_local(px: float, py: float) -> list[float]:
        lng = box['west'] + (px / max(w - 1, 1)) * (box['east'] - box['west'])
        lat = box['north'] - (py / max(h - 1, 1)) * (box['north'] - box['south'])
        x, y = _lnglat_to_local(origin, lat, lng)
        return [x, y]

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        approx = cv2.approxPolyDP(contour, 0.006 * cv2.arcLength(contour, True), True)
        ring = [pixel_to_local(pt[0][0], pt[0][1]) for pt in approx]
        if len(ring) < 3:
            continue
        ring.append(ring[0])
        geom = _simplify({'type': 'Polygon', 'coordinates': [ring]})
        features.append(_feature('PAVEMENT', geom, origin, 'ORTHO', 0.65))

        rect = cv2.minAreaRect(contour)
        # Temporary clutter: compact rectangles in the 2–16 m range.
        (cx, cy), (rw, rh), angle = rect
        rw_m = abs(rw) * origin['planeWidth'] / max(w, 1)
        rh_m = abs(rh) * origin['planeHeight'] / max(h, 1)
        long_m, short_m = max(rw_m, rh_m), min(rw_m, rh_m)
        if 2.0 <= short_m <= 4.5 and 5.0 <= long_m <= 18.0:
            angles.append(angle)

    yard_angle = None
    if angles:
        yard_angle = sorted(angles)[len(angles) // 2]
    return features, yard_angle


def _vegetation_clumps(blob: bytes, origin: dict, box: dict) -> list[dict]:
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    array = np.frombuffer(blob, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        return []
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, (35, 40, 40), (90, 255, 200))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    green = cv2.morphologyEx(green, cv2.MORPH_OPEN, kernel)
    h, w = green.shape[:2]
    contours, _ = cv2.findContours(green, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    clumps: list[dict] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 80 or area > (h * w) * 0.08:
            continue
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        lng = box['west'] + (cx / max(w - 1, 1)) * (box['east'] - box['west'])
        lat = box['north'] - (cy / max(h - 1, 1)) * (box['north'] - box['south'])
        x, y = _lnglat_to_local(origin, lat, lng)
        r = max(2.0, radius * origin['planeWidth'] / max(w, 1) * 0.35)
        ring = [
            [x + r * math.cos(t), y + r * math.sin(t)]
            for t in [i * math.pi / 4 for i in range(8)]
        ]
        ring.append(ring[0])
        clumps.append(_feature('VEGETATION', {'type': 'Polygon', 'coordinates': [ring]}, origin, 'ORTHO', 0.4))
        if len(clumps) >= 12:
            break
    return clumps


def _slot_code(index: int) -> str:
    row, col = divmod(index, 8)
    return f'{chr(65 + (row % 26))}{col + 1:02d}'


def _suggest_slots(features: list[dict], origin: dict, rotation: float) -> list[dict]:
    pavement = [f for f in features if f['type'] == 'PAVEMENT']
    buildings = [f for f in features if f['type'] == 'BUILDING']
    if not pavement:
        return []
    try:
        from shapely.geometry import Point, shape
    except Exception:
        return []

    pav_shapes = [shape(f['localGeometry']) for f in pavement]
    bld_shapes = [shape(f['localGeometry']) for f in buildings]
    cover = pav_shapes[0]
    for extra in pav_shapes[1:]:
        cover = cover.union(extra)
    minx, miny, maxx, maxy = cover.bounds
    pitch_x, pitch_y = 3.8, 13.6
    slots: list[dict] = []
    row = 0
    while miny + 4 + row * pitch_y < maxy and len(slots) < 40:
        col = 0
        while minx + 4 + col * pitch_x < maxx and len(slots) < 40:
            x = minx + 4 + col * pitch_x
            y = miny + 4 + row * pitch_y
            pt = Point(x, y)
            if cover.contains(pt) and not any(b.contains(pt) for b in bld_shapes):
                slots.append({
                    'code': _slot_code(len(slots)),
                    'type': 'CONTAINER',
                    'x': x,
                    'y': y,
                    'width': 2.44,
                    'height': 12.2,
                    'rotation': rotation,
                })
            col += 1
        row += 1
    return slots


def generate(payload: dict) -> dict:
    boundary = payload.get('boundary') or {}
    fence = _bbox_from_polygon(boundary)
    if not fence:
        return {'ok': False, 'error': 'Fence polygon is empty.'}
    buffer_m = float(payload.get('bufferMeters') or BUFFER_METERS)
    box = _buffer_bbox(fence, buffer_m)
    rotation = float(payload.get('rotationDeg') or 0)
    origin = _origin_from_box(box, rotation)
    warnings: list[str] = []

    elements = _fetch_overpass(box)
    if not elements:
        warnings.append('OpenStreetMap returned no nearby ways; using the fence as pavement.')
    features = _osm_features(elements, origin)

    cache_dir = payload.get('cacheDir')
    blob = _fetch_ortho(box, cache_dir)
    angle = None
    if blob:
        pavement, angle = _detect_pavement_and_angle(blob, origin, box)
        features.extend(pavement)
        features.extend(_vegetation_clumps(blob, origin, box))
        if angle is not None:
            origin['rotationDeg'] = angle
    else:
        warnings.append('Orthophoto WMS was unreachable; the plan is OSM-only.')

    if not any(f['type'] == 'PAVEMENT' for f in features) and boundary.get('coordinates'):
        local = _geo_to_local(boundary, origin)
        features.insert(0, _feature('PAVEMENT', _simplify(local), origin, 'OSM', 0.4))

    slots = _suggest_slots(features, origin, origin['rotationDeg'])
    return {
        'ok': True,
        'generatorVersion': GENERATOR_VERSION,
        'origin': origin,
        'features': features,
        'slots': slots,
        'warnings': warnings,
    }


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            print(json.dumps({'ok': False, 'error': f'Invalid JSON: {error}'}), flush=True)
            continue
        cmd = payload.get('cmd')
        if cmd == 'ping':
            print(json.dumps({'ok': True, 'engine': 'yard-generator', 'version': GENERATOR_VERSION}), flush=True)
            continue
        if cmd != 'generate':
            print(json.dumps({'ok': False, 'id': payload.get('id'), 'error': f'Unknown cmd {cmd}'}), flush=True)
            continue
        try:
            result = generate(payload)
            result['id'] = payload.get('id')
            print(json.dumps(result), flush=True)
        except Exception as error:
            print(json.dumps({
                'ok': False,
                'id': payload.get('id'),
                'error': str(error),
                'trace': traceback.format_exc()[-800:],
            }), flush=True)


if __name__ == '__main__':
    main()
