-- A transfer with no quote yet is re-checked on a rotation by agencyzoom-sync (oldest check first), so a quote added
-- after the lead's first few days still counts it as qualified. Before this, a transfer was only re-read while the
-- lead was created or active in the sync's 3-day window, and quotes entered without other activity were missed.
alter table public.sdr_transfers add column if not exists quote_checked_at timestamptz;
create index if not exists sdr_transfers_recheck on public.sdr_transfers (agency_id, az_qualifies, quote_checked_at);
