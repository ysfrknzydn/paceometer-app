"""Pure fuel-consumption math -- a Python mirror of js/math/fuelMath.js.

Dev-only reference/test oracle: this module never runs inside the shipped
app -- see docs/CLAUDE.md and README.md for the app's actual (JS-only)
runtime architecture. See js/math/fuelMath.js for the full model rationale,
including why gallons/mile grows quadratically above the highway anchor
(found and fixed 2026-08-03: a straight line through just the two EPA
anchors keeps improving past the highway anchor, which is backwards) and
which parts of that model are literature-grounded vs. a provisional
rule-of-thumb calibration pending a tighter primary-sourced fit.
"""

FUEL_CITY_TEST_AVG_MPH = 21.2
FUEL_HIGHWAY_TEST_AVG_MPH = 48.3

KMH_TO_MPH = 0.621371
RULE_OF_THUMB_SLOWER_KMH = 100
RULE_OF_THUMB_FASTER_KMH = 110
RULE_OF_THUMB_FUEL_INCREASE_FRACTION = 0.1


def _solve_above_highway_coefficient():
    slower_mph = RULE_OF_THUMB_SLOWER_KMH * KMH_TO_MPH
    faster_mph = RULE_OF_THUMB_FASTER_KMH * KMH_TO_MPH
    a = (faster_mph - FUEL_HIGHWAY_TEST_AVG_MPH) ** 2
    b = (slower_mph - FUEL_HIGHWAY_TEST_AVG_MPH) ** 2
    target_ratio = 1 + RULE_OF_THUMB_FUEL_INCREASE_FRACTION
    return (target_ratio - 1) / (a - target_ratio * b)


ABOVE_HIGHWAY_DRAG_COEFFICIENT = _solve_above_highway_coefficient()


def gallons_per_mile(mph, city_mpg, highway_mpg):
    """Gallons burned per mile at a given speed, from EPA city/highway MPG."""
    city_rate = 1 / city_mpg
    if mph <= FUEL_CITY_TEST_AVG_MPH:
        return city_rate

    highway_rate = 1 / highway_mpg
    if mph <= FUEL_HIGHWAY_TEST_AVG_MPH:
        slope = (highway_rate - city_rate) / (FUEL_HIGHWAY_TEST_AVG_MPH - FUEL_CITY_TEST_AVG_MPH)
        return city_rate + slope * (mph - FUEL_CITY_TEST_AVG_MPH)

    over_highway = mph - FUEL_HIGHWAY_TEST_AVG_MPH
    return highway_rate * (1 + ABOVE_HIGHWAY_DRAG_COEFFICIENT * over_highway**2)
