# Mainfranken IT-Events — Design

**Datum:** 2026-06-25
**Team:** 2 Personen — einer ADK-Ingest-Pipeline, einer API/MCP/UI (gemeinsam entworfen)
**Repo:** git@github.com:gfaurobert/mainfranken-it-events.git
**Kontext:** Hackathon-Projekt für den IT-Verband Mainfranken (Aufgabensteller). IT-Events der Region Mainfranken zusammentragen und über **MCP** und **REST-API** bereitstellen. Fokus auf das Agentische: künftig haben Nutzer persönliche Agenten, die Präferenzen kennen und passende Events finden. Zusätzlich eine API, damit der IT-Verband die Events auf seiner Website präsentieren kann.

## Ziele & Prioritäten

1. **MCP-Server** mit Event-Suche (Hauptfokus, erste lauffähige Demo).
2. **REST-API** auf derselben Logik (für UI + IT-Verband-Website).
3. Optionale Authentifizierung; eingeloggte Nutzer können RSVPs setzen und sich per OTP vernetzen.
4. *Stretch:* schlanke read-only Web-UI → Login/RSVP → semantische Suche.

**Leitprinzip:** Die **Suche** ist das Kern-Feature (die meisten Events werden von uns bereitgestellt). CRUD existiert, ist aber Admin-/Ingest-geschützt.

## Nicht-Ziele (YAGNI für den Hackathon)

- Kein vollständiges Web-Frontend mit Design-System (nur read-only Liste als erstes UI-Ziel).
- Keine Echtzeit-Features (Websockets, Live-Updates).
- Kein komplexes Rollen-/Rechtemodell über Admin vs. User hinaus.
- Semantische Suche und Embeddings sind Stretch, nicht MVP.

## Tech-Stack

- **Sprache:** Python.
- **DB/Infra:** Supabase (Postgres + pgvector + Auth). Sofort von beiden Teammitgliedern parallel erreichbar.
- **REST:** FastAPI.
- **MCP:** offizielles Python-MCP-SDK.
- **Auth:** Supabase Auth (Magic Link/E-Mail) für Menschen; langlebiges **Personal Access Token (PAT)** als Bearer-Token für Agenten.
- **Ingest:** Google ADK (separate Pipeline, dein Part) — schreibt über den Ingest-Endpunkt, nicht direkt in die DB.

## Architektur (Ansatz A: gemeinsame Core-Logik)

```
            ┌─────────────────────────────────────────┐
            │              Supabase                    │
            │   Postgres (+ pgvector)  +  Auth         │
            └──────────────────▲──────────────────────┘
                               │ (supabase-py client)
                    ┌──────────┴───────────┐
                    │      core/  (Python)  │   ← gesamte Geschäftslogik
                    │  Modelle · Suche ·    │     + Pydantic-Schemas
                    │  RSVP · Connections · │     + Auth-Validierung
                    │  Ingest/Dedupe        │
                    └───▲───────────▲───────┘
          dünner Adapter│           │dünner Adapter
              ┌─────────┴──┐   ┌────┴──────────┐
              │  mcp/      │   │   api/         │
              │ MCP-Server │   │  FastAPI REST  │
              │ (Fokus 1)  │   │  (Fokus 2)     │
              └────────────┘   └───▲────────────┘
                                   │ HTTP
                         ┌─────────┴─────────┐      ┌──────────────┐
                         │  web/ (Stretch)   │      │ ingest/ ADK  │
                         │ read-only Liste   │      │ Pipeline     │
                         │ → Login/RSVP      │      │ (dein Part)  │
                         └───────────────────┘      └──────┬───────┘
                                                           │ POST /ingest
                                                           ▼ (an api/ → core)
```

**Begründung Ansatz A:** Geschäftslogik wird **einmal** in `core/` gebaut. MCP-Server und REST-API sind dünne Adapter, die `core`-Funktionen aufrufen → keine Doppelung, garantiert gleiches Verhalten, beide unabhängig testbar. Da MCP der Hauptfokus ist und die API danach kommt, ist `core` zuerst fertig und der MCP-Server hängt sich direkt dran.

### Komponenten

- **`core/`** — einzige Stelle mit Logik. Funktionen: `search_events(...)`, `get_event(...)`, `set_rsvp(...)`, `list_my_rsvps(...)`, `get_my_profile(...)`, `update_my_profile(...)`, `request_connection_otp(...)`, `redeem_connection_otp(...)`, `list_connections(...)`, `list_connection_events(...)`, `ingest_events(...)`. Validiert Auth (Supabase-JWT **oder** PAT) und kommuniziert mit Supabase. Pydantic-Modelle für Ein-/Ausgaben.
- **`mcp/`** — MCP-Server (Python-SDK). Übersetzt MCP-Tool-Calls 1:1 in `core`-Aufrufe. **Erste Priorität.**
- **`api/`** — FastAPI. Spiegelt dieselben `core`-Funktionen als REST. Liefert auch den Ingest-Endpunkt. Zweite Priorität.
- **`web/`** — schlanke read-only Event-Liste mit Suche/Filter (Stretch), danach Login + RSVP.
- **`ingest/`** — ADK-Pipeline (dein Part): Quellen-Discovery-Agent → Scraping-Agents → Zusammenfassen/Dedupe → `POST /ingest/events`. Schreibt **nicht** direkt in die DB, damit Dedupe-Logik an einer Stelle in `core` liegt.

