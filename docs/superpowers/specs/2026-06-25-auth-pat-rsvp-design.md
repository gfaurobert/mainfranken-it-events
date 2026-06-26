# Auth, PAT & RSVP — Design

**Date:** 2026-06-25  
**Status:** Approved  
**Builds on:** `docs/superpowers/specs/2026-06-25-mainfranken-it-events-design.md`, find-events API/MCP (done)

## Goal

Let users save events and confirm attendance via their AI agent (Cursor, Claude Code, Codex, etc.). Registration proves email ownership by delivering a Personal Access Token (PAT) **only by email** — never in the agent chat — so knowing someone's address cannot impersonate them.

Find-event tools stay public; RSVP tools require a configured PAT.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Save vs attend | One `rsvps` table: `interested` = saved, `going` = attending |
| PAT delivery | Email only via custom SMTP (nodemailer on API server) |
| PAT lifetime | Long-lived; at most **one active PAT** per user |
| Renew / re-register | Same `register_user` flow; revokes previous active PAT |
| Cancel attendance | Delete RSVP row (no `cancelled` status) |
| Public MCP tools | `search_events`, `get_event`, `register_user` |
| Identity | Supabase Auth `auth.users`; PAT in app `access_tokens` table |

## User journey

```text
1. User tells agent their email.
2. Agent calls register_user({ email }) — no PAT on the connection.
3. API creates/links auth user, generates PAT, stores hash, revokes old PATs.
4. API sends email (nodemailer + SMTP) with PAT and setup instructions.
5. Agent replies: "Check your inbox and add the token to your MCP config."
6. User adds PAT to harness headers: Authorization: Bearer mfe_pat_…
7. Agent can call set_rsvp / list_my_rsvps.
8. Lost PAT → user asks agent to register again → new email, old PAT revoked.
```

## Architecture

```text
┌──────────────┐     public          ┌─────────────────────────────┐
│ MCP harness  │ ─ register_user ──► │ Fastify API + MCP           │
│              │ ◄── { ok, message } │  services/register-user     │
│              │                     │  services/send-pat-email    │
│              │     PAT in header   │    └─ nodemailer → SMTP       │
│              │ ─ set_rsvp ────────►│  middleware/resolve-pat     │
└──────────────┘                     │  services/set-rsvp          │
                                     └──────────┬──────────────────┘
                                                │
                                     ┌──────────▼──────────────────┐
                                     │ Supabase                     │
                                     │  auth.users · profiles       │
                                     │  access_tokens · rsvps       │
                                     └─────────────────────────────┘
```

**Why nodemailer on the API server (not Supabase Edge Function):** The stack is already Node/TypeScript (Fastify). Nodemailer is the standard choice there. Supabase Custom SMTP credentials from the dashboard can be reused as the same `SMTP_*` env values.

## Data model

### `profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | = `auth.users.id` |
| `display_name` | text | nullable; default from email local-part |
| `created_at` | timestamptz | |

Created on first successful registration.

### `access_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK | → `auth.users` |
| `token_hash` | text | bcrypt hash of full token |
| `label` | text | default `"agent"` |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz | null = active |

**Invariant:** One active token per user (`revoked_at IS NULL`). On renew, set `revoked_at = now()` on all active rows for that user before inserting the new hash.

**RLS:** No client access; service role only.

### `rsvps`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | uuid | FK → `auth.users` |
| `event_id` | uuid | FK → `events` |
| `status` | text | `interested` \| `going` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

PK: `(user_id, event_id)`. Upsert on `set_rsvp`. Delete row to remove save/attendance.

**RLS:** User can `SELECT`/`INSERT`/`UPDATE`/`DELETE` own rows only.

### Auth user creation

- Use Supabase Admin API: `auth.admin.createUser({ email, email_confirm: true })` for new users.
- Existing email: look up user by email, skip create, proceed with PAT rotation + email.

## PAT format & validation

- **Format:** `mfe_pat_` + 32 random bytes, base64url-encoded (no padding).
- **Storage:** bcrypt hash only; plaintext exists only in the outgoing email and the user's MCP config.
- **Request:** `Authorization: Bearer mfe_pat_…` on `/mcp` and protected REST routes.
- **Resolution:** Hash incoming token, lookup active row in `access_tokens`, attach `user_id` to request context.
- **Invalid / revoked / missing:** `401` with message suitable for agents ("Request a new token via register_user").

## MCP tools

| Tool | Auth | Input | Output |
|------|------|-------|--------|
| `search_events` | — | (existing) | (existing) |
| `get_event` | — | (existing) | (existing) |
| `register_user` | — | `{ email: string }` | `{ ok: true, message: string }` — never includes PAT |
| `set_rsvp` | PAT | `{ event_id: uuid, status: "interested" \| "going" }` | `{ event_id, status, updated_at }` |
| `list_my_rsvps` | PAT | `{ status?: "interested" \| "going" }` | `{ rsvps: [...] }` with embedded event summary |

