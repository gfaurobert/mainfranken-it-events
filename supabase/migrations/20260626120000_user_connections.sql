-- connections: undirected link, canonical user_a < user_b
create table if not exists public.connections (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint connections_ordered check (user_a < user_b)
);

create index connections_user_a_idx on public.connections (user_a);
create index connections_user_b_idx on public.connections (user_b);

alter table public.connections enable row level security;
-- no policies: service role only

-- connection_otps: ephemeral 6-digit handshake codes
create table if not exists public.connection_otps (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references auth.users (id) on delete cascade,
  code_lookup text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index connection_otps_code_lookup_active_idx
  on public.connection_otps (code_lookup)
  where used_at is null;

create index connection_otps_issuer_created_idx
  on public.connection_otps (issuer_id, created_at desc);

alter table public.connection_otps enable row level security;
-- no policies: service role only
