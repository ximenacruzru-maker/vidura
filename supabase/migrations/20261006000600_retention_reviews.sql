-- Renewal reviews in the retention log: a documented conversation with no premium change (e.g. a happy renewal
-- planning to add a car). They show in the log and the reports but don't move Net Book Movement.
alter table public.retention_log drop constraint if exists retention_log_kind_check;
alter table public.retention_log add constraint retention_log_kind_check check (kind in ('save', 'loss', 'cross_sell', 'review'));
