-- Partiellen Unique-Index durch vollen ersetzen.
-- Grund: PostgREST kann einen partiellen Index (WHERE external_id IS NOT NULL)
-- nicht als ON-CONFLICT-Arbiter nutzen (Fehler 42P10). Ein voller Unique-Index
-- auf (source, external_id) verhält sich funktional identisch, weil NULLs in
-- Postgres als distinkt gelten: mehrere Zeilen mit external_id IS NULL pro
-- Quelle bleiben erlaubt (die laufen im Sink ohnehin über content_hash).
drop index if exists public.events_source_external_id_key;

create unique index events_source_external_id_key
  on public.events (source, external_id);
