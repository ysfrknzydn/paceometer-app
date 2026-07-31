import math

from paceometer_math.geo_math import haversine_meters


def test_haversine_meters(vectors):
    for case in vectors["haversineMeters"]:
        actual = haversine_meters(case["input"]["a"], case["input"]["b"])
        assert math.isclose(actual, case["output"], rel_tol=1e-9, abs_tol=1e-6)
