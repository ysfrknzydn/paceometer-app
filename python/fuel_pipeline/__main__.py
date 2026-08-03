"""Entry point for the weekly fuel-data refresh
(.github/workflows/weekly-fuel-data-refresh.yml): fetch -> clean -> publish.
Run with `python -m fuel_pipeline` from the python/ directory.
"""
from .clean import clean_rows
from .fetch import fetch_vehicle_rows
from .publish import publish_rows


def main():
    print("Fetching vehicles.csv...")
    rows = fetch_vehicle_rows()
    print(f"Fetched {len(rows)} rows.")

    cleaned = clean_rows(rows)
    print(f"Cleaned to {len(cleaned)} gasoline/diesel rows with usable MPG data.")

    publish_rows(cleaned)
    print(f"Published {len(cleaned)} rows to Supabase.")


if __name__ == "__main__":
    main()
