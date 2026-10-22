-- The daily renewal review (Retention): each workday the person in the role works 10 renewals — 5 negative (the
-- premium goes up) and 5 positive (with a cross-sell to offer) — calls each client up to twice, emails a renewal
-- snapshot when they can't be reached, and notes what happened. Their own rows, or an admin's (like retention_log).
create table if not exists public.renewal_reviews (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  name text not null,
  day date not null,
  kind text not null check (kind in ('negative', 'positive')),
  account_id text,
  policy_id text,
  client text not null check (length(trim(client)) > 0),
  policy text,
  renewal_date date,
  current_premium numeric(12,2),
  renewal_premium numeric(12,2),
  call1 text check (call1 in ('no_answer', 'voicemail', 'reached')),
  call2 text check (call2 in ('no_answer', 'voicemail', 'reached')),
  emailed boolean not null default false,
  cross_sell text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists renewal_reviews_day on public.renewal_reviews (agency_id, name, day);
alter table public.renewal_reviews enable row level security;
revoke truncate on public.renewal_reviews from anon, authenticated;
create policy "own or admin" on public.renewal_reviews for all to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
grant select, insert, update, delete on public.renewal_reviews to authenticated;
