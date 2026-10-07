-- Ximena's bonus is measured on folios, like commission: the 21st pays the folio before it (Nov 21 pays the
-- Sep 21 - Oct 20 folio), with the four gates measured over that folio. retention_months.month now holds the first day
-- of the folio a reconciliation mark is for.
update public.hr_staff set bonus_period = 'folio_gated'
where name = 'Ximena Cruz' and agency_id = (select id from public.agencies where agencyzoom_sync);
