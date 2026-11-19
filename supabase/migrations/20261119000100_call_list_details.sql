-- Call lists: room for the extra facts a list brings, so the person calling has them in front of them. The 30/60/90 day
-- renewal list keeps each client's window ("0-30 Days", "31-60 Days", "61-90 Days"), days out, policy number, renewal
-- premium, increase ($ and %), alternate phones and email here: { window, daysOut, policy, premium, increase,
-- increasePct, altPhone, email, rank }.
alter table public.call_list_items add column if not exists details jsonb not null default '{}'::jsonb;
