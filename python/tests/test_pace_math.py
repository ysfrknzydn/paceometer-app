import math

from paceometer_math.pace_math import (
    format_duration,
    marginal_seconds_saved,
    pace_seconds_for,
    zone_ceiling_mph,
)


def _approx(a, b, tol=1e-9):
    if a is None or b is None:
        return a == b
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def test_pace_seconds_for(vectors):
    for case in vectors["paceSecondsFor"]:
        assert _approx(pace_seconds_for(case["input"]["mph"]), case["output"])


def test_marginal_seconds_saved(vectors):
    for case in vectors["marginalSecondsSaved"]:
        assert _approx(marginal_seconds_saved(case["input"]["mph"]), case["output"])


def test_zone_ceiling_mph(vectors):
    for case in vectors["zoneCeilingMph"]:
        assert _approx(zone_ceiling_mph(case["input"]["thresholdSeconds"]), case["output"])


def test_format_duration(vectors):
    for case in vectors["formatDuration"]:
        assert format_duration(case["input"]["totalSeconds"]) == case["output"]
