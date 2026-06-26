from datetime import datetime
from typing import Literal
from pydantic import BaseModel

SourceType = Literal["ical", "jsonld", "confstech", "html", "aiweek"]
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
