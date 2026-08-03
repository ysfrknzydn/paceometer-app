import json
from pathlib import Path

import pytest

GOLDEN_VECTORS_DIR = Path(__file__).resolve().parents[2] / "tests" / "golden_vectors"


@pytest.fixture(scope="session")
def vectors():
    with (GOLDEN_VECTORS_DIR / "pace_zone.json").open() as f:
        return json.load(f)


@pytest.fixture(scope="session")
def fuel_vectors():
    with (GOLDEN_VECTORS_DIR / "fuel_math.json").open() as f:
        return json.load(f)
