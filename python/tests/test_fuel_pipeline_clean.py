from fuel_pipeline.clean import clean_row, clean_rows, is_relevant_row

GASOLINE_ROW = {
    "id": "1",
    "year": "2018",
    "make": "Honda",
    "model": "Civic",
    "trany": "Automatic 6-spd",
    "drive": "Front-Wheel Drive",
    "cylinders": "4",
    "displ": "1.5",
    "VClass": "Compact Cars",
    "fuelType1": "Regular Gasoline",
    "city08": "31",
    "highway08": "40",
    "comb08": "35",
}

ELECTRIC_ROW = {
    **GASOLINE_ROW,
    "id": "2",
    "make": "Tesla",
    "model": "Model 3",
    "fuelType1": "Electricity",
    "city08": "138",  # MPGe, not real gallons
    "highway08": "126",
    "comb08": "132",
}

MISSING_MPG_ROW = {**GASOLINE_ROW, "id": "3", "city08": "", "highway08": ""}


def test_is_relevant_row_excludes_electricity():
    assert is_relevant_row(GASOLINE_ROW) is True
    assert is_relevant_row(ELECTRIC_ROW) is False


def test_clean_row_shapes_gasoline_row():
    cleaned = clean_row(GASOLINE_ROW)
    assert cleaned == {
        "id": 1,
        "year": 2018,
        "make": "Honda",
        "model": "Civic",
        "trany": "Automatic 6-spd",
        "drive": "Front-Wheel Drive",
        "cylinders": 4.0,
        "displ": 1.5,
        "vclass": "Compact Cars",
        "fuel_type1": "Regular Gasoline",
        "city_mpg": 31.0,
        "highway_mpg": 40.0,
        "comb_mpg": 35.0,
    }


def test_clean_row_drops_rows_missing_mpg_data():
    assert clean_row(MISSING_MPG_ROW) is None


def test_clean_rows_excludes_electricity_and_unusable_rows():
    cleaned = clean_rows([GASOLINE_ROW, ELECTRIC_ROW, MISSING_MPG_ROW])
    assert len(cleaned) == 1
    assert cleaned[0]["make"] == "Honda"


def test_clean_rows_keeps_gasoline_hybrids():
    hybrid_row = {**GASOLINE_ROW, "id": "4", "model": "Insight", "fuelType1": "Regular Gasoline"}
    cleaned = clean_rows([hybrid_row])
    assert len(cleaned) == 1
    assert cleaned[0]["model"] == "Insight"
