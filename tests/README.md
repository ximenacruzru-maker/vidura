# Checks

## Layout (runs on every pull request)
`npm run build && npm run test:layout` serves the built app, signs in against a stand-in for Supabase
(`e2e/supabase-stub.mjs`) and visits every page at phone width (390px) and desktop width (1440px) in each regular
theme. It fails on a page error, on anything wider than the screen (tables may scroll inside their panels), or if the
phone menu drawer doesn't open and close. The data is the demo agency's (`fixtures/northwind.json.gz`) — made up,
dumped under row-level security as the demo owner, so no real agency's data is in the repo.

Locally, if Playwright's browser isn't installed: `CHROMIUM_PATH=/path/to/chrome npm run test:layout`.

## Browser data (runs on every pull request)
`npm run test:sync` checks that what the screens keep in the browser is saved to the database (`app_store`), that
changes made by the app and by the original screens' frame are both saved, that sign-out leaves only the theme on the
browser, that signing in again brings everything back, and that a Claude API key never stays in the browser.

## Data isolation (run in the database after any schema change)
`select * from public.isolation_audit();` lists any table or policy that could let one agency see another's rows.
An empty result is a pass.
