-- Voice feedback / bug report (2026-08-07, Tier 3.6): a driver can tap a mic
-- button to leave feedback or report a bug hands-free/glance-free, modeled
-- on Tesla's in-car voice feedback. Only the *transcript* is ever stored --
-- audio is recorded client-side, sent to a Supabase Edge Function
-- (transcribe-feedback) that forwards it to Groq's Whisper API and returns
-- text, and the audio itself is never written anywhere, not even
-- transiently on disk -- see docs/CLAUDE.md for the full privacy writeup.
--
-- Metadata columns are a snapshot of app state at the moment of recording,
-- analogous to what Tesla's own feature captures, but deliberately NOT
-- including raw lat/lng -- consistent with this project's standing privacy
-- invariant (see the `trips` table and docs/CLAUDE.md).
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  note text not null,
  zone_state text,
  is_recording_trip boolean,
  user_agent text
);

alter table public.feedback enable row level security;

-- "Automatically expose new tables" is off at the project level (see the
-- Supabase access model note in docs/CLAUDE.md) -- explicit grants needed
-- regardless of RLS, same trap this project has hit before.
grant select, insert on public.feedback to authenticated;

-- Each user can insert only their own feedback.
create policy "feedback: users insert own"
  on public.feedback
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Each user can read only their own feedback (not other users'). No
-- user-facing UI reads this back today -- granted for consistency with
-- every other per-user table in this schema, not because something uses it
-- yet.
create policy "feedback: users select own"
  on public.feedback
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No update/delete policy -- feedback is a one-way "send it and it's sent"
-- action, same as Tesla's own feature; only the developer can remove a row,
-- via the dashboard or a service-role query.
