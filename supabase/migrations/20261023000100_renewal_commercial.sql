-- Commercial renewals assigned to the reviewer by name: a third kind next to negative and positive, with the task
-- they were given for each account (what to do, the next step). The task is guidance, not her notes, so it doesn't
-- make a renewal count as worked.
alter table public.renewal_reviews drop constraint if exists renewal_reviews_kind_check;
alter table public.renewal_reviews add constraint renewal_reviews_kind_check check (kind in ('negative', 'positive', 'commercial'));
alter table public.renewal_reviews add column if not exists task text;
