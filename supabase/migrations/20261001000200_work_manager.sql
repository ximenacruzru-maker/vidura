-- Whoever runs the work queue (Team & access: "Runs the work queue") sees every work item and assigns them to anyone.
-- Everyone else still sees only the work assigned to them or that they logged; admins see it all.
create or replace function public.work_item_is_mine(p_owner text, p_created_by uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select coalesce(public.staff_is_admin(), false)
      or coalesce(public.staff_can('work_manager'), false)
      or p_created_by = auth.uid()
      or lower(trim(coalesce(p_owner, ''))) = any (coalesce(public.my_names(), '{}'))
$function$;
