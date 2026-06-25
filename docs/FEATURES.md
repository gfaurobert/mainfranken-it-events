# Features

Simple tracker for the Mainfranken IT-Events portal (hackathon scope).

| Feature | Layer | Status | Notes |
|---|---|---|---|
| Find events | REST API (`GET /events`) | **Done** | Filters: `query`, `city`, `tags`, `date_from`, `date_to`, `is_free`, `limit` |
| Get event by ID | REST API (`GET /events/:id`) | **Done** | Single event by UUID |
| Find events | MCP tool (`search_events`) | **Next** | Same filters as REST; remote Streamable HTTP on `POST /mcp` |
| Get event by ID | MCP tool (`get_event`) | Planned | Same as `GET /events/:id` |
| Health check | REST (`GET /health`) | **Done** | `{ "status": "ok" }` |
| Seed / dummy data | Supabase | **Done** | 6 events in `events` table |
| Event ingest | Python ADK → API | Planned | Colleague; `POST /ingest/events` later |
| RSVP | MCP + API | Planned | Needs auth |
| Connect via OTP | MCP + API | Planned | Needs auth |
| Auth (human + agent PAT) | MCP + API | Planned | Phase 2 |

**Legend:** Done · Next · Planned
