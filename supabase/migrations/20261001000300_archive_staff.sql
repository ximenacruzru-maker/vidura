-- People who leave: their license is archived (kept, out of the active list and renewal reminders) and their
-- employment record keeps the last day and why. Nothing is deleted.
alter table public.licenses add column if not exists archived_on date;
alter table public.licenses add column if not exists archived_reason text;
alter table public.hr_staff add column if not exists hired_on date;
alter table public.hr_staff add column if not exists left_on date;
alter table public.hr_staff add column if not exists leave_reason text;
