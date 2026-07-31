import math

from paceometer_math.speed_limit_parsing import (
    cached_speed_limit_near,
    extract_maxspeed_mph,
    parse_maxspeed_tag,
)


def test_parse_maxspeed_tag(vectors):
    for case in vectors["parseMaxspeedTag"]:
        actual = parse_maxspeed_tag(case["input"]["raw"])
        expected = case["output"]
        if expected is None:
            assert actual is None, case
        else:
            assert math.isclose(actual, expected, rel_tol=1e-9), case


def test_extract_maxspeed_mph(vectors):
    for case in vectors["extractMaxspeedMph"]:
        assert extract_maxspeed_mph(case["input"]["data"]) == case["output"]


def test_cached_speed_limit_near(vectors):
    for case in vectors["cachedSpeedLimitNear"]:
        i = case["input"]
        actual = cached_speed_limit_near(i["cache"], i["coords"], i["timestamp"], i["maxAgeMs"], i["radiusMeters"])
        assert actual == case["output"], i
