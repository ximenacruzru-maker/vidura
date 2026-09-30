-- The month drill-down on the dashboard lists every sold policy: keep the customer's name and the policy number with
-- each policy. The fill runs again once (from the first page) to add them to the policies already kept.
alter table public.az_policies add column if not exists customer_name text;
alter table public.az_policies add column if not exists policy_number text;
update public.az_sync_state set policies_page = 0, policies_done = false;
select cron.unschedule(jobid) from cron.job where jobname = 'agencyzoom-policies';
select cron.schedule('agencyzoom-policies', '4-58/3 * * * *', $$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/agencyzoom-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agencyzoom_cron_secret')),
    body := '{"policies": true}'::jsonb, timeout_milliseconds := 150000)
  where not coalesce((select bool_and(policies_done) from public.az_sync_state), false);
  select cron.unschedule('agencyzoom-policies') where coalesce((select bool_and(policies_done) from public.az_sync_state), false);
$$);
