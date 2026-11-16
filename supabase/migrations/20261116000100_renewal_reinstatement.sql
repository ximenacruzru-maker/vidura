-- Reinstatements on the daily review list: cancelled policies a retention person works to win back (a weekend
-- reinstatement call pack, say). They aren't renewals, but they are the day's work: each one gets findings, the call
-- results and notes, and a day with reinstatements assigned is measured against everything on its list.
alter table public.renewal_reviews drop constraint if exists renewal_reviews_kind_check;
alter table public.renewal_reviews add constraint renewal_reviews_kind_check check (kind in ('negative', 'positive', 'commercial', 'reinstatement'));
