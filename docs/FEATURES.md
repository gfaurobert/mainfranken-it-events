# Features

Simple tracker for the Mainfranken IT-Events portal (hackathon scope).

| Feature | Layer | Status | Notes |
|---|---|---|---|
| Find events | REST API (`GET /events`) | **Done** | Filters: `query`, `city`, `tags`, `date_from`, `date_to`, `is_free`, `limit` |
| Get event by ID | REST API (`GET /events/:id`) | **Done** | Single event by UUID |
| Find events | MCP tool (`search_events`) | **Done** | Same filters as REST; remote Streamable HTTP on `POST /mcp` |
| Get event by ID | MCP tool (`get_event`) | **Done** | Same as `GET /events/:id` |
| Health check | REST (`GET /health`) | **Done** | `{ "status": "ok" }` |
| Seed / dummy data | Supabase | **Done** | 6 events in `events` table |
| Auth (human + agent PAT) | MCP + API | **Done** | `register_user` (MCP), `POST /auth/register` (REST); PAT emailed; `Authorization: Bearer mfe_pat_…` |
| RSVP | MCP + API | **Done** | `set_rsvp`, `list_my_rsvps`, `remove_rsvp` (MCP); `GET/PUT/DELETE /me/rsvps` (REST); requires PAT |
| Event ingest | Python ADK → API | Planned | Colleague; `POST /ingest/events` later |
| Connect via OTP | MCP + API | Planned | Needs auth |

**Legend:** Done · Next · Planned
