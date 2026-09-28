# Checks

## Layout (runs on every pull request)
`npm run build && npm run test:layout` serves the built app, signs in against a stand-in for Supabase
(`e2e/supabase-stub.mjs`) and visits every page at phone width (390px) and desktop width (1440px) in each regular
theme. It fails on a page error, on anything wider than the screen (tables may scroll inside their panels), or if the
phone menu drawer doesn't open and close. The data is the demo agency's (`fixtures/northwind.json.gz`) — made up,
dumped under row-level security as the demo owner, so no real agency's data is in the repo.

Locally, if Playwright's browser isn't installed: `CHROMIUM_PATH=/path/to/chrome npm run test:layout`.

## Parity (runs on every pull request)
`npm run test:parity` opens each rebuilt screen next to the original it replaces, against the demo agency's data,
and fails on any difference in text, bar lengths or gauges:
- Sales KPIs: every period.
- Reports: the dashboard for every period and book, plus a custom range. The Scorecard, Producer, Folio and Written
  Business tabs for every folio, one producer and one carrier drill-down, Written Business for every
  carrier / business type / metric, the Daily tab for every day, and the To do list.
- Commissions: every folio, then a carrier statement uploaded (a cancellation, a sale missing from it, an extra row),
  one decision overridden, and the statement removed. The upload must actually exclude sales.
- SDR Transfer: every pay period.

## Browser data (runs on every pull request)
`npm run test:sync` checks that what the screens keep in the browser is saved to the database (`app_store`), that
changes made by the app and by the original screens' frame are both saved, that sign-out leaves only the theme on the
browser, that signing in again brings everything back, and that a Claude API key never stays in the browser.

## Data isolation (run in the database after any schema change)
`select * from public.isolation_audit();` lists any table or policy that could let one agency see another's rows.
An empty result is a pass.
