"""Einmal-Bereinigung der Bestandsdaten in der events-Tabelle.

Wendet dieselbe Logik wie die Ingest-Pipeline auf bereits gespeicherte Events an:

1. Geo-Filter (ingest.geo.classify_region):
   - Online-Events bleiben unangetastet (ortsunabhängig).
   - eindeutig außerhalb Mainfrankens (nicht online) → gelöscht.
   - Ort unklar (nicht online) und review_status='auto' → 'needs_review'.
2. Link-Fallback: url fehlt → mit source_url befüllen.

Default ist ein Dry-Run (zeigt nur, was passieren würde). Mit der
Umgebungsvariable CONFIRM=1 werden die Änderungen tatsächlich geschrieben.

Aufruf (aus dem ingest/-Verzeichnis):
    uv run python scripts/cleanup_geo_and_links.py            # Dry-Run
    CONFIRM=1 uv run python scripts/cleanup_geo_and_links.py  # anwenden
"""
import os
import sys
from pathlib import Path

from ingest.geo import classify_region


def _load_root_env() -> None:
    """Lädt KEY=VALUE-Paare aus der .env im Repo-Root in os.environ."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_PAGE_SIZE = 1000
_COLUMNS = "id,title,city,location_name,is_online,review_status,url,source_url"


def _fetch_all_events(client) -> list[dict]:
    """Liest alle Events seitenweise.

    PostgREST liefert pro Anfrage max. 1000 Zeilen ohne Fehler. Ohne Paginierung
    würde die Bereinigung bei größeren Tabellen still nur die erste Seite
    verarbeiten und einen vollständigen Lauf vortäuschen."""
    rows: list[dict] = []
    page = 0
    while True:
        start = page * _PAGE_SIZE
        chunk = (
            client.table("events")
            .select(_COLUMNS)
            .range(start, start + _PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(chunk)
        if len(chunk) < _PAGE_SIZE:
            return rows
        page += 1


def main() -> int:
    _load_root_env()
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen.", file=sys.stderr)
        return 1

    from supabase import create_client

    client = create_client(url, key)
    rows = _fetch_all_events(client)

    to_delete: list[dict] = []
    to_review: list[dict] = []
    to_fill_url: list[dict] = []

    for r in rows:
        if not r.get("url") and r.get("source_url"):
            to_fill_url.append(r)
        if r.get("is_online"):
            continue
        region = classify_region(r.get("city"), r.get("location_name"))
        if region == "outside":
            to_delete.append(r)
        elif region == "unknown" and r.get("review_status") == "auto":
            to_review.append(r)

    confirm = os.environ.get("CONFIRM") == "1"
    mode = "ANWENDEN" if confirm else "DRY-RUN"
    print(f"=== events-Bereinigung ({mode}) — {len(rows)} Events gesamt ===\n")

    print(f"[1] Löschen (außerhalb Mainfranken, nicht online): {len(to_delete)}")
    for r in to_delete:
        print(f"    - {r.get('city') or r.get('location_name') or '—'}: {(r.get('title') or '')[:60]}")

    print(f"\n[2] → needs_review (Ort unklar, nicht online): {len(to_review)}")
    for r in to_review:
        print(f"    - {(r.get('title') or '')[:70]}")

    print(f"\n[3] url := source_url (Detail-Link fehlt): {len(to_fill_url)}")

    if not confirm:
        print("\nDry-Run – nichts geändert. Mit CONFIRM=1 erneut ausführen.")
        return 0

    for r in to_delete:
        client.table("events").delete().eq("id", r["id"]).execute()
    for r in to_review:
        client.table("events").update({"review_status": "needs_review"}).eq("id", r["id"]).execute()
    for r in to_fill_url:
        client.table("events").update({"url": r["source_url"]}).eq("id", r["id"]).execute()

    print(f"\nFertig: {len(to_delete)} gelöscht, {len(to_review)} auf needs_review, "
          f"{len(to_fill_url)} Links ergänzt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
