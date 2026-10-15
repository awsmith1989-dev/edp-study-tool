-- In-app beta feedback survey, shown after the 25th (and, if dismissed,
-- 50th) answered question, then never again.

alter table public.profiles
  add column if not exists survey_offers_shown integer not null default 0;

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  usefulness smallint not null check (usefulness between 1 and 5),
  feedback text,
  would_pay text not null check (would_pay in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default now()
);

alter table public.survey_responses enable row level security;

-- Same pattern as question_flags: insert-own only, no select policy for
-- anon/authenticated. Admin reads go through the service-role key.
create policy "Users can insert their own survey response"
  on public.survey_responses for insert
  with check (auth.uid() = user_id);
