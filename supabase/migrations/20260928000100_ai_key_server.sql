-- The Claude API key the document readers use (commission plans, receipts) used to sit in plain text in each browser
-- and was sent from the page straight to Anthropic. It is now kept once per agency, encrypted with the Vault key, and
-- only the ai-proxy edge function (service role) can decrypt it; the browser never receives it back.
create table if not exists public.agency_ai_keys (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  secret bytea not null,
  model text not null default 'claude-sonnet-5',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Row-level security with no policies: no browser login can read or write the table directly.
alter table public.agency_ai_keys enable row level security;
revoke all on public.agency_ai_keys from anon, authenticated;

-- Whether the signed-in login's agency has a key, and which model it uses (never the key itself).
create or replace function public.ai_key_status()
 returns table (configured boolean, model text, updated_by text, updated_at timestamptz)
 language sql stable security definer set search_path to ''
as $$
  select true, k.model, k.updated_by, k.updated_at from public.agency_ai_keys k where k.agency_id = public.current_agency_id()
$$;

-- Admins set or change the key and model. An empty key keeps the current key (to change only the model);
-- p_remove deletes it.
create or replace function public.ai_key_save(p_key text, p_model text, p_remove boolean default false)
 returns void language plpgsql security definer set search_path to ''
as $$
declare v_agency uuid := public.current_agency_id(); v_who text; v_model text := coalesce(nullif(trim(p_model), ''), 'claude-sonnet-5');
begin
  if not public.staff_is_admin() or v_agency is null then raise exception 'Only admins can change the Claude API key'; end if;
  if v_model !~ '^claude-[a-z0-9.-]+$' then raise exception 'That is not a Claude model name'; end if;
  if p_remove then delete from public.agency_ai_keys where agency_id = v_agency; return; end if;
  select display_name into v_who from public.staff_accounts where user_id = auth.uid();
  if coalesce(trim(p_key), '') = '' then
    update public.agency_ai_keys set model = v_model, updated_by = v_who, updated_at = now() where agency_id = v_agency;
    if not found then raise exception 'Enter the API key'; end if;
    return;
  end if;
  if trim(p_key) !~ '^sk-ant-' then raise exception 'That does not look like an Anthropic API key (it starts with sk-ant-)'; end if;
  insert into public.agency_ai_keys(agency_id, secret, model, updated_by)
  values (v_agency, extensions.pgp_sym_encrypt(trim(p_key), public.vault_key()), v_model, v_who)
  on conflict (agency_id) do update set secret = excluded.secret, model = excluded.model, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- For the ai-proxy edge function only: the decrypted key and model for an active staff login's agency.
create or replace function public.ai_key_for_user(p_user uuid)
 returns table (api_key text, model text)
 language sql stable security definer set search_path to ''
as $$
  select extensions.pgp_sym_decrypt(k.secret, public.vault_key()), k.model
  from public.staff_accounts s join public.agency_ai_keys k on k.agency_id = s.agency_id
  where s.user_id = p_user and s.active
$$;

revoke execute on function public.ai_key_status() from public, anon;
revoke execute on function public.ai_key_save(text, text, boolean) from public, anon;
revoke execute on function public.ai_key_for_user(uuid) from public, anon, authenticated;
grant execute on function public.ai_key_status() to authenticated;
grant execute on function public.ai_key_save(text, text, boolean) to authenticated;
grant execute on function public.ai_key_for_user(uuid) to service_role;
