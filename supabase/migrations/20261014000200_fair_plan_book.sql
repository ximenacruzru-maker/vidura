-- Books of Business: a CA FAIR Plan book, its own tab. FAIR Plan bills the client directly, so each policy keeps its
-- payment plan, method and next payment due in data (paymentPlan, paymentMethod, paymentDue) alongside the status.
alter table public.book_accounts drop constraint if exists book_accounts_book_check,
  add constraint book_accounts_book_check check (book = any (array['farmers', 'commercial', 'brokered_commercial', 'brokered_personal', 'fair_plan']));
