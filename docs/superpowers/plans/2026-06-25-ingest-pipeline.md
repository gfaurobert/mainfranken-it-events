# ADK-Ingest-Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Google-ADK-2.0-Pipeline, die echte IT-Events aus dem Raum Mainfranken aus heterogenen Quellen sammelt, normalisiert, dedupliziert und in die Supabase-`events`-Tabelle schreibt.

**Architecture:** Hybrid — deterministischer Connector-Kern (iCal/JSON-LD/confs.tech als reiner Python-Code) plus agentischer LLM-Layer nur für unstrukturiertes HTML (Extractor) und für Tagging (Normalizer). Orchestriert als linearer ADK-`Workflow` mit einem `ParallelWorker` für den Quellen-Fan-out. Output über ein austauschbares `EventSink` (Supabase jetzt, HTTP später).

**Tech Stack:** Python ≥ 3.11 · google-adk ≥ 2.0 · litellm (OpenCode-Go, OpenAI-kompatibel) · icalendar · httpx · beautifulsoup4 · supabase-py · pydantic · pytest + pytest-asyncio.

**Spec:** [docs/superpowers/specs/2026-06-25-ingest-pipeline-design.md](../specs/2026-06-25-ingest-pipeline-design.md)

## Global Constraints

- **Python ≥ 3.11** (ADK-Workflow-Runtime erfordert es), **google-adk ≥ 2.0.0**.
- **Modell ausschließlich über LiteLLM/OpenCode-Go**: `LiteLlm(model="openai/<MODEL>", api_base=$OPENCODE_GO_BASE_URL, api_key=$OPENCODE_GO_KEY)`. Niemals einen Gemini-/Vertex-Default verwenden.
- **Secrets nur aus Umgebung** (`.env`, nie im Repo): `OPENCODE_GO_KEY`, `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SINK`.
- **LLM nur an zwei Stellen**: HTML-Extractor und Tagger. Alle anderen Felder (`city`, `is_free`, `external_id`, `starts_at`) deterministisch aus den Connectoren.
- **Dedup**: primär `(source, external_id)`, Fallback `content_hash = md5(lower(title) || '|' || starts_at_iso || '|' || lower(coalesce(city, location_name, 'online')))`. Dieselbe Formel auf Pipeline- und `core`-Seite.
- **`review_status`**: `auto` für deterministisch geparste Events, `needs_review` für LLM-extrahierte.
- **TDD**: jeder Task schreibt zuerst den fehlschlagenden Test. **Häufige Commits** (ein Commit pro Task-Ende).
- **Arbeitsverzeichnis**: `ingest/` (vom ADK-Scaffold erzeugt). Alle Pfade unten relativ zum Repo-Root `~/it_events_hackathon`.

---

### Task 1: Projekt-Scaffold, Dependencies & Config

**Files:**
- Create (via CLI): `ingest/` (ADK-Boilerplate)
- Create: `ingest/ingest/config.py`
- Create: `ingest/.env.example`
- Modify: `.gitignore` (sicherstellen, dass `ingest/.env` ignoriert wird)
- Test: `ingest/tests/unit/test_config.py`

**Interfaces:**
- Produces: `ingest.config.get_settings() -> Settings` mit Attributen `opencode_key: str`, `opencode_base_url: str`, `opencode_model: str`, `supabase_url: str`, `supabase_service_key: str`, `sink: str`; und `ingest.config.get_model() -> LiteLlm`.

- [ ] **Step 1: ADK-Projekt scaffolden**

Vom Repo-Root (NICHT vorher `mkdir ingest`):
```bash
agents-cli scaffold create ingest --agent adk --prototype --agent-guidance-filename CLAUDE.md
```
Danach die erzeugte Struktur inspizieren:
```bash
find ingest -maxdepth 2 -type f -not -path '*/.*'
```
Erwartet: ein Python-Package mit `agent.py` (enthält `root_agent`), `__init__.py`, `pyproject.toml`/`requirements`, `tests/`-Verzeichnis. Notiere, ob das Agent-Code-Verzeichnis `ingest/app/` oder `ingest/ingest/` heißt — alle folgenden Pfade `ingest/ingest/...` ggf. an den tatsächlichen Namen anpassen.

- [ ] **Step 2: Dependencies hinzufügen**

In `ingest/pyproject.toml` unter dependencies ergänzen (bzw. `ingest/requirements.txt`):
```
google-adk>=2.0.0
litellm>=1.40
icalendar>=5.0
httpx>=0.27
beautifulsoup4>=4.12
supabase>=2.4
pydantic>=2.0
pyyaml>=6.0
```
Dev/Test:
```
pytest>=8.0
pytest-asyncio>=0.23
```
Installieren:
```bash
cd ingest && uv sync 2>/dev/null || pip install -e .
```

- [ ] **Step 3: `.env.example` schreiben**

`ingest/.env.example`:
```
OPENCODE_GO_KEY=
OPENCODE_GO_BASE_URL=
OPENCODE_GO_MODEL=deep-v4-flash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
INGEST_SINK=supabase
```
Sicherstellen, dass `.gitignore` `ingest/.env` (oder `.env`) enthält.

- [ ] **Step 4: Failing test schreiben**

`ingest/tests/unit/test_config.py`:
```python
import os
from ingest.config import get_settings

def test_settings_read_from_env(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_KEY", "k")
    monkeypatch.setenv("OPENCODE_GO_BASE_URL", "https://api.example/v1")
    monkeypatch.setenv("OPENCODE_GO_MODEL", "deep-v4-flash")
    monkeypatch.setenv("SUPABASE_URL", "https://db.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    monkeypatch.setenv("INGEST_SINK", "supabase")
    s = get_settings()
    assert s.opencode_key == "k"
    assert s.opencode_model == "deep-v4-flash"
    assert s.sink == "supabase"
```

- [ ] **Step 5: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_config.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.config`)

- [ ] **Step 6: `config.py` implementieren**

`ingest/ingest/config.py`:
```python
import os
from dataclasses import dataclass
from functools import lru_cache
from google.adk.models.lite_llm import LiteLlm


@dataclass(frozen=True)
class Settings:
    opencode_key: str
    opencode_base_url: str
    opencode_model: str
    supabase_url: str
    supabase_service_key: str
    sink: str


@lru_cache
def get_settings() -> Settings:
    return Settings(
        opencode_key=os.environ.get("OPENCODE_GO_KEY", ""),
        opencode_base_url=os.environ.get("OPENCODE_GO_BASE_URL", ""),
        opencode_model=os.environ.get("OPENCODE_GO_MODEL", "deep-v4-flash"),
        supabase_url=os.environ.get("SUPABASE_URL", ""),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        sink=os.environ.get("INGEST_SINK", "supabase"),
    )


