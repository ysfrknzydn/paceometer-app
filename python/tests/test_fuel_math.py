import math

from paceometer_math.fuel_math import gallons_per_mile


def _approx(a, b, tol=1e-9):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def test_gallons_per_mile(fuel_vectors):
    for case in fuel_vectors["gallonsPerMile"]:
        i = case["input"]
        assert _approx(gallons_per_mile(i["mph"], i["cityMpg"], i["highwayMpg"]), case["output"])
