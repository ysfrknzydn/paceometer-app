"""Pure zone-state-machine logic -- a Python mirror of js/math/zoneState.js.
Dev-only reference/test oracle; see pace_math.py's module docstring.
"""

ZONE_HYSTERESIS_SECONDS = 5
SPEED_LIMIT_HYSTERESIS_MPH = 2

ZONE_STATE_LABELS = {
    "green": "TIME ADDS UP HERE",
    "yellow": "GAINS ARE SHRINKING",
    "red": "NO TIME LEFT TO GAIN",
    "limit": "AT THE SPEED LIMIT",
}


def next_zone_state(
    rounded,
    previous,
    mph,
    known_speed_limit_mph,
    threshold_seconds,
    nearing_threshold_seconds,
    hysteresis_seconds=ZONE_HYSTERESIS_SECONDS,
    speed_limit_hysteresis_mph=SPEED_LIMIT_HYSTERESIS_MPH,
):
    if previous == "limit" and known_speed_limit_mph is None:
        previous = None

    if known_speed_limit_mph is not None:
        if previous == "limit":
            if mph >= known_speed_limit_mph - speed_limit_hysteresis_mph:
                return "limit"
            previous = None
        elif previous is None:
            if mph >= known_speed_limit_mph:
                return "limit"
        elif mph >= known_speed_limit_mph + speed_limit_hysteresis_mph:
            return "limit"

    if previous is None:
        if rounded < threshold_seconds:
            return "red"
        if rounded < nearing_threshold_seconds:
            return "yellow"
        return "green"

    state = previous
    if state == "green" and rounded < nearing_threshold_seconds - hysteresis_seconds:
        state = "yellow"
    if state == "yellow" and rounded < threshold_seconds - hysteresis_seconds:
        state = "red"
    if state == "red" and rounded > threshold_seconds + hysteresis_seconds:
        state = "yellow"
    if state == "yellow" and rounded > nearing_threshold_seconds + hysteresis_seconds:
        state = "green"
    return state
