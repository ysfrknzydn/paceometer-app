"""Pure filtering/shaping logic for the fueleconomy.gov bulk CSV -- no I/O,
so this is what's actually unit tested (see
python/tests/test_fuel_pipeline_clean.py). fetch.py and publish.py do real
I/O and are deliberately not unit tested, same distinction docs/CLAUDE.md
draws between js/math/ (pure, tested) and the rest of the app.
"""

# EVs/plug-in-electric vehicles report MPGe under fuelType1 == "Electricity",
# not real gallons -- running gallonsPerMile (js/math/fuelMath.js,
# python/paceometer_math/fuel_math.py) on one of these would silently
# produce a nonsense gas-cost number. Hybrids that still burn gasoline/
# diesel (fuelType1 is a liquid-fuel grade) are unaffected and stay in.
EXCLUDED_FUEL_TYPES = {"Electricity"}


def is_relevant_row(row):
    return row.get("fuelType1") not in EXCLUDED_FUEL_TYPES


def _to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_row(row):
    """Shapes one fueleconomy.gov CSV row into vehicle_fuel_economy's
    column names. Returns None if a value this feature actually needs
    (id/year/make/model/fuel type/city+highway+combined MPG) is missing or
    unparseable, so publish.py never upserts a row the app couldn't use
    anyway.
    """
    row_id = _to_int(row.get("id"))
    year = _to_int(row.get("year"))
    make = row.get("make") or None
    model = row.get("model") or None
    fuel_type1 = row.get("fuelType1") or None
    city_mpg = _to_float(row.get("city08"))
    highway_mpg = _to_float(row.get("highway08"))
    comb_mpg = _to_float(row.get("comb08"))

    if not (row_id and year and make and model and fuel_type1 and city_mpg and highway_mpg and comb_mpg):
        return None

    return {
        "id": row_id,
        "year": year,
        "make": make,
        "model": model,
        "trany": row.get("trany") or None,
        "drive": row.get("drive") or None,
        "cylinders": _to_float(row.get("cylinders")),
        "displ": _to_float(row.get("displ")),
        "vclass": row.get("VClass") or None,
        "fuel_type1": fuel_type1,
        "city_mpg": city_mpg,
        "highway_mpg": highway_mpg,
        "comb_mpg": comb_mpg,
    }


def clean_rows(rows):
    """Filters EV rows then shapes the rest, dropping any row clean_row
    can't make usable. `rows` is any iterable of dicts (e.g.
    csv.DictReader output).
    """
    cleaned = []
    for row in rows:
        if not is_relevant_row(row):
            continue
        cleaned_row = clean_row(row)
        if cleaned_row is not None:
            cleaned.append(cleaned_row)
    return cleaned
