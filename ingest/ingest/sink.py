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


def make_sink() -> SupabaseSink | HttpSink:
    s = get_settings()
    if s.sink == "http":
        import os
        return HttpSink(os.environ["INGEST_HTTP_URL"], os.environ.get("INGEST_HTTP_TOKEN"))
    from supabase import create_client
    client = create_client(s.supabase_url, s.supabase_service_key)
    return SupabaseSink(client)
