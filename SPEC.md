# Agent-First Event Portal — Product Specification

## Vision

Build an **agent-first portal for discovering events**. End users interact through their own AI assistants (ChatGPT, Gemini, Claude, etc.) via MCP. Behind the scenes, an internal ingestion agent continuously discovers events from fragmented sources and maintains a canonical events database.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  End-user AI agents (ChatGPT, Gemini, Claude, …)                │
│  "User agents" — conversational interface for humans           │
└────────────────────────────┬────────────────────────────────────┘
                             │ MCP
┌────────────────────────────▼────────────────────────────────────┐
│  Event Portal MCP                                               │
│  Auth · search · RSVP · connect · social graph                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST (or equivalent)
┌────────────────────────────▼────────────────────────────────────┐
│  Events API                                                     │
│  CRUD for events, users, attendance, connections                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Events database                                                │
└────────────────────────────▲────────────────────────────────────┘
                             │ writes
┌────────────────────────────┴────────────────────────────────────┐
│  Ingestion agent (internal)                                     │
│  Web scraping · search · normalization · deduplication          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Actors

| Actor | Role |
|-------|------|
| **Ingestion agent** | Internal system agent. Discovers events from the open web and populates the database. Not exposed to end users. |
| **Events API** | Canonical backend. Standard create/read/update/delete over events and related entities. |
| **Event Portal MCP** | Agent-facing interface. Exposes high-level tools for user agents. |
| **User agent** | The AI assistant the end user talks to (ChatGPT, Gemini, Claude, etc.). Calls the MCP on the user's behalf. |
| **Human user** | The person using a user agent to find events, RSVP, and connect with others. |

---

## Use Cases

### UC-1 — Event ingestion (internal agent)

**Actor:** Ingestion agent

**Goal:** Build and maintain a comprehensive events database despite fragmented sources.

**Description:** An internal agent continuously searches and scrapes the internet for event listings (venue sites, ticketing platforms, meetup pages, social posts, calendars, etc.). It normalizes, deduplicates, and enriches records before writing them to the database.

**Acceptance criteria:**
- New events from external sources appear in the database without manual entry.
- Duplicate events from multiple sources are merged or linked.
- Ingestion runs on a schedule or trigger; failures are logged and retried.

---

### UC-2 — Events API (CRUD)

**Actor:** API consumers (MCP server, admin tools, integrations)

**Goal:** Provide a standard programmatic interface over the events database.

**Description:** A REST-style API supports full CRUD on events: create, read, update, and delete. This is the foundation layer; the MCP and any other clients build on top of it.

**Acceptance criteria:**
- `POST /events` — create an event
- `GET /events` and `GET /events/:id` — list and retrieve
- `PATCH /events/:id` — update
- `DELETE /events/:id` — delete
- Appropriate auth and validation on all endpoints.

---

### UC-3 — Event Portal MCP

**Actor:** User agents

**Goal:** Expose event-portal capabilities as MCP tools so any compatible AI assistant can integrate without custom SDK work.

**Description:** An MCP server sits on top of the Events API and exposes purpose-built tools (search, RSVP, connect, etc.) rather than raw CRUD. User agents discover and invoke these tools during conversation.

**Acceptance criteria:**
- MCP server is deployable and connectable from major AI clients.
- Tools map cleanly to the use cases below (UC-4 through UC-9).
- Errors return actionable messages the user agent can relay to the human.

---

### UC-4 — Find events

**Actor:** User agent (on behalf of human)

**Goal:** Let a user discover events through natural conversation.

**Description:** The user asks their agent something like *"What tech meetups are in Berlin this weekend?"* The agent calls the MCP search tool; results are returned and presented conversationally.

**Acceptance criteria:**
- Search supports filters: location, date range, category, keywords.
- Results include enough detail for the user to decide (title, date, venue, link).
- Pagination or reasonable result limits for agent context windows.

---

### UC-5 — Confirm participation (RSVP)

**Actor:** User agent (on behalf of authenticated human)

**Goal:** Record that a user plans to attend an event.

**Description:** After finding an event, the user says *"I'm going to that one."* The agent calls the MCP to mark the user as attending. This creates or updates an attendance record in the database.