def get_model() -> LiteLlm:
    s = get_settings()
    return LiteLlm(
        model=f"openai/{s.opencode_model}",
        api_base=s.opencode_base_url,
        api_key=s.opencode_key,
    )
```
Hinweis: `get_settings` ist `lru_cache`'d — im Test `get_settings.cache_clear()` aufrufen, falls Env zwischen Tests wechselt.

- [ ] **Step 7: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_config.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ingest/ .gitignore
git commit -m "feat(ingest): ADK-Scaffold, Dependencies, Config (LiteLLM/OpenCode-Go)"
```

---

### Task 2: Pydantic-Datenmodelle

**Files:**
- Create: `ingest/ingest/models.py`
- Test: `ingest/tests/unit/test_models.py`

**Interfaces:**
- Produces:
  - `SourceConfig(name: str, url: str, type: Literal["ical","jsonld","confstech","html"], region: str, organizer: str|None=None, active: bool=True, headless: bool=False)`
  - `RawEvent(title: str, starts_at: datetime, ends_at: datetime|None=None, description: str|None=None, location_name: str|None=None, city: str|None=None, url: str|None=None, organizer: str|None=None, is_online: bool|None=None, is_free: bool|None=None, price: str|None=None, source: str, source_url: str|None=None, external_id: str|None=None)`
  - `NormalizedEvent(RawEvent + tags: list[str], is_online: bool, content_hash: str, review_status: Literal["auto","needs_review","verified"])`

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_models.py`:
```python
from datetime import datetime, timezone
from ingest.models import SourceConfig, RawEvent, NormalizedEvent

def test_source_config_defaults():
    s = SourceConfig(name="Schaffenburg", url="https://x/cal.ics", type="ical", region="Aschaffenburg")
    assert s.active is True and s.headless is False

def test_raw_event_minimal():
    e = RawEvent(title="Meetup", starts_at=datetime(2026,7,1,18,tzinfo=timezone.utc), source="meetup")
    assert e.city is None and e.external_id is None

def test_normalized_event_requires_hash():
    e = NormalizedEvent(
        title="Meetup", starts_at=datetime(2026,7,1,18,tzinfo=timezone.utc),
        source="meetup", tags=["dev"], is_online=False,
        content_hash="abc", review_status="auto",
    )
    assert e.review_status == "auto"
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_models.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.models`)

- [ ] **Step 3: `models.py` implementieren**

`ingest/ingest/models.py`:
```python
from datetime import datetime
from typing import Literal
from pydantic import BaseModel

SourceType = Literal["ical", "jsonld", "confstech", "html"]
ReviewStatus = Literal["auto", "needs_review", "verified"]


class SourceConfig(BaseModel):
    name: str
    url: str
    type: SourceType
    region: str
    organizer: str | None = None
    active: bool = True
    headless: bool = False


class RawEvent(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    description: str | None = None
    location_name: str | None = None
    city: str | None = None
    url: str | None = None
    organizer: str | None = None
    is_online: bool | None = None
    is_free: bool | None = None
    price: str | None = None
    source: str
    source_url: str | None = None
    external_id: str | None = None


class NormalizedEvent(RawEvent):
    tags: list[str] = []
    is_online: bool = False
    content_hash: str
    review_status: ReviewStatus = "auto"
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest/ingest/models.py ingest/tests/unit/test_models.py
git commit -m "feat(ingest): Pydantic-Modelle (SourceConfig, RawEvent, NormalizedEvent)"
```

---

### Task 3: content_hash & Dedup

**Files:**
- Create: `ingest/ingest/dedup.py`
- Test: `ingest/tests/unit/test_dedup.py`

**Interfaces:**
- Consumes: `RawEvent`, `NormalizedEvent` (Task 2)
- Produces:
  - `compute_content_hash(title: str, starts_at: datetime, city: str|None, location_name: str|None) -> str`
  - `dedupe(events: list[NormalizedEvent]) -> list[NormalizedEvent]` — entfernt In-Batch-Duplikate; behält bei gleichem `(source, external_id)` bzw. gleichem `content_hash` den ersten Eintrag.

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_dedup.py`:
```python
from datetime import datetime, timezone
from ingest.dedup import compute_content_hash, dedupe
from ingest.models import NormalizedEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)

def _ev(**kw):
    base = dict(title="X", starts_at=DT, source="s", is_online=False,
                content_hash="", review_status="auto", tags=[])
    base.update(kw)
    base["content_hash"] = compute_content_hash(base["title"], base["starts_at"],
                                                base.get("city"), base.get("location_name"))
    return NormalizedEvent(**base)

def test_hash_stable_and_city_fallback():
    h1 = compute_content_hash("X", DT, None, "Hubland")
    h2 = compute_content_hash("X", DT, None, "Hubland")
    h3 = compute_content_hash("X", DT, None, None)  # → 'online'
    assert h1 == h2 and h1 != h3

def test_dedupe_by_external_id():
    a = _ev(source="meetup", external_id="42")
    b = _ev(source="meetup", external_id="42", title="X (updated)")
    out = dedupe([a, b])
    assert len(out) == 1

def test_dedupe_by_content_hash_when_no_id():
    a = _ev(city="Würzburg")
    b = _ev(city="Würzburg")
    out = dedupe([a, b])
    assert len(out) == 1
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_dedup.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.dedup`)

- [ ] **Step 3: `dedup.py` implementieren**

`ingest/ingest/dedup.py`:
```python
import hashlib
from datetime import datetime
from ingest.models import NormalizedEvent


def compute_content_hash(title: str, starts_at: datetime, city: str | None,
                         location_name: str | None) -> str:
    place = (city or location_name or "online").lower()
    raw = f"{title.lower()}|{starts_at.isoformat()}|{place}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def dedupe(events: list[NormalizedEvent]) -> list[NormalizedEvent]:
    seen_ids: set[tuple[str, str]] = set()
    seen_hashes: set[str] = set()
    out: list[NormalizedEvent] = []
    for e in events:
        if e.external_id is not None:
            key = (e.source, e.external_id)
            if key in seen_ids:
                continue
            seen_ids.add(key)
        else:
            if e.content_hash in seen_hashes:
                continue
        seen_hashes.add(e.content_hash)
        out.append(e)
    return out
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_dedup.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest/ingest/dedup.py ingest/tests/unit/test_dedup.py
git commit -m "feat(ingest): content_hash + In-Batch-Dedup"
```

