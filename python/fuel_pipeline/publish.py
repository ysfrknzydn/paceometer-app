"""Upserts cleaned vehicle_fuel_economy rows into Supabase. Real network I/O
against a live project, so this isn't unit tested -- see clean.py for the
pure logic that is.

Requires a service-role key (bypasses RLS) -- never the anon key. See the
migration's own comment in
supabase/migrations/20260803183109_add_vehicle_fuel_economy_table.sql for
why this table has no insert/update policy for the `authenticated` role at
all: only this script, via the service-role key, ever writes to it.
"""
import os

from supabase import create_client

TABLE_NAME = "vehicle_fuel_economy"
UPSERT_BATCH_SIZE = 500


def publish_rows(rows, supabase_url=None, supabase_key=None):
    """Upserts `rows` (as produced by clean.clean_rows) into Supabase, keyed
    on `id` so re-running the pipeline overwrites existing rows rather than
    duplicating them.
    """
    url = supabase_url or os.environ["SUPABASE_URL"]
    key = supabase_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client = create_client(url, key)

    for start in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[start : start + UPSERT_BATCH_SIZE]
        client.table(TABLE_NAME).upsert(batch, on_conflict="id").execute()
