-- API keys for programmatic access
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  key_hash text not null,
  name text default 'Untitled',
  created_at timestamptz default now(),
  last_used_at timestamptz
);

create unique index idx_api_keys_hash on api_keys(key_hash);
create index idx_api_keys_user on api_keys(user_id);

alter table api_keys enable row level security;

create policy "Users manage own API keys" on api_keys
  for all using ((select auth.uid()) = user_id);
