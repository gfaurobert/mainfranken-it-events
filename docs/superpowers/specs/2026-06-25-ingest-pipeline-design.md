# Mainfranken IT-Events — Ingest-Pipeline (ADK) — Design

**Datum:** 2026-06-25
**Scope:** Die interne **Ingestion-Pipeline** (`ingest/`) aus dem Gesamt-Design ([2026-06-25-mainfranken-it-events-design.md](./2026-06-25-mainfranken-it-events-design.md), UC-1). Baut auf **Google ADK 2.0** (Workflow-Runtime) auf und befüllt die `events`-Tabelle mit echten IT-Events aus dem Raum Mainfranken.
**Abgrenzung:** API/MCP/`core` sind der Part des Teammitglieds. Dieses Dokument beschreibt nur die Pipeline + die daraus folgenden DB-Anpassungen (als Vorschlag, im Team abzustimmen).

---

## 1. Ziel & Leitprinzipien

- **Hybrid-Pipeline:** deterministischer Connector-Kern für strukturierte Quellen **+** agentischer LLM-Layer nur für den unstrukturierten Long-Tail.
- **Leitprinzip (vom Auftraggeber bestätigt):** *Wo Determinismus/Code möglich ist → Code. Agenten nur dort, wo sie echten Mehrwert bringen.*
- **Demo-sicher & einfach:** Der Kern muss zur Hackathon-Demo zuverlässig echte Events liefern. KISS/YAGNI vor Vollständigkeit.
- **Neueste ADK-Version:** Google ADK ≥ 2.0 (Workflow-Runtime, graph-basiert), Python ≥ 3.11.

## 2. Getroffene Entscheidungen

| # | Entscheidung | Wahl |
|---|---|---|
| D1 | Grad des Agentischen | **Hybrid** — deterministischer Kern + agentischer Long-Tail |
| D2 | Quellen-Discovery | **Registry + Discovery-Agent** (Kandidaten als `active:false`, manuelles Freischalten) |
| D3 | Output-Ziel | **Konfigurierbare `EventSink`** — `SupabaseSink` (jetzt) / `HttpSink` (sobald `/ingest` steht) |
| D4 | Modell-Provider | **OpenCode-Go** (OpenAI-kompatibel) über **LiteLLM** in ADK |
| D5 | LLM-Punkte im MVP | **Genau zwei:** Extractor (nur HTML-Long-Tail) + Tagger/Normalizer (alle Events) |
| D6 | Dedup im MVP | **Exakt** `(source, external_id)` → `content_hash`-Fallback; Fuzzy = Stretch |
| D7 | Graph-Form | **Linear + ein `ParallelWorker`**; `type→connector` als dict-Dispatch in Code |

## 3. Datenmodell-Änderungen an `events`

Begründet aus der Quellen-Realität (Abgleich des Schemas gegen ~25 geprüfte Quellen). Umzusetzen als neue Supabase-Migration; im Team abzustimmen, da geteilte DB.

**Ergänzen:**

| Feld | Typ | Begründung |
|---|---|---|
| `external_id` | text, nullable | Quell-eigene ID (iCal `UID`, Meetup-ID). |
| — UNIQUE `(source, external_id)` | constraint | **Stabiles Upsert**: verschobene Events werden *aktualisiert* statt dupliziert. Primärer Dedup-Schlüssel. |
| `is_online` | bool, default false | Viele Online-/Hybrid-Events; haben keine `city` → eigene Sicht + Dedup-Fix. |
| `source_url` | text, nullable | Crawl-Herkunft (Feed-/Seiten-URL), getrennt vom Event-Link `url` — für Takedown & Re-Crawl. |
| `last_seen_at` | timestamptz, nullable | Wann zuletzt in der Quelle gesehen → Staleness/„verschwunden = evtl. abgesagt". |
| `review_status` | text, default `'auto'` | `auto` (deterministisch geparst) / `needs_review` (LLM-extrahiert) / `verified` (geprüft). |

**Streichen:**

| Feld | Begründung |
|---|---|
| `lat`, `lng` | Keine Quelle liefert Koordinaten; kein Geocoding/Map im MVP-Scope. Per Migration jederzeit zurückholbar. |

**`content_hash`-Rezept anpassen** (kritisch — bricht aktuell bei `city = NULL`):

```
ALT:  md5(lower(title) || '|' || starts_at || '|' || lower(city))
NEU:  md5(lower(title) || '|' || starts_at || '|' || lower(coalesce(city, location_name, 'online')))
```

`content_hash` bleibt nur **Fallback**; primär dedupliziert `(source, external_id)`.

## 4. Modulstruktur (`ingest/`)

