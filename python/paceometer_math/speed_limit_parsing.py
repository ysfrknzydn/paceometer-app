"""Pure OSM maxspeed-tag parsing -- a Python mirror of
js/math/speedLimitParsing.js. Dev-only reference/test oracle; see
pace_math.py's module docstring.
"""
import re

from .geo_math import haversine_meters

_KMH_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*km/?h$")
_MPH_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*mph$")
_BARE_RE = re.compile(r"^(\d+(?:\.\d+)?)$")


def parse_maxspeed_tag(raw):
    if not isinstance(raw, str):
        return None
    trimmed = raw.strip().lower()

    kmh_match = _KMH_RE.match(trimmed)
    if kmh_match:
        return float(kmh_match.group(1)) * 0.621371

    mph_match = _MPH_RE.match(trimmed)
    if mph_match:
        return float(mph_match.group(1))

    bare_match = _BARE_RE.match(trimmed)
    if bare_match:
        return float(bare_match.group(1))

    return None


def extract_maxspeed_mph(data):
    elements = (data or {}).get("elements") or []
    for element in elements:
        tags = element.get("tags") or {}
        mph = parse_maxspeed_tag(tags.get("maxspeed"))
        if mph is not None:
            return mph
    return None


def cached_speed_limit_near(cache, coords, timestamp, max_age_ms, radius_meters):
    for entry in reversed(cache):
        if timestamp - entry["timestamp"] > max_age_ms:
            continue
        if haversine_meters(entry["coords"], coords) <= radius_meters:
            return entry["mph"]
    return None