---

### Task 4: Registry-Loader & initiale sources.yaml

**Files:**
- Create: `ingest/ingest/registry/__init__.py`
- Create: `ingest/ingest/registry/loader.py`
- Create: `ingest/ingest/registry/sources.yaml`
- Test: `ingest/tests/unit/test_registry.py`

**Interfaces:**
- Consumes: `SourceConfig` (Task 2)
- Produces: `load_sources(path: str|None=None, only_active: bool=True) -> list[SourceConfig]`

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_registry.py`:
```python
from ingest.registry.loader import load_sources

def test_loads_only_active(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(
        "sources:\n"
        "  - name: A\n    url: https://a/x.ics\n    type: ical\n    region: Würzburg\n    active: true\n"
        "  - name: B\n    url: https://b\n    type: html\n    region: Schweinfurt\n    active: false\n"
    )
    active = load_sources(str(p), only_active=True)
    assert [s.name for s in active] == ["A"]
    all_ = load_sources(str(p), only_active=False)
    assert len(all_) == 2

def test_default_registry_parses():
    srcs = load_sources(only_active=False)
    assert len(srcs) >= 4
    assert all(s.type in {"ical", "jsonld", "confstech", "html"} for s in srcs)
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_registry.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.registry.loader`)

- [ ] **Step 3: `sources.yaml` schreiben (initiale MVP-Quellen)**

`ingest/ingest/registry/sources.yaml`:
```yaml
sources:
  - name: Schaffenburg e.V.
    url: https://schaffenburg.org/calendar/noopenspace.ics
    type: ical
    region: Aschaffenburg
    organizer: Schaffenburg e.V.
    active: true
  - name: Meetup WUE.tech
    url: https://www.meetup.com/wue-tech/events/ical/
    type: ical
    region: Würzburg
    organizer: WUE.tech
    active: true
  - name: Meetup Modern Software Development Würzburg
    url: https://www.meetup.com/wuerzburg-software-development/events/ical/
    type: ical
    region: Würzburg
    organizer: Modern Software Development
    active: true
  - name: confs.tech (DE)
    url: https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/2026/general.json
    type: confstech
    region: Germany
    active: true
  - name: ZDI Mainfranken
    url: https://www.zdi-mainfranken.de/events/
    type: html
    region: Würzburg
    organizer: ZDI Mainfranken
    active: true
```

- [ ] **Step 4: `loader.py` implementieren**

`ingest/ingest/registry/__init__.py`: leer.
`ingest/ingest/registry/loader.py`:
```python
from pathlib import Path
import yaml
from ingest.models import SourceConfig

_DEFAULT = Path(__file__).parent / "sources.yaml"


def load_sources(path: str | None = None, only_active: bool = True) -> list[SourceConfig]:
    data = yaml.safe_load(Path(path or _DEFAULT).read_text(encoding="utf-8"))
    sources = [SourceConfig(**item) for item in data.get("sources", [])]
    if only_active:
        sources = [s for s in sources if s.active]
    return sources
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_registry.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ingest/ingest/registry ingest/tests/unit/test_registry.py
git commit -m "feat(ingest): Quellen-Registry + Loader (MVP-Quellen)"
```

---

### Task 5: iCal-Connector

**Files:**
- Create: `ingest/ingest/connectors/__init__.py`
- Create: `ingest/ingest/connectors/ical.py`
- Create: `ingest/tests/fixtures/sample.ics`
- Test: `ingest/tests/unit/test_ical.py`

**Interfaces:**
- Consumes: `SourceConfig`, `RawEvent`
- Produces: `parse_ical(ics_text: str, source: SourceConfig) -> list[RawEvent]`

- [ ] **Step 1: Fixture anlegen**

`ingest/tests/fixtures/sample.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-123@schaffenburg.org
SUMMARY:Linux Stammtisch
DTSTART:20260701T180000Z
DTEND:20260701T200000Z
LOCATION:Schaffenburg, Aschaffenburg
URL:https://schaffenburg.org/event/123
DESCRIPTION:Offener Abend
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 2: Failing test schreiben**

`ingest/tests/unit/test_ical.py`:
```python
from pathlib import Path
from ingest.connectors.ical import parse_ical
from ingest.models import SourceConfig

SRC = SourceConfig(name="Schaffenburg", url="https://x/cal.ics", type="ical", region="Aschaffenburg")

def test_parse_ical_basic():
    text = (Path(__file__).parents[1] / "fixtures" / "sample.ics").read_text()
    events = parse_ical(text, SRC)
    assert len(events) == 1
    e = events[0]
    assert e.title == "Linux Stammtisch"
    assert e.external_id == "evt-123@schaffenburg.org"
    assert e.url == "https://schaffenburg.org/event/123"
    assert e.source == "Schaffenburg"
    assert e.starts_at.year == 2026
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_ical.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.connectors.ical`)

- [ ] **Step 4: `ical.py` implementieren**

`ingest/ingest/connectors/__init__.py`: leer.
`ingest/ingest/connectors/ical.py`:
```python
from datetime import date, datetime, time, timezone
from icalendar import Calendar
from ingest.models import RawEvent, SourceConfig


def _to_dt(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    raise ValueError(f"Unsupported DTSTART: {value!r}")


def parse_ical(ics_text: str, source: SourceConfig) -> list[RawEvent]:
    cal = Calendar.from_ical(ics_text)
    out: list[RawEvent] = []
    for comp in cal.walk("VEVENT"):
        if str(comp.get("STATUS", "")).upper() == "CANCELLED":
            continue
        dtstart = comp.get("DTSTART")
        if dtstart is None:
            continue
        dtend = comp.get("DTEND")
        loc = str(comp.get("LOCATION")) if comp.get("LOCATION") else None
        out.append(RawEvent(
            title=str(comp.get("SUMMARY", "")).strip() or "(ohne Titel)",
            starts_at=_to_dt(dtstart.dt),
            ends_at=_to_dt(dtend.dt) if dtend else None,
            description=str(comp.get("DESCRIPTION")) if comp.get("DESCRIPTION") else None,
            location_name=loc,
            url=str(comp.get("URL")) if comp.get("URL") else None,
            organizer=source.organizer,
            source=source.name,
            source_url=source.url,
            external_id=str(comp.get("UID")) if comp.get("UID") else None,
        ))
    return out
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_ical.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ingest/ingest/connectors/ical.py ingest/ingest/connectors/__init__.py ingest/tests/unit/test_ical.py ingest/tests/fixtures/sample.ics
git commit -m "feat(ingest): iCal-Connector"
```

