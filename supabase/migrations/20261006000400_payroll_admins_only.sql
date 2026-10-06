-- Office payroll is for the owner and admins only (it shows everyone's pay). VAs no longer get it by default, and it
-- can't be switched on for anyone else. Everyone still sees their own pay on My Pay (the "own read" policies).
create or replace function public.staff_can(section text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select case
    when s.role in ('owner','admin') then true
    when section in ('performance', 'payroll') then false
    when s.access ? section then coalesce((s.access->>section)::boolean, false)
    else section = any (case s.role
      when 'protege' then array['books','resources','work','chat','training','proteges','passwords']
      else array['books','resources','work','chat','training','passwords'] end)
  end
  from public.staff_accounts s where s.user_id = auth.uid() and s.active
$function$;

-- drop any leftover per-person switch
update public.staff_accounts set access = access - 'payroll' where access ? 'payroll';
