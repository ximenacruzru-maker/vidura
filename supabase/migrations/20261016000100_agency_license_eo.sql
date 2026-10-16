-- Licensing: the agency's own license and its E&O policy sit beside the staff licenses. kind tells them apart
-- ('person' = a staff license, 'agency' = the business-entity license, 'eo' = errors & omissions coverage), so the
-- page can show them in their own section and keep them out of the licensed-staff count, while their renewal dates
-- still count toward "renewing within 90 days".
alter table public.licenses add column if not exists kind text not null default 'person';
alter table public.licenses drop constraint if exists licenses_kind_check,
  add constraint licenses_kind_check check (kind in ('person', 'agency', 'eo'));