---

### Task 6: confs.tech-Connector

**Files:**
- Create: `ingest/ingest/connectors/confstech.py`
- Create: `ingest/tests/fixtures/confstech.json`
- Test: `ingest/tests/unit/test_confstech.py`

**Interfaces:**
- Consumes: `SourceConfig`, `RawEvent`
- Produces: `parse_confstech(json_text: str, source: SourceConfig) -> list[RawEvent]` — nur Events mit `country == "Germany"`.

- [ ] **Step 1: Fixture anlegen**

`ingest/tests/fixtures/confstech.json`:
```json
[
  {"name":"PyConDE","url":"https://pycon.de","startDate":"2026-04-23","endDate":"2026-04-25","city":"Darmstadt","country":"Germany","online":false},
  {"name":"JSNation","url":"https://jsnation.com","startDate":"2026-06-12","endDate":"2026-06-12","city":"Amsterdam","country":"Netherlands","online":false}
]
```

- [ ] **Step 2: Failing test schreiben**

`ingest/tests/unit/test_confstech.py`:
```python
from pathlib import Path
from ingest.connectors.confstech import parse_confstech
from ingest.models import SourceConfig

SRC = SourceConfig(name="confs.tech", url="https://raw/x.json", type="confstech", region="Germany")

def test_parse_filters_germany():
    text = (Path(__file__).parents[1] / "fixtures" / "confstech.json").read_text()
    events = parse_confstech(text, SRC)
    assert [e.title for e in events] == ["PyConDE"]
    e = events[0]
    assert e.city == "Darmstadt"
    assert e.external_id == "https://pycon.de"
    assert e.starts_at.year == 2026 and e.starts_at.month == 4
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_confstech.py -v`
Expected: FAIL

- [ ] **Step 4: `confstech.py` implementieren**

`ingest/ingest/connectors/confstech.py`:
```python
import json
from datetime import datetime, time, timezone
from ingest.models import RawEvent, SourceConfig


def _parse_date(s: str) -> datetime:
    d = datetime.strptime(s, "%Y-%m-%d").date()
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def parse_confstech(json_text: str, source: SourceConfig) -> list[RawEvent]:
    items = json.loads(json_text)
    out: list[RawEvent] = []
    for it in items:
        if it.get("country") != "Germany":
            continue
        out.append(RawEvent(
            title=it["name"],
            starts_at=_parse_date(it["startDate"]),
            ends_at=_parse_date(it["endDate"]) if it.get("endDate") else None,
            city=it.get("city"),
            url=it.get("url"),
            is_online=bool(it.get("online", False)),
            source=source.name,
            source_url=source.url,
            external_id=it.get("url"),
        ))
    return out
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_confstech.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ingest/ingest/connectors/confstech.py ingest/tests/unit/test_confstech.py ingest/tests/fixtures/confstech.json
git commit -m "feat(ingest): confs.tech-Connector (DE-Filter)"
```

---

### Task 7: JSON-LD-Connector

**Files:**
- Create: `ingest/ingest/connectors/jsonld.py`
- Create: `ingest/tests/fixtures/jsonld_event.html`
- Test: `ingest/tests/unit/test_jsonld.py`

**Interfaces:**
- Consumes: `SourceConfig`, `RawEvent`
- Produces: `parse_jsonld(html_text: str, source: SourceConfig) -> list[RawEvent]` — extrahiert alle `schema.org/Event`-Objekte aus `<script type="application/ld+json">`.

- [ ] **Step 1: Fixture anlegen**

`ingest/tests/fixtures/jsonld_event.html`:
```html
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Event","name":"KI Vortrag",
 "startDate":"2026-07-10T17:00:00+02:00","url":"https://x/ki",
 "location":{"@type":"Place","name":"THWS","address":"Würzburg"}}
</script>
</head><body></body></html>
```

- [ ] **Step 2: Failing test schreiben**

`ingest/tests/unit/test_jsonld.py`:
```python
from pathlib import Path
from ingest.connectors.jsonld import parse_jsonld
from ingest.models import SourceConfig

SRC = SourceConfig(name="THWS", url="https://thws/events", type="jsonld", region="Würzburg")

def test_parse_jsonld_event():
    html = (Path(__file__).parents[1] / "fixtures" / "jsonld_event.html").read_text()
    events = parse_jsonld(html, SRC)
    assert len(events) == 1
    e = events[0]
    assert e.title == "KI Vortrag"
    assert e.location_name == "THWS"
    assert e.starts_at.year == 2026 and e.starts_at.month == 7
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_jsonld.py -v`
Expected: FAIL

- [ ] **Step 4: `jsonld.py` implementieren**

`ingest/ingest/connectors/jsonld.py`:
```python
import json
from datetime import datetime
from bs4 import BeautifulSoup
from ingest.models import RawEvent, SourceConfig


def _iter_events(obj):
    if isinstance(obj, list):
        for x in obj:
            yield from _iter_events(x)
    elif isinstance(obj, dict):
        if obj.get("@graph"):
            yield from _iter_events(obj["@graph"])
        t = obj.get("@type")
        types = t if isinstance(t, list) else [t]
        if "Event" in types or any(str(x).endswith("Event") for x in types if x):
            yield obj


def _loc(obj):
    loc = obj.get("location")
    if isinstance(loc, dict):
        return loc.get("name"), loc.get("address") if isinstance(loc.get("address"), str) else None
    if isinstance(loc, str):
        return loc, None
    return None, None


def parse_jsonld(html_text: str, source: SourceConfig) -> list[RawEvent]:
    soup = BeautifulSoup(html_text, "html.parser")
    out: list[RawEvent] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for ev in _iter_events(data):
            start = ev.get("startDate")
            if not start:
                continue
            name, city = _loc(ev)
            out.append(RawEvent(
                title=ev.get("name", "(ohne Titel)"),
                starts_at=datetime.fromisoformat(start),
                ends_at=datetime.fromisoformat(ev["endDate"]) if ev.get("endDate") else None,
                description=ev.get("description"),
                location_name=name,
                city=city,
                url=ev.get("url"),
                organizer=source.organizer,
                source=source.name,
                source_url=source.url,
                external_id=ev.get("url"),
            ))
    return out
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_jsonld.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ingest/ingest/connectors/jsonld.py ingest/tests/unit/test_jsonld.py ingest/tests/fixtures/jsonld_event.html
git commit -m "feat(ingest): JSON-LD-Connector (schema.org/Event)"
```

