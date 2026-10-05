create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  status text not null default 'pending' check (status in ('pending','connected','expired','revoked','error')),
  external_account_id text,
  external_account_name text,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  connected_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, platform)
);

alter table public.social_connections enable row level security;
revoke all on table public.social_connections from anon, authenticated;
create index if not exists social_connections_user_id_idx on public.social_connections(user_id);
create index if not exists social_connections_status_idx on public.social_connections(status);
comment on table public.social_connections is 'Server-managed metadata for external social account connections. OAuth access/refresh tokens must never be stored in this table or exposed through the Data API.';
