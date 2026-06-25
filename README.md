# Mainfranken IT Events API

Node 24 TypeScript service for searching IT events in the Mainfranken region. Exposes a Fastify REST API and MCP tools over Streamable HTTP, backed by Supabase.

Design spec: [docs/superpowers/specs/2026-06-25-api-mcp-find-events-design.md](../../docs/superpowers/specs/2026-06-25-api-mcp-find-events-design.md)

## Prerequisites

- Node.js **24+**
- **pnpm** 9+ (`corepack enable` if needed)
- Supabase project with the `events` table and seed data

## Setup

```bash
pnpm install
cp ../../.env .env   # or symlink from repo root
```

### Environment variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (or `SUPABASE_SECRET_KEY`) |
| `PORT` | HTTP port (e.g. `3789`; default `3000` if unset) |

## Development

```bash
pnpm dev
pnpm test
pnpm smoke:mcp   # with dev server running
```

## REST API

### Health check

```bash
curl -s "http://localhost:${PORT:-3789}/health"
# { "status": "ok" }
```

### Search events

```bash
curl -s "http://localhost:${PORT:-3789}/events?city=Würzburg"
curl -s "http://localhost:${PORT:-3789}/events?city=Würzburg&tags=meetup"
curl -s "http://localhost:${PORT:-3789}/events?query=kubernetes&is_free=true&limit=10"
```

Query parameters: `query`, `date_from`, `date_to`, `city`, `tags` (comma-separated), `is_free`, `limit` (1–50, default 20).

### Get event by ID

```bash
curl -s "http://localhost:${PORT:-3789}/events/<uuid>"
```

## MCP (Streamable HTTP)

Endpoint: `POST /mcp`

Stateful sessions use the `mcp-session-id` response header on initialize. `GET /mcp` and `DELETE /mcp` return `405 Method Not Allowed`.

Tools:

- `search_events` — same filters as `GET /events`
- `get_event` — fetch a single event by UUID

Smoke test:

```bash
pnpm smoke:mcp
```

Connect your MCP client to `http://localhost:${PORT:-3789}/mcp` using Streamable HTTP transport.