---

### Task 8: HTTP-Fetch

**Files:**
- Create: `ingest/ingest/connectors/fetch.py`
- Test: `ingest/tests/unit/test_fetch.py`

**Interfaces:**
- Produces: `async fetch_text(url: str, *, timeout: float = 20.0) -> str` — GET mit User-Agent, gibt Response-Text zurück; wirft bei HTTP-Fehlern.

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_fetch.py`:
```python
import pytest
from ingest.connectors.fetch import fetch_text

@pytest.mark.asyncio
async def test_fetch_text(monkeypatch):
    class FakeResp:
        text = "<html>ok</html>"
        def raise_for_status(self): pass
    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, headers=None): return FakeResp()
    import ingest.connectors.fetch as f
    monkeypatch.setattr(f.httpx, "AsyncClient", FakeClient)
    out = await fetch_text("https://x")
    assert out == "<html>ok</html>"
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_fetch.py -v`
Expected: FAIL

- [ ] **Step 3: `fetch.py` implementieren**

`ingest/ingest/connectors/fetch.py`:
```python
import httpx

_UA = "MainfrankenITEventsBot/0.1 (+https://www.it-mainfranken.org)"


async def fetch_text(url: str, *, timeout: float = 20.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": _UA})
        resp.raise_for_status()
        return resp.text
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_fetch.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest/ingest/connectors/fetch.py ingest/tests/unit/test_fetch.py
git commit -m "feat(ingest): HTTP-Fetch (httpx)"
```

---

### Task 9: HTML-Extractor (LlmAgent) + Aufruf-Helper

**Files:**
- Create: `ingest/ingest/agents/__init__.py`
- Create: `ingest/ingest/agents/extractor.py`
- Create: `ingest/ingest/agents/runner.py`
- Test: `ingest/tests/unit/test_extractor.py`

**Interfaces:**
- Consumes: `RawEvent` (Task 2), `get_model` (Task 1)
- Produces:
  - `build_extractor() -> LlmAgent` — Agent mit `output_schema=ExtractorOutput`.
  - `ExtractorOutput(events: list[RawEvent])` (Pydantic).
  - `async run_structured(agent: LlmAgent, prompt_text: str) -> dict` — führt einen Agent einmalig über `InMemoryRunner` aus und gibt das letzte strukturierte Output-`dict` zurück.

- [ ] **Step 1: Failing test schreiben** (Konfig-Smoke-Test, kein echter LLM-Call)

`ingest/tests/unit/test_extractor.py`:
```python
from ingest.agents.extractor import build_extractor, ExtractorOutput

def test_extractor_is_configured():
    agent = build_extractor()
    assert agent.name == "html_extractor"
    assert agent.output_schema is ExtractorOutput

def test_extractor_output_schema():
    o = ExtractorOutput(events=[])
    assert o.events == []
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_extractor.py -v`
Expected: FAIL

- [ ] **Step 3: `extractor.py` implementieren**

`ingest/ingest/agents/__init__.py`: leer.
`ingest/ingest/agents/extractor.py`:
```python
from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.models import RawEvent
from ingest.config import get_model

INSTRUCTION = """Du extrahierst IT-/Tech-Veranstaltungen aus dem gelieferten Seitentext.
Gib NUR Events zurück, die ein erkennbares Startdatum haben. Erfinde nichts.
Felder, die nicht im Text stehen, lässt du leer. starts_at als ISO-8601.
Setze source und source_url NICHT (macht der Aufrufer)."""


class ExtractorOutput(BaseModel):
    events: list[RawEvent]


def build_extractor() -> LlmAgent:
    return LlmAgent(
        name="html_extractor",
        model=get_model(),
        instruction=INSTRUCTION,
        output_schema=ExtractorOutput,
    )
```

- [ ] **Step 4: `runner.py` implementieren** (Agent-Einmal-Aufruf-Helper)

`ingest/ingest/agents/runner.py`:
```python
from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.runners import InMemoryRunner
from google.genai import types


async def run_structured(agent: LlmAgent, prompt_text: str) -> dict:
    """Führt einen LlmAgent mit output_schema einmalig aus und liefert das
    letzte strukturierte Output-dict (oder {} wenn keins kam)."""
    app = App(name=f"{agent.name}_app", root_agent=agent)
    runner = InMemoryRunner(app=app)
    session = await runner.session_service.create_session(
        app_name=app.name, user_id="ingest"
    )
    result: dict = {}
    async for event in runner.run_async(
        user_id="ingest",
        session_id=session.id,
        new_message=types.Content(role="user", parts=[types.Part.from_text(text=prompt_text)]),
    ):
        if getattr(event, "output", None) is not None and isinstance(event.output, dict):
            result = event.output
    return result
```
> ADK-Referenz: Test-/Runner-Pattern siehe `.agents/skills/google-agents-cli-adk-code/references/adk-workflows.md` §10 und `references/adk-python.md` §1. Falls `event.output` in dieser ADK-Version anders heißt, dort die `Runner`-Event-Felder verifizieren.

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_extractor.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ingest/ingest/agents/ ingest/tests/unit/test_extractor.py
git commit -m "feat(ingest): HTML-Extractor (LlmAgent) + Runner-Helper"
```

---

### Task 10: Tagger/Normalizer (LlmAgent)

**Files:**
- Create: `ingest/ingest/agents/normalizer.py`
- Test: `ingest/tests/unit/test_normalizer.py`

**Interfaces:**
- Consumes: `RawEvent`, `NormalizedEvent`, `compute_content_hash` (Task 3), `build_extractor`-Muster
- Produces:
  - `build_tagger() -> LlmAgent` mit `output_schema=TaggerOutput`.
  - `TaggerOutput(items: list[TaggedItem])`, `TaggedItem(index: int, tags: list[str], is_online: bool)`.
  - `finalize(raw: list[RawEvent], tagged: dict[int, TaggedItem]) -> list[NormalizedEvent]` — verschmilzt Tags, setzt `content_hash`, `review_status`, `is_online`.

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_normalizer.py`:
```python
from datetime import datetime, timezone
from ingest.agents.normalizer import build_tagger, TaggerOutput, TaggedItem, finalize
from ingest.models import RawEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)

def test_tagger_configured():
    agent = build_tagger()
    assert agent.name == "tagger"
    assert agent.output_schema is TaggerOutput

