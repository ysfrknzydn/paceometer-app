import json
from pathlib import Path

import pytest

GOLDEN_VECTORS_PATH = Path(__file__).resolve().parents[2] / "tests" / "golden_vectors" / "pace_zone.json"


@pytest.fixture(scope="session")
def vectors():
    with GOLDEN_VECTORS_PATH.open() as f:
        return json.load(f)
