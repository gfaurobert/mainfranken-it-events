-- Ingest-bezogene Felder an events ergänzen, lat/lng entfernen
alter table public.events
  add column if not exists external_id text,
  add column if not exists is_online boolean not null default false,
  add column if not exists source_url text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists review_status text not null default 'auto'
    check (review_status in ('auto','needs_review','verified'));

alter table public.events drop column if exists lat;
alter table public.events drop column if exists lng;

-- Stabiles Upsert über Quell-ID (partial unique: nur wenn external_id gesetzt)
create unique index if not exists events_source_external_id_key
  on public.events (source, external_id)
  where external_id is not null;
