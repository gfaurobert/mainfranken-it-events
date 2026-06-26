import re
from datetime import date, datetime, time, timezone
from icalendar import Calendar
from ingest.models import RawEvent, SourceConfig

# Wiki-basierte Kalender hängen an SUMMARY/UID einen Anker '#_<md5>' an
# (z.B. 'Plenum#_8b71d30c...'). Im Titel ist das Müll; in der UID bleibt er
# (macht die external_id eindeutig).
_ANCHOR_RE = re.compile(r"#_[0-9a-fA-F]{8,}$")


def _clean_title(summary: str) -> str:
    return _ANCHOR_RE.sub("", summary).strip() or "(ohne Titel)"


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
        loc = str(comp.get("LOCATION")).strip() or None if comp.get("LOCATION") else None
        out.append(RawEvent(
            title=_clean_title(str(comp.get("SUMMARY", ""))),
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
