"""Pure geo/distance math -- a Python mirror of js/math/geoMath.js.
Dev-only reference/test oracle; see pace_math.py's module docstring.
"""
import math

MAX_FIX_ACCURACY_METERS = 100
MAX_PLAUSIBLE_MPH = 200


def haversine_meters(a, b):
    R = 6371000
    to_rad = lambda deg: (deg * math.pi) / 180  # noqa: E731

    d_lat = to_rad(b["latitude"] - a["latitude"])
    d_lon = to_rad(b["longitude"] - a["longitude"])
    lat1 = to_rad(a["latitude"])
    lat2 = to_rad(b["latitude"])

    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2

    return 2 * R * math.asin(math.sqrt(h))
