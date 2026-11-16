-- Producer names as AgencyZoom sends them sometimes carry a double space ("Cindy  Ruiz"), so they don't match the
-- person's login: their sales, quotes and commission went missing from My Pay, Team today and the recap. Names are
-- tidied (trimmed, runs of spaces made one) whenever these tables are written, and the rows already there are fixed.
create or replace function public.tidy_producer()
returns trigger
language plpgsql
as $$
begin
  if new.producer is not null then new.producer := regexp_replace(trim(new.producer), '\s+', ' ', 'g'); end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['daily_sales', 'quote_leads', 'az_pipeline', 'az_lead_history'] loop
    execute format('drop trigger if exists tidy_producer on public.%I', t);
    execute format('create trigger tidy_producer before insert or update of producer on public.%I for each row execute function public.tidy_producer()', t);
    execute format('update public.%I set producer = regexp_replace(trim(producer), ''\s+'', '' '', ''g'') where producer ~ ''\s{2,}'' or producer <> trim(producer)', t);
  end loop;
end;
$$;
