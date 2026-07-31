"""Pure pace/zone-time math -- a Python mirror of js/math/paceMath.js.

Dev-only reference/test oracle: this package never runs inside the shipped
app (no Pyodide, no runtime role). It exists so the JS formulas have an
independently-written second implementation to check against via
tests/golden_vectors/ -- see docs/CLAUDE.md and README.md for the app's
actual (JS-only) runtime architecture.
"""
import math

MPS_TO_MPH = 2.23694

# Reference distance for the pace readout, per Peer & Gamliel (2013).
PACE_REFERENCE_MILES = 10
PACE_MIN_SPEED_MPH = 5

# Core Function: at the current speed, would going ZONE_SPEED_INCREMENT_MPH
# faster still buy meaningful time over PACE_REFERENCE_MILES?
ZONE_SPEED_INCREMENT_MPH = 10

ZONE_THRESHOLD_PRESETS = {
    "standard": {"label": "Standard", "thresholdSeconds": 90},
    "strict": {"label": "Strict", "thresholdSeconds": 150},
    "strictest": {"label": "Strictest", "thresholdSeconds": 240},
}


def pace_seconds_for(mph):
    """t = d/v, the exact formula validated in Peer & Gamliel (2013), Formula 1."""
    return (PACE_REFERENCE_MILES / mph) * 3600 if mph >= PACE_MIN_SPEED_MPH else None


def marginal_seconds_saved(mph):
    now = pace_seconds_for(mph)
    if now is None:
        return None
    faster = pace_seconds_for(mph + ZONE_SPEED_INCREMENT_MPH)
    return now - faster


def zone_ceiling_mph(threshold_seconds):
    """The speed at which marginal_seconds_saved(v) == threshold_seconds."""
    k = PACE_REFERENCE_MILES * 3600 * ZONE_SPEED_INCREMENT_MPH
    return (
        -ZONE_SPEED_INCREMENT_MPH
        + math.sqrt(ZONE_SPEED_INCREMENT_MPH**2 + (4 * k) / threshold_seconds)
    ) / 2


def _js_round(x):
    # JS Math.round rounds half-values toward +Infinity for both positive and
    # negative numbers; Python's round() uses banker's rounding instead, so
    # it can silently disagree with JS on exact .5 boundaries. This matches
    # JS bit-for-bit.
    return math.floor(x + 0.5)


def format_duration(total_seconds):
    abs_seconds = max(0, _js_round(total_seconds))
    if abs_seconds < 60:
        return f"{abs_seconds}s"
    minutes = abs_seconds // 60
    seconds = abs_seconds % 60
    return f"{minutes}:{seconds:02d}"
