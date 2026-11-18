-- Paywall removed: every signed-up user is auto-granted a long-lived
-- 'free' license (see auth.js getLicense()), replacing the time-limited
-- 'beta' auto-grant. Add 'free' to the allowed license_type values.

alter table public.licenses
  drop constraint if exists licenses_license_type_check;

alter table public.licenses
  add constraint licenses_license_type_check
  check (license_type in ('paid', 'code', 'beta', 'free'));
