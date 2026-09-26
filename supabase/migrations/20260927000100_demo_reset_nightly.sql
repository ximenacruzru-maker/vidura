-- Keep the demo agency looking live: regenerate Northwind every night (10:40 UTC = 3:40 AM Pacific in summer,
-- 2:40 AM in winter), so its sales, quotes and dates always run up to the current day. Anything a prospect
-- changed during a demo is wiped with it. Logins are left alone.
select cron.unschedule(jobid) from cron.job where jobname = 'demo-reset-nightly';
select cron.schedule('demo-reset-nightly', '40 10 * * *', $$select public.demo_reset('northwind')$$);