```
ingest/
  agent.py            # root_agent = Workflow(...)  → Ingest-Lauf (ADK-Entry)
  discovery_agent.py  # separater Workflow: Quellen-Discovery (Stretch)
  config.py           # LiteLlm(opencode-go) + Settings (env)
  models.py           # SourceConfig · RawEvent · NormalizedEvent (Pydantic)
  registry/
    sources.yaml      # kuratierte Quellen (aus Recherche; type/region/active)
    loader.py         # liest + validiert → list[SourceConfig]
  connectors/         # DETERMINISTISCH (FunctionNode, kein LLM)
    ical.py           #   Schaffenburg, Meetup-iCal
    jsonld.py         #   schema.org/Event
    confstech.py      #   confs.tech JSON
    fetch.py          #   HTML laden (static; headless = Stretch)
  agents/             # AGENTISCH (LlmAgent, output_schema)
    extractor.py      #   HTML → RawEvent[]   (nur Long-Tail)
    normalizer.py     #   Event → tags · is_online-Fallback (alle Events)
    discovery.py      #   WebSearch → SourceConfig-Kandidaten (Stretch)
  dedup.py            # (source,external_id) → content_hash-Fallback
  sink.py             # EventSink: SupabaseSink | HttpSink
  report.py           # Lauf-Zusammenfassung
```

## 5. Ingest-Workflow (ADK 2.0)

```
START
 └─ load_sources    FunctionNode   registry → aktive SourceConfig[]
 └─ collect         ParallelWorker (max_concurrency begrenzt), je Quelle:
        dispatch nach source.type  (dict-Lookup in Python):
          ical│jsonld│confstech → Connector (det.)            → RawEvent[]
          html                  → fetch → extractor (LlmAgent) → RawEvent[]
        Fehler je Quelle isoliert (Quelle failt → Rest läuft weiter)
 └─ JoinNode        fan-in: alle RawEvent[] flach
 └─ tagger          LlmAgent(output_schema=NormalizedEvent[])  tags · is_online
 └─ dedup           FunctionNode   (source,external_id) → content_hash
 └─ sink_write      FunctionNode   EventSink.upsert_batch()   [Supabase│Http]
 └─ report          FunctionNode   counts: new / updated / skipped / errors
```

- **ADK-Bausteine:** `Workflow`, `FunctionNode` (det. Schritte), `LlmAgent` mit `output_schema` (LLM-Schritte), `ParallelWorker` (`@node(parallel_worker=True)`), `JoinNode` (fan-in), `RetryConfig` auf Netzwerk-Nodes (Connector/fetch/sink).
- **Auto-Wrapping:** Funktionen/Agenten direkt in `edges` legen — ADK wrappt sie.
- **LLM-Aufruf im Worker:** Der `collect`-Worker ruft für `html`-Quellen den Extractor-`LlmAgent` (über ADK dynamic node scheduling `ctx.run_node(...)` bzw. direkten Agent-Run — Detail in der Umsetzung).

### Agentisch ↔ deterministisch — die Grenze

| Schritt | Art | Begründung |
|---|---|---|
| iCal/JSON-LD/confs.tech-Connector | **Code** | Strukturierte Quellen → verlässlich, gratis, testbar. `review_status=auto`. |
| HTML-Extractor | **LLM** | Unstrukturiertes HTML → hier bringt der Agent echten Mehrwert. `review_status=needs_review`. |
| Tagger/Normalizer | **LLM** | Konsistente `tags` über heterogene Quellen — kann Code nicht sinnvoll. |
| `city`,`is_free`,`external_id`,`starts_at` | **Code** | Stehen strukturiert im Feed → LLM rät nichts, was schon da ist. |
| Dedup | **Code** | Deterministisch, exakt. |

## 6. Discovery-Workflow (Stretch)

```
START(query) → discovery (LlmAgent + WebSearch-Tool) → candidate SourceConfig[]
 → dedup_gegen_registry (bekannte URLs raus)
 → append_registry: Kandidaten als active:false in sources.yaml
```

**Kein ADK-HITL** — „Review" = Mensch öffnet `sources.yaml` und setzt `active: true`. Bewusste Vereinfachung gegenüber `RequestInput`-Mechanik.

## 7. Pydantic-Modelle (`models.py`)

- **`SourceConfig`** — `name`, `url`, `type` (`ical`|`jsonld`|`confstech`|`html`), `region`, `organizer?`, `active: bool`, `headless: bool = false`.
- **`RawEvent`** — Connector-/Extractor-Ausgabe: `title`, `starts_at`, `ends_at?`, `description?`, `location_name?`, `city?`, `url?`, `organizer?`, `is_online?`, `is_free?`, `price?`, `source`, `source_url?`, `external_id?`.
- **`NormalizedEvent`** — `RawEvent` + `tags: list[str]`, `is_online` gesetzt, `content_hash`, `review_status`. Entspricht 1:1 dem `events`-Schreibvertrag.

## 8. EventSink (`sink.py`)

```python
class EventSink(Protocol):
    def upsert_batch(self, events: list[NormalizedEvent]) -> UpsertResult: ...
```

- **`SupabaseSink`** — `supabase-py` + Service-Role; Upsert mit `on_conflict=(source, external_id)`, sonst `content_hash`. Setzt `last_seen_at = now()`. Für sofortiges paralleles Arbeiten.
- **`HttpSink`** — `POST /ingest/events` (Batch), sobald der Endpoint von `core`/`api` steht. Per Env/Flag (`INGEST_SINK=supabase|http`) umschaltbar.
- **Dedup-Vertrag** mit `core` abstimmen: dieselbe `content_hash`-Formel und derselbe `(source, external_id)`-Key auf beiden Seiten.

