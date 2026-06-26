"""Connector für die AI Week Mainfranken.

Die Programm-Seite (programm.php) ist eine SPA, die nur den jeweils aktiven Tag
ins DOM rendert – ein HTML-/Headless-Fetch sieht daher nur ~9 von ~40 Events und
ohne Ortsangaben. Die SPA selbst lädt ihre vollständigen Daten aus einem
JSON-Export (`backend.timetable.ai-week.de/export/session.json`). Diesen Export
parsen wir direkt: alle Sessions über alle Tage, deterministisch, mit echten
Orten und stabilen IDs – ohne Browser, ohne LLM."""
import json

from ingest.models import RawEvent, SourceConfig


def parse_aiweek(json_text: str, source: SourceConfig) -> list[RawEvent]:
    data = json.loads(json_text)
    out: list[RawEvent] = []
    for s in data.get("sessions", []):
        # Abgesagte Sessions nicht ingestieren.
        if s.get("cancelled"):
            continue
        title = s.get("title")
        start = s.get("start")
        if not title or not start:
            continue

        loc = s.get("location") or {}
        host = s.get("host") or {}
        # location existiert nur bei Vor-Ort-Events; online-Events haben keins.
        location_name = loc.get("name")
        city = loc.get("city")

        out.append(RawEvent(
            title=title,
            starts_at=start,
            ends_at=s.get("end"),
            description=(s.get("description") or {}).get("short"),
            location_name=location_name,
            city=city,
            url=(s.get("links") or {}).get("event"),
            organizer=host.get("name"),
            is_online=bool(s.get("onlineOnly")),
            source=source.name,
            source_url=source.url,
            external_id=str(s["id"]),
        ))
    return out