**Acceptance criteria:**
- User must be authenticated (see UC-9).
- Attendance is idempotent (confirming twice does not create duplicates).
- User can also cancel attendance.

---

### UC-6 — Request connect OTP

**Actor:** User agent (on behalf of authenticated human)

**Goal:** Start a connection handshake with another person at the same event.

**Description:** User A is at an event and wants to connect with User B (e.g. Martin). User A tells their agent: *"I want to connect with Martin at this event — give me a code."* The agent requests an OTP via MCP. User A shares that short code with Martin in person (or verbally).

**Acceptance criteria:**
- OTP is short, human-friendly (e.g. 4–6 digits).
- OTP is scoped to a specific event and initiating user.
- OTP expires after a configurable TTL.
- Only one active OTP per initiator per event at a time (or clearly defined override behavior).

---

### UC-7 — Complete connection via OTP

**Actor:** User agent (on behalf of second authenticated human)

**Goal:** Link two users in the database so they are connected.

**Description:** User B (Martin) tells their agent: *"I want to connect with Gregor; the code is 1234."* The agent submits the OTP via MCP. If valid, the system creates a bidirectional connection between Gregor and Martin, typically in the context of the shared event.

**Acceptance criteria:**
- Valid OTP + matching event context links both users.
- Invalid, expired, or wrong-event OTPs are rejected with a clear error.
- Connection is persisted and visible to both users' agents in future queries.
- A user cannot connect to themselves.

---

### UC-8 — Find events attended by connections

**Actor:** User agent (on behalf of authenticated human)

**Goal:** Surface events where friends or connections are already going.

**Description:** The user asks *"Which events are my friends attending this month?"* The agent queries the MCP, which looks up the user's connection graph and cross-references attendance records.

**Acceptance criteria:**
- Returns events where at least one connected user has confirmed attendance (UC-5).
- Respects privacy: only shows attendance for users who are connected to the requester.
- Supports the same filter dimensions as UC-4 (date, location, etc.).

---

### UC-9 — Authenticate user

**Actor:** User agent (on behalf of human)

**Goal:** Establish the identity of the human before any personal or social action.

**Description:** Before RSVP, OTP, or social queries, the user agent must authenticate the human. The MCP provides an auth flow (e.g. OAuth, magic link, or API token exchange) so subsequent tool calls are attributed to the correct user.

**Acceptance criteria:**
- Unauthenticated calls to protected tools are rejected.
- Auth state persists across a conversation session where the MCP client supports it.
- Each authenticated user maps to exactly one record in the users table.

---

## Use Case Summary

| # | Use case | Primary actor | Layer |
|---|----------|---------------|-------|
| 1 | Event ingestion | Ingestion agent | Internal |
| 2 | Events API CRUD | API consumers | API |
| 3 | Event Portal MCP | User agents | MCP |
| 4 | Find events | User agent | MCP |
| 5 | Confirm participation | User agent | MCP |
| 6 | Request connect OTP | User agent | MCP |
| 7 | Complete connection via OTP | User agent | MCP |
| 8 | Events attended by connections | User agent | MCP |
| 9 | Authenticate user | User agent | MCP |

---

## Core Data Entities (initial)

- **Event** — title, description, start/end, location, source URL, external IDs
- **User** — identity from auth provider, display name
- **Attendance** — user ↔ event, status (going, cancelled), timestamps
- **Connection** — user ↔ user, optional event context, created via OTP
- **Connect OTP** — code, initiator, event, expiry, consumed flag

---

## Out of Scope (for now)

- End-user web or mobile UI (agent-only for v1)
- Direct messaging between connected users
- Event recommendations / ML ranking
- Payment or ticketing

---

## Open Questions

1. Auth provider: OAuth (Google/GitHub), magic link, or platform-specific token?
2. OTP delivery: always verbal/in-person, or also support QR/deep link?
3. Connection model: global friendship vs. per-event connection only?
4. Ingestion agent runtime: scheduled job, queue worker, or always-on agent?
5. Event source attribution and takedown policy for scraped content?
