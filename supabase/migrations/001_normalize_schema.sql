-- Drop the old table
drop table if exists portfolios;

-- profiles: user preferences
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  dark_mode boolean default false,
  display_currency text default 'EUR',
  view_states jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- portfolios: multi-portfolio ready
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text default 'Default',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- assets: per-portfolio asset configuration
create table assets (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid references portfolios(id) on delete cascade not null,
  ticker text not null,
  name text not null,
  color text not null,
  hidden boolean default false,
  created_at timestamptz default now(),
  unique(portfolio_id, ticker)
);

-- transactions: individual rows
create table transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid references portfolios(id) on delete cascade not null,
  ticker text not null,
  type text not null check (type in ('buy', 'sell', 'deposit', 'withdraw')),
  date date not null,
  shares numeric,
  price_at_entry numeric,
  amount numeric,
  currency text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index idx_portfolios_user on portfolios(user_id);
create index idx_assets_portfolio on assets(portfolio_id);
create index idx_transactions_portfolio on transactions(portfolio_id);
create index idx_transactions_date on transactions(portfolio_id, date);

-- RLS
alter table profiles enable row level security;
alter table portfolios enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;

create policy "Users manage own profile" on profiles
  for all using (auth.uid() = id);

create policy "Users manage own portfolios" on portfolios
  for all using (auth.uid() = user_id);

create policy "Users manage own assets" on assets
  for all using (portfolio_id in (select id from portfolios where user_id = auth.uid()));

create policy "Users manage own transactions" on transactions
  for all using (portfolio_id in (select id from portfolios where user_id = auth.uid()));
