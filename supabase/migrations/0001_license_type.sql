-- Distinguishes beta-granted licenses from paid (Stripe) and cohort-code
-- licenses so beta access never gets confused with paid access in
-- reporting or revocation logic.

alter table public.licenses
  add column if not exists license_type text not null default 'paid';

-- Backfill: existing cohort-code redemptions are 'code', everything else
-- (Stripe checkout) stays the default 'paid'.
update public.licenses
  set license_type = 'code'
  where auth_code is not null;

alter table public.licenses
  add constraint licenses_license_type_check
  check (license_type in ('paid', 'code', 'beta'));
