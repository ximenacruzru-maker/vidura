-- A "New hire" role: only the training (and their own settings) until an admin changes their role.
alter table public.staff_accounts drop constraint if exists staff_accounts_role_check;
alter table public.staff_accounts add constraint staff_accounts_role_check
  check (role = any (array['owner','admin','producer','protege','sdr','csr','va','new_hire']));

create or replace function public.staff_can(section text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select case
    when s.role in ('owner','admin') then true
    when section in ('performance', 'payroll') then false
    when s.access ? section then coalesce((s.access->>section)::boolean, false)
    else section = any (case s.role
      when 'new_hire' then array['training']
      when 'protege' then array['books','resources','work','chat','training','proteges','passwords']
      else array['books','resources','work','chat','training','passwords'] end)
  end
  from public.staff_accounts s where s.user_id = auth.uid() and s.active
$function$;
