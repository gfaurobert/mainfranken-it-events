from datetime import datetime

from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.config import get_model

INSTRUCTION = """Du extrahierst IT-/Tech-Veranstaltungen aus dem gelieferten Seitentext.
Gib NUR Events zurück, die ein erkennbares Startdatum haben. Erfinde nichts.
Felder, die nicht im Text stehen, lässt du leer (null). starts_at als ISO-8601.
Setze source und source_url NICHT (macht der Aufrufer).

Stabilität (WICHTIG — sonst entstehen beim erneuten Lauf Duplikate):
- Übernimm den Event-Titel WÖRTLICH aus dem Seitentext. Nicht übersetzen,
  nicht kürzen, nicht umformulieren, keine Zusätze.
- Wenn keine Uhrzeit erkennbar ist, setze die Uhrzeit immer auf 00:00.

Datums-Regeln (dir wird das heutige Datum genannt):
- Nennt ein Event nur Tag+Monat OHNE Jahr, wähle das nächste zukünftige Vorkommen
  relativ zum heutigen Datum (also dieses oder nächstes Jahr).
- Der Text kann ein Kalender-Raster sein (Monatsüberschriften wie "Juni 2026",
  danach Tageszahlen und darunter/daneben die Event-Titel des jeweiligen Tages).
  Ordne jeden Event-Titel der passenden Tageszahl + Monatsüberschrift zu.
- Wenn sich ein Datum nicht zweifelsfrei zuordnen lässt, lass das Event weg.

Antworte mit GENAU EINEM JSON-Objekt, ohne Markdown-Codeblock, ohne weiteren Text:
{"events": [
  {"title": "...", "starts_at": "2026-07-01T18:00:00+02:00",
   "ends_at": null, "description": null, "location_name": null,
   "city": null, "url": null, "organizer": null,
   "is_online": null, "is_free": null, "price": null, "external_id": null}
]}
Wenn keine Events erkennbar sind: {"events": []}."""


class ExtractedEvent(BaseModel):
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
    external_id: str | None = None


class ExtractorOutput(BaseModel):
    events: list[ExtractedEvent]


def build_extractor() -> LlmAgent:
    # Kein output_schema: DeepSeek (OpenCode Go) unterstützt response_format
    # mit JSON-Schema nicht. Die Struktur wird per Prompt erzwungen und vom
    # Aufrufer (RawEvent(**...)) validiert.
    return LlmAgent(
        name="html_extractor",
        model=get_model(),
        instruction=INSTRUCTION,
    )
