-- Per-question "flag this question" feedback.

create table if not exists public.question_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  reason text not null,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists question_flags_question_id_idx
  on public.question_flags (question_id);

alter table public.question_flags enable row level security;

-- Users may insert their own flags. There is deliberately no select
-- policy for anon/authenticated roles — only the service-role key
-- (used by admin-data.js) can read flags, since the service role
-- bypasses RLS entirely.
create policy "Users can insert their own question flags"
  on public.question_flags for insert
  with check (auth.uid() = user_id);
