"""Weekly fuel-economy data pipeline: fetch fueleconomy.gov's bulk CSV,
clean/filter it, and publish it to the vehicle_fuel_economy Supabase table.
Dev/CI-only -- never runs inside the shipped app, same reasoning as
paceometer_math (see docs/CLAUDE.md). Run via `python -m fuel_pipeline`
from this directory (see __main__.py), normally triggered by
.github/workflows/weekly-fuel-data-refresh.yml.
"""
