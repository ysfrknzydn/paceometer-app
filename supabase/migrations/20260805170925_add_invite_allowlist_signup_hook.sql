-- Invite-only signup, replacing the blunt "signup disabled entirely" state
-- set 2026-08-04 (see docs/TODO.md Tier 0). The developer inserts an email
-- into invite_allowlist (SQL Editor or Table Editor -- no client-facing UI,
-- since only the developer ever adds one), then the person can sign up
-- themselves through the normal auth form using that exact email.
--
-- No RLS here -- deliberately following the same pattern as Supabase's own
-- "Allow/Deny by IP or CIDR" before-user-created-hook example (grant/revoke
-- table privileges directly, no `enable row level security`). RLS with zero
-- policies would silently return an empty result set even to a role holding
-- table grants (only the table owner bypasses RLS by default), which would
-- make every signup fail closed, including allowlisted ones -- not what we
-- want. Table-level grants alone are sufficient: supabase_auth_admin is the
-- only role granted anything, so the table is invisible via the client SDK
-- (anon/authenticated) exactly like a proper access boundary requires.
create table if not exists public.invite_allowlist (
  email text primary key constraint invite_allowlist_email_lowercase check (email = lower(email)),
  note text default null,
  created_at timestamptz not null default now()
);

grant all
  on table public.invite_allowlist
  to supabase_auth_admin;

revoke all
  on table public.invite_allowlist
  from authenticated, anon, public;

-- Called by the "before-user-created" Auth Hook (registered separately in
-- the dashboard, Authentication -> Hooks -- not something a migration can
-- do). Allows a signup only if the email is present in invite_allowlist;
-- rejects everything else with a 403. This is the actual gate now, not the
-- project-wide "Allow new users to sign up" toggle -- that toggle needs to
-- be back ON for this hook to ever run (it blocks all signups earlier in
-- the pipeline when off), see docs/TODO.md for the re-enable step.
create or replace function public.hook_restrict_signup_to_invite_allowlist(event jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  signup_email text;
  match_count int;
begin
  signup_email := lower(event->'user'->>'email');

  select count(*) into match_count
  from public.invite_allowlist
  where email = signup_email;

  if match_count > 0 then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This app is invite-only right now. Ask the developer to add your email before signing up.',
      'http_code', 403
    )
  );
end;
$$;

grant execute
  on function public.hook_restrict_signup_to_invite_allowlist(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.hook_restrict_signup_to_invite_allowlist(jsonb)
  from authenticated, anon, public;
