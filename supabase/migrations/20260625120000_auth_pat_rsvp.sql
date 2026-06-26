-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  last_pat_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- access_tokens (service role only — no RLS policies for anon/authenticated)
create table if not exists public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_lookup text not null,
  token_hash text not null,
  label text not null default 'agent',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index access_tokens_token_lookup_active_idx
  on public.access_tokens (token_lookup)
  where revoked_at is null;

create index access_tokens_user_id_active_idx
  on public.access_tokens (user_id)
  where revoked_at is null;

alter table public.access_tokens enable row level security;
-- no policies: only service role can read/write

-- rsvps
create table if not exists public.rsvps (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null check (status in ('interested', 'going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.rsvps enable row level security;

create policy "rsvps_select_own"
  on public.rsvps for select
  using (auth.uid() = user_id);

create policy "rsvps_insert_own"
  on public.rsvps for insert
  with check (auth.uid() = user_id);

create policy "rsvps_update_own"
  on public.rsvps for update
  using (auth.uid() = user_id);

create policy "rsvps_delete_own"
  on public.rsvps for delete
  using (auth.uid() = user_id);
