"""Downloads fueleconomy.gov's bulk vehicles CSV. Real network I/O, so this
isn't unit tested -- see clean.py for the pure logic that is.
"""
import csv
import io
import urllib.request

# Verified directly against fueleconomy.gov's web-services docs page
# (2026-08-03) -- the full bulk-download dataset, distinct from the
# per-vehicle web-service API at /feg/ws/.
VEHICLES_CSV_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv"


def fetch_vehicle_rows(url=VEHICLES_CSV_URL):
    """Downloads the CSV and returns it as a list of dict rows."""
    with urllib.request.urlopen(url) as response:
        text = response.read().decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))
