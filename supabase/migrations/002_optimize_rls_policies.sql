-- Optimize RLS policies: wrap auth.uid() in (select ...) so Postgres
-- caches the result per-statement instead of evaluating per-row.

drop policy if exists "Users manage own profile" on profiles;
drop policy if exists "Users manage own portfolios" on portfolios;
drop policy if exists "Users manage own assets" on assets;
drop policy if exists "Users manage own transactions" on transactions;

create policy "Users manage own profile" on profiles
  for all using ((select auth.uid()) = id);

create policy "Users manage own portfolios" on portfolios
  for all using ((select auth.uid()) = user_id);

create policy "Users manage own assets" on assets
  for all using (portfolio_id in (select id from portfolios where user_id = (select auth.uid())));

create policy "Users manage own transactions" on transactions
  for all using (portfolio_id in (select id from portfolios where user_id = (select auth.uid())));
