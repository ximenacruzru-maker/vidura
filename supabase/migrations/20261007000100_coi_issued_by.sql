-- Certificates of insurance made in the COI generator are filed on the client's account; issued_by records who made
-- each one (its created_at is the exact time it was issued).
alter table public.documents add column if not exists issued_by text;
