-- The product is Declara (it used to be Vidura). Renames what the database still calls Vidura/Vida:
--   * the Blue theme's id "vidura" -> "declara" (saved preferences, the stored theme list, default settings),
--   * "Vida AI" / "Vida Foresight(s)" in stored screen text (plans, resources, systems),
--   * demo_reset's default theme,
--   * the demo login's email demo@vidura.app -> demo@declara.app (same password).
-- Run after the front end that knows the new names is live; the app also maps a saved "vidura" theme to "declara".

update public.user_prefs set theme = 'declara' where theme = 'vidura';

update public.reference_data
set data = (data - 'vidura') || jsonb_build_object('declara', data -> 'vidura')
where key = 'lg:THEMES' and data ? 'vidura';

update public.reference_data
set data = jsonb_set(data, '{theme}', '"declara"')
where key = 'lg:SETTINGS' and data ->> 'theme' = 'vidura';

update public.reference_data
set data = replace(replace(replace(replace(replace(data::text,
      'Vida Foresights Advisor', 'Declara Foresight Advisor'),
      'Vida Foresights', 'Declara Foresight'),
      'Vida Foresight', 'Declara Foresight'),
      'Vida AI', 'Declara AI'),
      'Vidura', 'Declara')::jsonb
where data::text ~ '(Vida AI|Vida Foresight|Vidura)';

do $$
declare def text := pg_get_functiondef('public.demo_reset(text, double precision)'::regprocedure);
begin
  if position('''theme'', ''vidura''' in def) > 0 then
    execute replace(def, '''theme'', ''vidura''', '''theme'', ''declara''');
  end if;
end $$;
revoke execute on function public.demo_reset(text, double precision) from public, anon, authenticated;

update auth.users set email = 'demo@declara.app', updated_at = now() where email = 'demo@vidura.app';
update auth.identities set identity_data = jsonb_set(identity_data, '{email}', '"demo@declara.app"'), updated_at = now()
  where provider = 'email' and identity_data ->> 'email' = 'demo@vidura.app';
update public.staff_accounts set email = 'demo@declara.app' where email = 'demo@vidura.app';
