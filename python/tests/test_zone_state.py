from paceometer_math.zone_state import next_zone_state


def test_next_zone_state(vectors):
    for case in vectors["nextZoneState"]:
        i = case["input"]
        actual = next_zone_state(
            i["rounded"],
            i["previous"],
            i["mph"],
            i["knownSpeedLimitMph"],
            i["thresholdSeconds"],
            i["nearingThresholdSeconds"],
        )
        assert actual == case["output"], i
