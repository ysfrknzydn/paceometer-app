-- Security audit follow-up (2026-08-08): the previous migration
-- (20260808045856) bounded every numeric column on trips/feedback but left
-- the text columns unbounded -- a signed-in user could still insert an
-- arbitrarily long vehicle_label/user_agent into their own row, or a
-- zone_state value outside the app's own vocabulary. Same rationale as
-- before: RLS already blocks touching anyone else's data, so this is a
-- cheap, standard sanity bound on top of that, not a response to a proven
-- exploit path.
--
-- NOT VALID for the same reason as the prior migration -- these run against
-- live tables with real rows, and the goal is enforcing bounds on future
-- writes, not gating the migration on a scan of historical data.
--
-- zone_state's allowed values mirror js/app.js's own
-- "green" | "yellow" | "red" | "limit" | null vocabulary exactly (see
-- AudioFeedback's ZONE_CHIME_FREQUENCIES for the canonical list) -- a NULL
-- always satisfies a CHECK constraint in Postgres, so the pre-first-fix
-- null case doesn't need an explicit allowance.
alter table public.trips
  add constraint trips_vehicle_label_length check (char_length(vehicle_label) < 200) not valid;

alter table public.feedback
  add constraint feedback_zone_state_values check (zone_state in ('green', 'yellow', 'red', 'limit')) not valid,
  add constraint feedback_user_agent_length check (char_length(user_agent) < 1024) not valid;