def test_finalize_merges_tags_and_sets_hash():
    raw = [RawEvent(title="Python Meetup", starts_at=DT, source="meetup", city="Würzburg")]
    tagged = {0: TaggedItem(index=0, tags=["python", "meetup"], is_online=False)}
    out = finalize(raw, tagged)
    assert len(out) == 1
    assert out[0].tags == ["python", "meetup"]
    assert out[0].review_status == "auto"
    assert out[0].content_hash  # gesetzt

def test_finalize_marks_needs_review_via_default_status():
    # review_status wird vom Aufrufer (collect) über default_status gesetzt
    raw = [RawEvent(title="X", starts_at=DT, source="zdi")]
    out = finalize(raw, {}, default_status="needs_review")
    assert out[0].review_status == "needs_review"
    assert out[0].tags == []
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_normalizer.py -v`
Expected: FAIL

- [ ] **Step 3: `normalizer.py` implementieren**

`ingest/ingest/agents/normalizer.py`:
```python
from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.models import RawEvent, NormalizedEvent, ReviewStatus
from ingest.dedup import compute_content_hash
from ingest.config import get_model

INSTRUCTION = """Du erhältst eine nummerierte Liste von Events (JSON).
Vergib pro Event 1-5 prägnante, kleingeschriebene Tags (Themen/Technologien,
z.B. 'python', 'ki', 'devops', 'meetup', 'konferenz') und entscheide is_online
(true, wenn Ort/Beschreibung auf online/virtuell/zoom hindeutet).
Gib für jeden index genau ein Ergebnis zurück."""


class TaggedItem(BaseModel):
    index: int
    tags: list[str] = []
    is_online: bool = False


class TaggerOutput(BaseModel):
    items: list[TaggedItem] = []


def build_tagger() -> LlmAgent:
    return LlmAgent(
        name="tagger",
        model=get_model(),
        instruction=INSTRUCTION,
        output_schema=TaggerOutput,
    )


def finalize(raw: list[RawEvent], tagged: dict[int, TaggedItem],
             default_status: ReviewStatus = "auto") -> list[NormalizedEvent]:
    out: list[NormalizedEvent] = []
    for i, e in enumerate(raw):
        t = tagged.get(i)
        is_online = (t.is_online if t else None)
        if is_online is None:
            is_online = bool(e.is_online)
        out.append(NormalizedEvent(
            **e.model_dump(),
            tags=(t.tags if t else []),
            content_hash=compute_content_hash(e.title, e.starts_at, e.city, e.location_name),
            review_status=default_status,
        ))
        out[-1].is_online = is_online
    return out
```
> Hinweis: `NormalizedEvent` erbt `is_online` von `RawEvent` als `bool` mit Default `False`; `e.model_dump()` liefert ggf. `is_online=None` → daher danach explizit setzen.

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_normalizer.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest/ingest/agents/normalizer.py ingest/tests/unit/test_normalizer.py
git commit -m "feat(ingest): Tagger/Normalizer (LlmAgent) + finalize"
```

---

### Task 11: EventSink (Supabase + HTTP)

**Files:**
- Create: `ingest/ingest/sink.py`
- Test: `ingest/tests/unit/test_sink.py`

**Interfaces:**
- Consumes: `NormalizedEvent` (Task 2), `get_settings` (Task 1)
- Produces:
  - `UpsertResult(inserted: int, errors: int)`
  - `class SupabaseSink: def __init__(self, client); def upsert_batch(self, events: list[NormalizedEvent]) -> UpsertResult`
  - `class HttpSink: def __init__(self, url, token=None); def upsert_batch(...) -> UpsertResult`
  - `make_sink() -> SupabaseSink | HttpSink` (wählt nach `settings.sink`)
  - `to_row(e: NormalizedEvent) -> dict` — Mapping auf `events`-Spalten (inkl. `last_seen_at`).

- [ ] **Step 1: Failing test schreiben**

`ingest/tests/unit/test_sink.py`:
```python
from datetime import datetime, timezone
from ingest.sink import SupabaseSink, to_row
from ingest.models import NormalizedEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)

def _ev():
    return NormalizedEvent(title="X", starts_at=DT, source="meetup", external_id="42",
                           is_online=False, content_hash="abc", review_status="auto",
                           tags=["dev"])

def test_to_row_maps_columns():
    row = to_row(_ev())
    assert row["title"] == "X"
    assert row["source"] == "meetup"
    assert row["external_id"] == "42"
    assert row["content_hash"] == "abc"
    assert "last_seen_at" in row
    assert "lat" not in row and "lng" not in row

def test_supabase_sink_upserts():
    calls = {}
    class FakeTable:
        def upsert(self, rows, on_conflict=None):
            calls["rows"] = rows; calls["on_conflict"] = on_conflict; return self
        def execute(self):
            class R: data = calls["rows"]
            return R()
    class FakeClient:
        def table(self, name): calls["table"] = name; return FakeTable()
    res = SupabaseSink(FakeClient()).upsert_batch([_ev()])
    assert res.inserted == 1
    assert calls["table"] == "events"
    assert calls["on_conflict"] == "source,external_id"
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/unit/test_sink.py -v`
Expected: FAIL

- [ ] **Step 3: `sink.py` implementieren**

`ingest/ingest/sink.py`:
```python
from dataclasses import dataclass
from datetime import datetime, timezone
import httpx
from ingest.models import NormalizedEvent
from ingest.config import get_settings


@dataclass
class UpsertResult:
    inserted: int
    errors: int = 0


def to_row(e: NormalizedEvent) -> dict:
    return {
        "title": e.title,
        "description": e.description,
        "starts_at": e.starts_at.isoformat(),
        "ends_at": e.ends_at.isoformat() if e.ends_at else None,
        "location_name": e.location_name,
        "city": e.city,
        "url": e.url,
        "organizer": e.organizer,
        "tags": e.tags,
        "is_free": e.is_free,
        "price": e.price,
        "is_online": e.is_online,
        "source": e.source,
        "source_url": e.source_url,
        "external_id": e.external_id,
        "content_hash": e.content_hash,
        "review_status": e.review_status,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }


class SupabaseSink:
    def __init__(self, client):
        self.client = client

    def upsert_batch(self, events: list[NormalizedEvent]) -> UpsertResult:
        if not events:
            return UpsertResult(0)
        rows = [to_row(e) for e in events]
        res = self.client.table("events").upsert(rows, on_conflict="source,external_id").execute()
        return UpsertResult(inserted=len(res.data or rows))


class HttpSink:
    def __init__(self, url: str, token: str | None = None):
        self.url = url
        self.token = token

    def upsert_batch(self, events: list[NormalizedEvent]) -> UpsertResult:
        if not events:
            return UpsertResult(0)
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        rows = [to_row(e) for e in events]
        resp = httpx.post(self.url, json={"events": rows}, headers=headers, timeout=30)
        resp.raise_for_status()
        return UpsertResult(inserted=len(rows))


def make_sink():
    s = get_settings()
    if s.sink == "http":
        import os
        return HttpSink(os.environ["INGEST_HTTP_URL"], os.environ.get("INGEST_HTTP_TOKEN"))
    from supabase import create_client
    client = create_client(s.supabase_url, s.supabase_service_key)
    return SupabaseSink(client)
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/unit/test_sink.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest/ingest/sink.py ingest/tests/unit/test_sink.py
git commit -m "feat(ingest): EventSink (Supabase + HTTP) + Row-Mapping"
```

