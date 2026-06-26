-- Replace legacy per-event OTP table (code, event_id) with global OTP schema (code_lookup, code_hash).
drop table if exists public.connection_otps cascade;

create table public.connection_otps (
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

notify pgrst, 'reload schema';
