-- Mainfranken IT-Events — Initiales Schema (Phase 1)
-- Auth: Supabase Auth (auth.users). Personenbezogene Tabellen referenzieren auth.users.
-- Zugriffsmodell: core/ und Ingest greifen mit Service-Role-Key zu (umgeht RLS, erzwingt Authz im Code).
-- RLS dient als Defense-in-Depth: events oeffentlich lesbar; persoenliche Tabellen fuer anon/authenticated gesperrt.

-- ---------- Helfer: updated_at automatisch pflegen ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- events ----------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  location_name text,
  city          text,
  address       text,
  lat           double precision,
  lng           double precision,
  url           text,
  organizer     text,
  tags          text[] not null default '{}',
  is_free       boolean,
  price         text,
  source        text,
  content_hash  text unique,                 -- Dedupe-Schluessel fuer Ingest-Upsert
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index events_starts_at_idx on public.events (starts_at);
create index events_city_idx       on public.events (city);
create index events_tags_idx       on public.events using gin (tags);
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------- profiles ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  bio           text,
  interests     text[] not null default '{}',
  contact       jsonb  not null default '{}'::jsonb,
  shared_fields text[] not null default '{}',  -- welche Felder fuer Connections sichtbar sind
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- access_tokens (PAT fuer Agenten) ----------
create table public.access_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null unique,          -- nur Hash speichern, nie Klartext
  label       text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index access_tokens_user_idx on public.access_tokens (user_id);

-- ---------- rsvps ----------
create table public.rsvps (
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  status     text not null check (status in ('going','interested','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index rsvps_event_idx on public.rsvps (event_id);
create trigger rsvps_set_updated_at
  before update on public.rsvps
  for each row execute function public.set_updated_at();

-- ---------- connections (ungerichtet, kanonisch user_a < user_b) ----------
create table public.connections (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  event_id   uuid references public.events(id) on delete set null,  -- optionaler Event-Kontext
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)   -- verhindert Selbst-Verbindung und Duplikate
);
create index connections_user_b_idx on public.connections (user_b);

-- ---------- connection_otps ----------
create table public.connection_otps (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  issuer_id  uuid not null references auth.users(id) on delete cascade,
  event_id   uuid references public.events(id) on delete set null,  -- optional event-scoped
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- nur EIN aktiver (unbenutzter) Code pro Issuer gleichzeitig
create unique index connection_otps_active_issuer_idx
  on public.connection_otps (issuer_id)
  where used_at is null;
create index connection_otps_code_idx on public.connection_otps (code);

-- ---------- RLS ----------
alter table public.events          enable row level security;
alter table public.profiles        enable row level security;
alter table public.access_tokens   enable row level security;
alter table public.rsvps           enable row level security;
alter table public.connections     enable row level security;
alter table public.connection_otps enable row level security;

-- events: oeffentlich lesbar (anon + authenticated). Schreiben nur ueber Service-Role (kein Policy noetig).
create policy events_public_read on public.events
  for select to anon, authenticated using (true);

-- persoenliche Tabellen: keine Policies fuer anon/authenticated => nur Service-Role (core/) hat Zugriff.
-- (Granulare auth.uid()-Policies koennen spaeter ergaenzt werden, falls das Web-UI direkt mit Supabase spricht.)