---

### Task 12: Supabase-Schema-Migration

**Files:**
- Create: `supabase/migrations/20260625140000_events_ingest_fields.sql`
- Test: manuelle Verifikation über Supabase-MCP (siehe Steps)

**Interfaces:**
- Produces: `events` mit `external_id`, `is_online`, `source_url`, `last_seen_at`, `review_status`; UNIQUE `(source, external_id)`; ohne `lat`,`lng`.

> **Abstimmung mit Teammitglied** (geteilte DB) bevor angewandt. Diese Migration NICHT auf die Live-DB anwenden, ohne dass das Team zugestimmt hat.

- [ ] **Step 1: Migration schreiben**

`supabase/migrations/20260625140000_events_ingest_fields.sql`:
```sql
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
```

- [ ] **Step 2: Aktuelles Schema gegenprüfen**

Über Supabase-MCP `list_tables` (schema `public`, verbose) bestätigen, dass `events` aktuell `lat`,`lng` hat und die neuen Spalten fehlen. Erwartet: passt zum Ausgangszustand.

- [ ] **Step 3: Migration anwenden** (nach Team-OK)

Über Supabase-MCP `apply_migration` mit name `events_ingest_fields` und obigem SQL.

- [ ] **Step 4: Verifizieren**

Über Supabase-MCP `list_tables` (verbose): `external_id`, `is_online`, `source_url`, `last_seen_at`, `review_status` vorhanden, `lat`/`lng` weg. `list_migrations` zeigt `events_ingest_fields`. Über `get_advisors` (security) prüfen, dass keine neuen Warnungen entstanden.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260625140000_events_ingest_fields.sql
git commit -m "feat(db): events um Ingest-Felder erweitern, lat/lng entfernen, unique(source,external_id)"
```

---

### Task 13: Workflow-Verdrahtung & End-to-End-Durchstich

**Files:**
- Create: `ingest/ingest/pipeline.py` (collect-Logik + Dispatch)
- Modify: `ingest/ingest/agent.py` (root_agent = Workflow)
- Create: `ingest/ingest/report.py`
- Test: `ingest/tests/integration/test_pipeline_e2e.py`

**Interfaces:**
- Consumes: alle vorherigen Tasks (`load_sources`, Connectoren, `fetch_text`, `build_extractor`+`run_structured`, `build_tagger`+`finalize`, `dedupe`, `make_sink`).
- Produces:
  - `async collect_from_source(src: SourceConfig) -> tuple[list[RawEvent], str]` — dispatcht nach `src.type`, liefert (RawEvents, default_review_status).
  - `async run_ingest(sink=None, sources=None) -> dict` — kompletter Lauf, gibt Report-dict zurück `{"sources":int,"raw":int,"deduped":int,"written":int,"errors":int}`.
  - `root_agent` — ADK `Workflow`, dessen einziger Node `run_ingest` kapselt (für `agents-cli run`).

- [ ] **Step 1: Failing E2E-Test schreiben** (gemockte Connectoren, gemockter Sink, kein echter LLM)

`ingest/tests/integration/test_pipeline_e2e.py`:
```python
import pytest
from datetime import datetime, timezone
from ingest import pipeline
from ingest.models import SourceConfig, RawEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)

@pytest.mark.asyncio
async def test_run_ingest_happy_path(monkeypatch):
    src = SourceConfig(name="meetup", url="https://x/ical", type="ical", region="Würzburg")

    async def fake_collect(s):
        return [RawEvent(title="Dev Meetup", starts_at=DT, source=s.name, external_id="1",
                         city="Würzburg")], "auto"
    monkeypatch.setattr(pipeline, "collect_from_source", fake_collect)

    # Tagger-Aufruf überspringen → leere Tags
    async def fake_tag(raw):
        return {}
    monkeypatch.setattr(pipeline, "_tag_all", fake_tag)

    written = {}
    class FakeSink:
        def upsert_batch(self, events):
            written["n"] = len(events)
            from ingest.sink import UpsertResult
            return UpsertResult(inserted=len(events))

    report = await pipeline.run_ingest(sink=FakeSink(), sources=[src])
    assert report["written"] == 1
    assert report["deduped"] == 1
    assert written["n"] == 1
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd ingest && pytest tests/integration/test_pipeline_e2e.py -v`
Expected: FAIL (`ModuleNotFoundError: ingest.pipeline`)

- [ ] **Step 3: `report.py` implementieren**

`ingest/ingest/report.py`:
```python
def build_report(sources: int, raw: int, deduped: int, written: int, errors: int) -> dict:
    return {"sources": sources, "raw": raw, "deduped": deduped,
            "written": written, "errors": errors}
```

- [ ] **Step 4: `pipeline.py` implementieren**

`ingest/ingest/pipeline.py`:
```python
import asyncio
import json
from ingest.models import SourceConfig, RawEvent
from ingest.registry.loader import load_sources
from ingest.connectors import ical, confstech, jsonld
from ingest.connectors.fetch import fetch_text
from ingest.agents.extractor import build_extractor
from ingest.agents.normalizer import build_tagger, finalize, TaggedItem, TaggerOutput
from ingest.agents.runner import run_structured
from ingest.dedup import dedupe
from ingest.sink import make_sink
from ingest.report import build_report