## 9. Modell-Konfiguration (`config.py`)

```python
from google.adk.models.lite_llm import LiteLlm
import os

model = LiteLlm(
    model="openai/<deep-v4-flash>",          # exakter Modell-String: vom Provider
    api_base=os.environ["OPENCODE_GO_BASE_URL"],
    api_key=os.environ["OPENCODE_GO_KEY"],
)
```

OpenAI-kompatibler Provider → LiteLLM-`openai/`-Prefix + custom `api_base`. Secrets in `.env` (außerhalb Repo). **Offen:** exakter Modell-String und `api_base` von OpenCode-Go.

## 10. Quellen-Registry — initiale Einträge (MVP)

Aus der Recherche, nach Ingest-Eignung priorisiert:

| Quelle | type | Hinweis |
|---|---|---|
| Schaffenburg e.V. (Makerspace AB) | `ical` | `complete.ics` / `noopenspace.ics`, 24h-Update — Top-Quelle |
| Meetup-Gruppen (WUE.tech, Modern Software Dev, FrankenJS, WPMeetup, Data&Analytics) | `ical` | `/<gruppe>/events/ical/` — nur kommende Events |
| confs.tech | `confstech` | offenes GitHub-JSON, MIT-Lizenz — rechtssicher, DE-Konferenzen |
| Gründerzentren Würzburg | `ical` | iCal je Event (`?_func=genIcs`) |
| ZDI Mainfranken / Startbahn27 / IHK / THWS-FIW | `html` | statisches HTML → LLM-Extractor |

**Stretch-Quellen (headless):** AI Week Mainfranken (`ai-week.de`), baiosphere (Storyblok-CDN).

## 11. Ausführung & Trigger

- **MVP:** manueller Lauf über `agents-cli run` bzw. ein `python -m ingest`-Entry. Idempotent (Upsert) → beliebig oft wiederholbar.
- **Stretch:** Cron/Scheduler. Crawl-Frequenz pro Quelle (THWS/CAIRO wöchentlich, JMU 14-tägig, AI Week saisonal).

## 12. Fehlerbehandlung

- **Quellen-Isolation:** Jede Quelle im `ParallelWorker` ist gekapselt — eine fehlerhafte Quelle bricht den Lauf **nicht** ab, sondern wird im `report` als `error` gezählt.
- **`RetryConfig`** (exponential backoff) auf Netzwerk-Nodes (Connector-Fetch, Sink-Write).
- **Validierung:** alle Boundary-Daten via Pydantic; ungültige RawEvents werden verworfen + geloggt, nicht geschrieben.
- **LLM-Robustheit:** Extractor/Tagger mit `output_schema` (erzwungene Struktur); bei Schema-Verletzung Event als `needs_review` markieren statt Lauf-Abbruch.
- **Keine sensiblen Daten** in Logs/Fehlermeldungen.

## 13. Tests

- **Connectoren (deterministisch) = Hauptschicht:** Unit-Tests mit gespeicherten Fixtures (echte iCal-/JSON-LD-/confs.tech-Samples) → erwartete `RawEvent`s. Schnell, kein Netz, kein LLM.
- **`dedup.py`:** exakte Tabellen-Tests (gleicher `external_id` → Update; gleicher `content_hash` ohne ID → Skip; `city=NULL`/online → kein Falsch-Merge).
- **`EventSink`:** `SupabaseSink` gegen lokale/Test-Supabase; `HttpSink` gegen Mock-Endpoint.
- **LLM-Schritte:** dünn gehalten — 1–2 Integrationstests mit fixiertem HTML-Sample; Fokus auf „Schema wird eingehalten", nicht auf exakten Text.
- **Workflow-Durchstich:** ein End-to-End-Test (`App` + `InMemoryRunner`) mit 2 Fake-Quellen → Events landen im Sink.

## 14. Scope-Grenze

```
MVP    : Workflow(load_sources → ParallelWorker[connector|extractor] → Join
                  → tagger(LLM) → dedup(exact) → SupabaseSink → report)
         + ~5 echte Quellen (iCal/confs.tech/HTML) + Schema-Migration
Stretch: Discovery-Agent · Headless (AI Week/baiosphere) · Fuzzy-Dedup
         · HttpSink-Umstellung · Cron-Scheduler
```

## 15. Offene Punkte

- Exakter OpenCode-Go **Modell-String** (`deep v4 flash`) und **`api_base`-URL**.
- **Dedup-Vertrag** mit `core`/API final abstimmen (gleiche `content_hash`-Formel + `(source, external_id)`).
- Genaue ADK-Verdrahtung des LLM-Aufrufs im `ParallelWorker` (`ctx.run_node` vs. direkter Agent-Run) — in der Umsetzung verifizieren.
- Schema-Migration mit Teammitglied abstimmen (geteilte DB).
- Takedown-/Attributions-Policy für gescrapte Inhalte (offen aus Gesamt-SPEC).