**Agent mapping:**

| User says | Tool |
|-----------|------|
| "Save this event" | `set_rsvp(id, "interested")` |
| "I'm going" | `set_rsvp(id, "going")` |
| "Remove / not going" | delete via `set_rsvp` with remove semantics — expose `remove_rsvp({ event_id })` or document delete as `set_rsvp` with a dedicated tool |

**Recommendation:** Add `remove_rsvp({ event_id })` for clarity (thin wrapper around delete).

## REST endpoints (mirror)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/auth/register` | — | Same as `register_user` |
| `GET` | `/me/rsvps` | PAT | List own RSVPs |
| `PUT` | `/me/rsvps/:event_id` | PAT | Body: `{ status }` |
| `DELETE` | `/me/rsvps/:event_id` | PAT | Remove save/attendance |

## Email (nodemailer + custom SMTP)

### Environment variables

Add to `.env` (see `.env.example`):

```bash
# Outbound email — same SMTP you configure in Supabase Auth → SMTP (or any provider)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false          # true for port 465 (implicit TLS)
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Mainfranken IT-Events <noreply@yourdomain.com>"

# Optional
REGISTER_EMAIL_COOLDOWN_SECONDS=300   # per-email rate limit for register_user
```

`loadEnv()` validates required SMTP fields when email sending is enabled (all of `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`; `SMTP_USER`/`SMTP_PASS` optional for local relay).

### Implementation

- **Package:** `nodemailer` (+ `@types/nodemailer` dev).
- **Module:** `src/services/send-pat-email.ts` — accepts `{ to, pat, isRenewal }`, returns void or throws.
- **Transport:** `nodemailer.createTransport({ host, port, secure, auth: { user, pass } })`.
- **Subject:** `Your Mainfranken IT-Events agent token` (renewal variant: `Your new agent token`).
- **Body (plain text):** PAT, one-line MCP header hint, link to docs, note that previous tokens are invalidated on renew.

### Security

- Do not log PAT or full `Authorization` headers.
- Rate-limit `register_user` per email (cooldown env, default 5 minutes).
- Generic agent-facing message even when email fails (log error server-side).
- Constant-time comparison not needed for lookup (hash then DB lookup); use bcrypt.compare for verification.

## MCP auth middleware

1. Parse `Authorization` from incoming `/mcp` HTTP request (same session as existing Streamable HTTP transport).
2. Public tools: skip validation.
3. Protected tools: require valid PAT; inject `userId` into tool handler context.
4. Missing PAT on protected tool: return MCP error / `401` with actionable text.

Harness config example (Cursor):

```json
{
  "mcpServers": {
    "mainfranken-it-events": {
      "url": "http://localhost:3789/mcp",
      "headers": {
        "Authorization": "Bearer mfe_pat_..."
      }
    }
  }
}
```

## Error handling

| Case | HTTP / tool | User/agent message |
|------|-------------|-------------------|
| Invalid email | 400 | Validation error |
| Rate limited | 429 | Try again later |
| SMTP misconfigured / send failed | 500 (logged) | Generic failure; try later |
| Missing/invalid PAT | 401 | Configure PAT or call register_user |
| Unknown event_id | 404 | Event not found |
| Duplicate register (same email, cooldown) | 429 | Wait before requesting again |

## Out of scope (this phase)

- OTP connections, profile editing, web login UI
- PAT time-based expiry (revoke-only lifecycle)
- Multiple concurrent PATs per user
- Supabase Edge Functions for email (nodemailer stays on API server)

## Testing

| Layer | Cases |
|-------|-------|
| Unit | PAT generate/hash/verify; revoke on renew; RSVP upsert/delete; email cooldown |
| Integration | `register_user` response never contains `mfe_pat_`; protected tool 401 without header; 200 with valid PAT |
| Manual | Register → inbox → configure MCP → `set_rsvp` / `list_my_rsvps` / `remove_rsvp` |

Use nodemailer test account or Ethereal for local dev without real SMTP.

## Migration checklist

1. SQL migration: `profiles`, `access_tokens`, `rsvps` + RLS policies.
2. Trigger or app code: create `profiles` row on first registration.
3. Env: SMTP vars in `.env.example` and `loadEnv()`.

## Implementation order (for planning)

1. Schema + RLS migration  
2. `loadEnv` SMTP vars + `send-pat-email` (nodemailer)  
3. `register-user` service + `POST /auth/register` + `register_user` MCP tool  
4. PAT middleware + `access_tokens` lookup  
5. RSVP services + MCP tools + REST `/me/rsvps`  
6. Tests + update `docs/FEATURES.md`