async def collect_from_source(src: SourceConfig) -> tuple[list[RawEvent], str]:
    if src.type == "ical":
        return ical.parse_ical(await fetch_text(src.url), src), "auto"
    if src.type == "confstech":
        return confstech.parse_confstech(await fetch_text(src.url), src), "auto"
    if src.type == "jsonld":
        return jsonld.parse_jsonld(await fetch_text(src.url), src), "auto"
    if src.type == "html":
        html = await fetch_text(src.url)
        prompt = f"Quelle: {src.name}\nSeitentext:\n{html[:20000]}"
        out = await run_structured(build_extractor(), prompt)
        events = [RawEvent(**{**ev, "source": src.name, "source_url": src.url})
                  for ev in out.get("events", [])]
        return events, "needs_review"
    return [], "auto"


async def _tag_all(raw: list[RawEvent]) -> dict[int, TaggedItem]:
    if not raw:
        return {}
    payload = [{"index": i, "title": e.title, "location_name": e.location_name,
                "description": (e.description or "")[:300]} for i, e in enumerate(raw)]
    out = await run_structured(build_tagger(), json.dumps(payload, ensure_ascii=False))
    parsed = TaggerOutput(**out) if out else TaggerOutput()
    return {it.index: it for it in parsed.items}


async def run_ingest(sink=None, sources: list[SourceConfig] | None = None) -> dict:
    sources = sources if sources is not None else load_sources(only_active=True)
    sink = sink if sink is not None else make_sink()

    raw: list[RawEvent] = []
    errors = 0
    results = await asyncio.gather(
        *(collect_from_source(s) for s in sources), return_exceptions=True
    )
    status_map: dict[int, str] = {}
    for events_or_exc in results:
        if isinstance(events_or_exc, Exception):
            errors += 1
            continue
        events, status = events_or_exc
        for e in events:
            status_map[len(raw)] = status
            raw.append(e)

    tagged = await _tag_all(raw)
    # finalize pro review_status-Gruppe (Default kommt aus status_map)
    normalized = []
    for i, e in enumerate(raw):
        normalized.extend(finalize([e], {0: tagged[i]} if i in tagged else {},
                                    default_status=status_map.get(i, "auto")))
    deduped = dedupe(normalized)
    res = sink.upsert_batch(deduped)
    return build_report(len(sources), len(raw), len(deduped), res.inserted, errors)
```

- [ ] **Step 5: `agent.py` als Workflow verdrahten**

`ingest/ingest/agent.py` (Inhalt ersetzen):
```python
from google.adk.workflow import Workflow
from ingest.pipeline import run_ingest


async def ingest_node(node_input) -> dict:
    return await run_ingest()


root_agent = Workflow(
    name="mainfranken_ingest",
    edges=[("START", ingest_node)],
)
```
> ADK-Referenz: Workflow-Konstruktor & `edges`-Syntax in `.agents/skills/google-agents-cli-adk-code/references/adk-workflows.md` §1. Falls `agents-cli` ein anderes `root_agent`-Format erwartet, dortige Konvention übernehmen.

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `cd ingest && pytest tests/integration/test_pipeline_e2e.py -v`
Expected: PASS

- [ ] **Step 7: Gesamte Suite grün**

Run: `cd ingest && pytest -v`
Expected: alle Tests PASS

- [ ] **Step 8: Commit**

```bash
git add ingest/ingest/pipeline.py ingest/ingest/agent.py ingest/ingest/report.py ingest/tests/integration/test_pipeline_e2e.py
git commit -m "feat(ingest): Workflow-Verdrahtung + End-to-End-Durchstich"
```

---

### Task 14: Echter Lauf gegen Live-Quellen (manuelle Verifikation)

**Files:** keine (Betrieb)

- [ ] **Step 1: `.env` füllen**

`ingest/.env` aus `.env.example` befüllen: echter `OPENCODE_GO_KEY`, `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SINK=supabase`.

- [ ] **Step 2: Trockenlauf nur Connectoren** (ohne Schreiben)

Run:
```bash
cd ingest && python -c "import asyncio; from ingest.pipeline import collect_from_source; from ingest.registry.loader import load_sources; \
print(asyncio.run(collect_from_source(load_sources(only_active=True)[0])))"
```
Expected: Liste echter `RawEvent`s aus der ersten Quelle (Schaffenburg iCal). Keine Exception.

- [ ] **Step 3: Voller Lauf**

Run:
```bash
cd ingest && python -c "import asyncio; from ingest.pipeline import run_ingest; print(asyncio.run(run_ingest()))"
```
Expected: Report-dict mit `written > 0`, `errors` klein. Bei Fehlern einzelne Quelle deaktivieren (`active: false`) und erneut.

- [ ] **Step 4: In DB prüfen**

Über Supabase-MCP: `select count(*), source from events group by source;` (via `execute_sql`). Erwartet: neue Zeilen pro aktiver Quelle, `review_status` korrekt (`auto` für iCal/confs.tech, `needs_review` für ZDI-HTML).

- [ ] **Step 5: Idempotenz prüfen**

Lauf erneut ausführen (Step 3). Erwartet: `written` ~ gleich, aber **keine** Duplikate in der DB (Upsert auf `(source, external_id)` bzw. `content_hash`).

---

## Self-Review (durchgeführt)

**Spec-Coverage:** D1 Hybrid → Tasks 5-7 (det.) + 9 (LLM) ✔ · D2 Registry → Task 4; Discovery = Stretch (nicht im Plan, bewusst) ✔ · D3 EventSink → Task 11 ✔ · D4 LiteLLM → Task 1 ✔ · D5 zwei LLM-Punkte → Tasks 9+10 ✔ · D6 Dedup → Task 3 ✔ · D7 Graph → Task 13 ✔ · Schema-Änderungen → Task 12 ✔ · Fehlerbehandlung (Quellen-Isolation) → Task 13 `asyncio.gather(return_exceptions=True)` ✔ · Tests → jede Task ✔.

**Stretch bewusst ausgelassen:** Discovery-Agent, Headless-Browser, Fuzzy-Dedup, HttpSink-Live-Umstellung, Cron — als separate spätere Pläne.

**Offene Verifikationspunkte (in den Tasks markiert):** exakte ADK-Runner-Event-Felder (Task 9), `root_agent`-Format für `agents-cli` (Task 13), tatsächlicher Agent-Verzeichnisname nach Scaffold (Task 1). Diese sind als „in der Umsetzung verifizieren" gekennzeichnet, da sie von der konkret installierten `google-adk`-Version abhängen.

**Type-Konsistenz:** `RawEvent`/`NormalizedEvent`/`SourceConfig`-Signaturen identisch über alle Tasks; `compute_content_hash`, `dedupe`, `finalize`, `to_row`, `run_structured`, `collect_from_source`, `run_ingest` überall mit denselben Signaturen referenziert.
