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
        # The unique index on (source, external_id) is a PARTIAL index
        # (WHERE external_id IS NOT NULL), so it cannot serve as the conflict
        # arbiter for rows where external_id is NULL.  Split the batch:
        # rows WITH external_id  → conflict on source,external_id
        # rows WITHOUT external_id → conflict on content_hash (full UNIQUE)
        with_id = [r for r in rows if r.get("external_id") is not None]
        without_id = [r for r in rows if r.get("external_id") is None]
        inserted = 0
        if with_id:
            res = self.client.table("events").upsert(
                with_id, on_conflict="source,external_id"
            ).execute()
            inserted += len(res.data or with_id)
        if without_id:
            res = self.client.table("events").upsert(
                without_id, on_conflict="content_hash"
            ).execute()
            inserted += len(res.data or without_id)
        return UpsertResult(inserted=inserted)


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