## Datenmodell (Supabase/Postgres)

### `events`
| Feld | Typ | Hinweis |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `description` | text | |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | nullable |
| `location_name` | text | |
| `city` | text | |
| `address` | text | nullable |
| `lat`, `lng` | float | nullable |
| `url` | text | Quell-/Anmelde-Link |
| `organizer` | text | nullable |
| `tags` | text[] | Kategorien/Themen |
| `is_free` | bool | |
| `price` | text | nullable |
| `source` | text | Herkunft (für Ingest) |
| `content_hash` | text | deterministisch aus title+starts_at+location → Dedupe-Schlüssel |
| `embedding` | vector | *Stretch* (pgvector) |
| `created_at`, `updated_at` | timestamptz | |

### `profiles`
- `id` (= Supabase-Auth-User-ID, PK), `display_name`, `bio`, `interests` (text[]), `contact` (jsonb, z.B. LinkedIn/E-Mail), `shared_fields` (text[] — welche Felder für Connections sichtbar sind).
- **Prinzip:** Nur was der Nutzer freigibt, ist für Verbundene sichtbar.

### `access_tokens` (PAT für Agenten)
- `id`, `user_id`, `token_hash`, `label`, `created_at`, `revoked_at`.

### `rsvps`
- `user_id`, `event_id`, `status` (`going` | `interested`), `created_at`. PK: (user_id, event_id).

### `connections`
- `user_a`, `user_b`, `created_at`. Ungerichtet — immer als Paar mit `user_a < user_b` gespeichert.

### `connection_otps`
- `code`, `issuer_id`, `expires_at` (+15 min), `used_at`, `used_by`. Einmal-Code.

### RLS (Row-Level-Security)
- `events`: öffentlich lesbar; Schreibzugriff nur Admin/Ingest (Service-Token).
- `profiles`, `rsvps`, `connections`: nur eigene Zeilen + die von verbundenen Nutzern (für freigegebene Felder bzw. RSVPs).

## MCP-Tools & API-Oberfläche

MCP-Tools und REST-Endpunkte rufen dieselben `core`-Funktionen auf.

**Öffentlich (keine Auth):**
- `search_events(query?, date_from?, date_to?, city?, tags?, is_free?, limit?)` → Liste — **Kern-Tool**.
- `get_event(id)`.

**Authentifiziert (Mensch via JWT oder Agent via PAT):**
- `set_rsvp(event_id, status)` / `list_my_rsvps()`.
- `get_my_profile()` / `update_my_profile(fields…, shared_fields)`.
- `request_connection_otp()` → `code` + Ablaufzeit.
- `redeem_connection_otp(code)` → erstellt Connection.
- `list_connections()` → freigegebene Profile der Verbundenen.
- `list_connection_events()` → „wohin gehen meine Connections" (deren RSVPs).

**Ingest (geschützt, Service-Token) — Vertrag zur ADK-Pipeline:**
- `POST /ingest/events` — Batch-Upsert mit Dedupe über `content_hash`.

**Admin/Ingest-geschützt:**
- `create_event` / `update_event` / `delete_event` — existieren, aber nicht Teil des öffentlichen Such-Fokus.

## Networking-Flow (OTP)

1. A (eingeloggt) ruft `request_connection_otp()` → kurzer Code, 15 min gültig, einmalig.
2. A nennt B den Code **persönlich auf dem Event**.
3. B (eingeloggt) ruft `redeem_connection_otp(code)` → `connections`-Eintrag (A,B), Code wird verbraucht.
4. A & B sehen nun gegenseitig **nur die freigegebenen Profilfelder** und über `list_connection_events()`, **wohin der andere geht**.

Konsens = Code-Eingabe. Abgelehnt werden: Selbst-Verbindung, abgelaufene und bereits benutzte Codes, bereits bestehende Connection.

## Vorgehen (Phasen)

1. Supabase-Schema + RLS + Seed-Events; `core` (Modelle, `search_events`, `get_event`, Auth-Validierung).
2. **MCP-Server** mit `search_events`/`get_event` → **erste lauffähige Demo**.
3. `core`: RSVP, Profile, OTP-Connections → als MCP-Tools ergänzen.
4. FastAPI-REST als zweiter Adapter + `POST /ingest`.
5. *Stretch:* `web/` read-only Liste → Login/RSVP; semantische Suche (Embeddings via pgvector).

## Fehlerbehandlung

- Eingaben via Pydantic validiert.
- Klare, explizite Fehler: ungültiger/abgelaufener/benutzter OTP, Event nicht gefunden, fehlende/ungültige Auth, Selbst-Verbindung.
- Keine sensiblen Daten in Fehlermeldungen.

## Tests

- **`core` ist die Testschicht.** Unit-Tests für: Suche/Filter-Kombinationen, OTP-Lebenszyklus (Ablauf, Einmaligkeit, Selbst-Verbindung, Doppel-Connection), Sichtbarkeitsregeln (nur freigegebene Felder).
- MCP- und API-Adapter sind dünn → wenige Integrationstests, die den Durchstich prüfen.

## Offene Punkte / Annahmen

- Genaues `content_hash`-Rezept wird in Phase 1 festgelegt (Vorschlag: normalisierter `title` + `starts_at` + `city`).
- Standard-Branch beim ersten Push: `main` (statt `master`).
- Supabase-Projekt + Secrets (URL, anon key, service key) werden außerhalb des Repos (`.env`) gehalten.
