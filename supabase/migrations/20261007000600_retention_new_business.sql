-- Retention log: a "new business" entry for a new customer (e.g. a lender referral), kept apart from cross-sells
-- (a new policy for an existing client). Both count toward Net Book Movement.
alter table public.retention_log drop constraint if exists retention_log_kind_check;
alter table public.retention_log add constraint retention_log_kind_check check (kind in ('save', 'loss', 'cross_sell', 'new_business', 'review'));
