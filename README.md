# Mainfranken IT Events API

Node 24 TypeScript service for searching IT events in the Mainfranken region. Exposes a Fastify REST API and MCP tools over Streamable HTTP, backed by Supabase.

Design spec: [docs/superpowers/specs/2026-06-25-api-mcp-find-events-design.md](../../docs/superpowers/specs/2026-06-25-api-mcp-find-events-design.md)

## Prerequisites

- Node.js **24+**
- **pnpm** 9+ (`corepack enable` if needed)
- Supabase project with the `events` table and seed data
- SMTP server for PAT delivery (see `.env.example`)

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
| `SMTP_HOST` | Outbound SMTP host for PAT emails |
| `SMTP_PORT` | SMTP port (e.g. `587`) |
| `SMTP_SECURE` | `true` for TLS on connect, else `false` |
| `SMTP_USER` | SMTP username (optional) |
| `SMTP_PASS` | SMTP password (optional) |
| `SMTP_FROM` | From address, e.g. `"Mainfranken IT-Events <noreply@example.com>"` |
| `REGISTER_EMAIL_COOLDOWN_SECONDS` | Min seconds between PAT re-requests per user (default `300`) |

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

### Register for a PAT (agent auth)

Request a personal access token by email. The token is **never** returned in the API response — it is sent to the inbox only.

```bash
curl -s -X POST "http://localhost:${PORT:-3789}/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Response (always the same, to avoid email enumeration):

```json
{
  "ok": true,
  "message": "If this email address is valid, you will receive an agent token shortly. Add it to your MCP config as: Authorization: Bearer <token>"
}
```

Re-requests for the same email are rate-limited (`429`) until `REGISTER_EMAIL_COOLDOWN_SECONDS` has elapsed. A new PAT revokes the previous one.

### RSVPs (requires PAT)

```bash
export PAT="mfe_pat_…"   # from registration email

curl -s "http://localhost:${PORT:-3789}/me/rsvps" \
  -H "Authorization: Bearer $PAT"

curl -s -X PUT "http://localhost:${PORT:-3789}/me/rsvps/<event-uuid>" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d '{"status":"going"}'

curl -s -X DELETE "http://localhost:${PORT:-3789}/me/rsvps/<event-uuid>" \
  -H "Authorization: Bearer $PAT"
```

Status values: `interested`, `going`.

## MCP (Streamable HTTP)

Endpoint: `POST /mcp`

Stateful sessions use the `mcp-session-id` response header on initialize. `GET /mcp` and `DELETE /mcp` return `405 Method Not Allowed`.

### Tools

**Public (no auth):**

- `search_events` — same filters as `GET /events`
- `get_event` — fetch a single event by UUID
- `register_user` — request a PAT by email (token delivered via email, not in tool output)

**Authenticated (PAT required):**

- `set_rsvp` — set RSVP status for an event
- `list_my_rsvps` — list your RSVPs with event summaries
- `remove_rsvp` — remove an RSVP

### Register flow (MCP)

1. Call `register_user` with your email (no PAT needed):

   ```json
   { "email": "you@example.com" }
   ```

2. Check your inbox for a token starting with `mfe_pat_`.

3. Add the token to your MCP client config (see below).

4. Call authenticated tools (`set_rsvp`, `list_my_rsvps`, `remove_rsvp`).

### MCP client config (PAT)

Add the server to your MCP settings (e.g. Cursor **Settings → MCP** or `~/.cursor/mcp.json`). Send the PAT on every request via the `Authorization` header:

```json
{
  "mcpServers": {
    "mainfranken-it-events": {
      "url": "http://localhost:3789/mcp",
      "headers": {
        "Authorization": "Bearer mfe_pat_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace `3789` with your `PORT` and paste the token from your registration email. You can register first without a token; add the header once you receive the PAT.

Smoke test (public tools only):

```bash
pnpm smoke:mcp
```

Connect your MCP client to `http://localhost:${PORT:-3789}/mcp` using Streamable HTTP transport.
