-- Which certification a user is working toward. Required at signup going
-- forward; existing users get a one-time login prompt (cert_pathway_asked
-- tracks whether that prompt has already been shown, so we never nag
-- someone who skipped it).

alter table public.profiles
  add column if not exists cert_pathway text,
  add column if not exists cert_pathway_asked boolean not null default false;
