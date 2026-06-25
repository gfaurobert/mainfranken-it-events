# API + MCP Find Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Node 24 TypeScript service that searches Mainfranken IT events via shared service logic, exposed as Fastify REST (`GET /events`, `GET /events/:id`) and remote MCP tools (`search_events`, `get_event`).

**Architecture:** Monolithic Fastify app. `services/search-events.ts` and `services/get-event.ts` hold all business logic. REST routes and MCP tools are thin adapters calling those services. Supabase service-role client reads the existing `events` table (6 seed rows). MCP uses SDK v2 (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`) with Streamable HTTP on `POST /mcp`.

**Tech Stack:** Node 24, TypeScript, Fastify, Zod v4, `@supabase/supabase-js`, `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, Vitest

**Spec:** `docs/superpowers/specs/2026-06-25-api-mcp-find-events-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `package.json` | deps, scripts, `engines.node >= 24` |
| `tsconfig.json` | strict TS, ESM |
| `vitest.config.ts` | test runner |
| `src/lib/env.ts` | validate env vars at startup |
| `src/lib/supabase.ts` | singleton Supabase admin client |
| `src/types/event.ts` | `Event`, `SearchEventsParams`, response types |
| `src/schemas/search.ts` | shared Zod schemas for REST + MCP |
| `src/services/search-events.ts` | filter builder + Supabase query |
| `src/services/get-event.ts` | fetch single event by id |
| `src/routes/events.ts` | Fastify plugin for REST |
| `src/mcp/tools.ts` | register `search_events` + `get_event` on `McpServer` |
| `src/mcp/server.ts` | Streamable HTTP transport on `/mcp` |
| `src/app.ts` | assemble Fastify + routes + MCP + CORS |
| `src/index.ts` | entrypoint, listen on `PORT` |
| `tests/services/search-events.test.ts` | unit tests (mocked Supabase) |
| `tests/services/get-event.test.ts` | unit tests (mocked Supabase) |
| `tests/routes/events.test.ts` | Fastify `inject()` integration |
| `scripts/smoke-mcp.mjs` | optional manual MCP smoke against running server |

**REST `tags` format (decided):** comma-separated query param — `?tags=python,meetup`

**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (falls back to `SUPABASE_SECRET_KEY` for existing `.env`), `PORT` (default `3000`)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (stub)

- [ ] **Step 1: Initialize package.json**

```bash
cd /home/gregoire/Development/mainfranken-it-events
npm init -y
npm pkg set type=module
npm pkg set engines.node=">=24"
npm pkg set scripts.dev="tsx watch src/index.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/index.js"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

- [ ] **Step 2: Install latest dependencies**

```bash
npm install fastify @fastify/cors @supabase/supabase-js zod \
  @modelcontextprotocol/server @modelcontextprotocol/node
npm install -D typescript tsx vitest @types/node
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create stub entrypoint**

```typescript
// src/index.ts
console.log("mainfranken-it-events: scaffold ok");
```

- [ ] **Step 6: Verify scaffold**

```bash
npx tsc --noEmit
npm test
node src/index.ts
```

Expected: tsc passes (or no src to compile yet — add `npm run build` after more files), vitest reports 0 tests, stub logs message.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/index.ts
git commit -m "chore: scaffold TypeScript Fastify MCP service"
```

---

### Task 2: Types, schemas, and env

**Files:**
- Create: `src/types/event.ts`, `src/schemas/search.ts`, `src/lib/env.ts`, `src/lib/supabase.ts`
- Test: `tests/schemas/search.test.ts`

- [ ] **Step 1: Write failing schema test**

```typescript
// tests/schemas/search.test.ts
import { describe, expect, it } from "vitest";
import { searchEventsQuerySchema } from "../../src/schemas/search.js";

describe("searchEventsQuerySchema", () => {
  it("parses comma-separated tags and applies defaults", () => {
    const result = searchEventsQuerySchema.parse({
      city: "Würzburg",
      tags: "python,meetup",
      limit: "10",
    });
    expect(result.city).toBe("Würzburg");
    expect(result.tags).toEqual(["python", "meetup"]);
    expect(result.limit).toBe(10);
  });

  it("rejects limit above 50", () => {
    expect(() => searchEventsQuerySchema.parse({ limit: "99" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/schemas/search.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement types**

```typescript
// src/types/event.ts
export interface Event {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  city: string | null;
  address: string | null;
  url: string | null;
  organizer: string | null;
  tags: string[];
  is_free: boolean | null;
  price: string | null;
}

export interface SearchEventsParams {
  query?: string;
  date_from?: string;
  date_to?: string;
  city?: string;
  tags?: string[];
  is_free?: boolean;
  limit?: number;
}

export interface SearchEventsResult {
  events: Event[];
  count: number;
}

export interface GetEventResult {
  event: Event;
}
```

- [ ] **Step 4: Implement schemas**

```typescript
// src/schemas/search.ts
import * as z from "zod";

const optionalBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === "true"));

export const searchEventsQuerySchema = z.object({
  query: z.string().min(1).optional(),
  date_from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  date_to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  city: z.string().min(1).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    ),
  is_free: optionalBoolean,
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? 20 : Number(v)))
    .pipe(z.number().int().min(1).max(50)),
});

export const eventIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const PUBLIC_EVENT_COLUMNS =
  "id,title,description,starts_at,ends_at,location_name,city,address,url,organizer,tags,is_free,price" as const;
```

- [ ] **Step 5: Implement env + supabase**

```typescript
// src/lib/env.ts
import * as z from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export function loadEnv() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  return envSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    PORT: process.env.PORT ?? "3000",
  });
}

export type Env = ReturnType<typeof loadEnv>;
```

```typescript
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env.js";

let client: SupabaseClient | undefined;

export function getSupabase(env: Env): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/schemas/search.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types/event.ts src/schemas/search.ts src/lib/env.ts src/lib/supabase.ts tests/schemas/search.test.ts
git commit -m "feat: add event types, Zod schemas, and Supabase client"
```

---

### Task 3: search-events service (TDD)

**Files:**
- Create: `src/services/search-events.ts`
- Test: `tests/services/search-events.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/search-events.test.ts
import { describe, expect, it, vi } from "vitest";
import { searchEvents } from "../../src/services/search-events.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeMockClient(rows: unknown[], error: Error | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    overlaps: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { from, chain } as unknown as { client: SupabaseClient; chain: typeof chain; from: typeof from };
}

describe("searchEvents", () => {
  it("returns mapped events and count", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "KI Stammtisch",
      description: "LLM talk",
      starts_at: "2026-07-15T18:00:00+00:00",
      ends_at: null,
      location_name: "Hub",
      city: "Würzburg",
      address: null,
      url: "https://example.com",
      organizer: "MF IT",
      tags: ["ki"],
      is_free: true,
      price: null,
    };
    const { client, chain } = makeMockClient([row]);
    const result = await searchEvents(client, { city: "Würzburg", limit: 10 });
    expect(result.count).toBe(1);
    expect(result.events[0]?.title).toBe("KI Stammtisch");
    expect(chain.eq).toHaveBeenCalledWith("city", "Würzburg");
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("throws on supabase error", async () => {
    const { client } = makeMockClient([], new Error("db down"));
    await expect(searchEvents(client, {})).rejects.toThrow("db down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/search-events.test.ts
```

Expected: FAIL — `searchEvents` not defined

- [ ] **Step 3: Implement search-events**

```typescript
// src/services/search-events.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_EVENT_COLUMNS } from "../schemas/search.js";
import type { Event, SearchEventsParams, SearchEventsResult } from "../types/event.js";

export async function searchEvents(
  supabase: SupabaseClient,
  params: SearchEventsParams,
): Promise<SearchEventsResult> {
  const limit = params.limit ?? 20;

  let query = supabase
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (params.query) {
    const pattern = `%${params.query}%`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (params.date_from) {
    query = query.gte("starts_at", params.date_from);
  }
  if (params.date_to) {
    query = query.lte("starts_at", params.date_to);
  }
  if (params.city) {
    query = query.ilike("city", params.city);
  }
  if (params.tags?.length) {
    query = query.overlaps("tags", params.tags);
  }
  if (params.is_free !== undefined) {
    query = query.eq("is_free", params.is_free);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const events = (data ?? []) as Event[];
  return { events, count: events.length };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/services/search-events.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/search-events.ts tests/services/search-events.test.ts
git commit -m "feat: add searchEvents service with Supabase filters"
```

---

### Task 4: get-event service (TDD)

**Files:**
- Create: `src/services/get-event.ts`
- Test: `tests/services/get-event.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/get-event.test.ts
import { describe, expect, it, vi } from "vitest";
import { getEvent, EventNotFoundError } from "../../src/services/get-event.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("getEvent", () => {
  it("returns event when found", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "DevOps Day",
      description: null,
      starts_at: "2026-07-22T18:00:00+00:00",
      ends_at: null,
      location_name: null,
      city: "Schweinfurt",
      address: null,
      url: null,
      organizer: null,
      tags: ["devops"],
      is_free: true,
      price: null,
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    const result = await getEvent(client, row.id);
    expect(result.event.title).toBe("DevOps Day");
  });

  it("throws EventNotFoundError when missing", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    await expect(
      getEvent(client, "22222222-2222-2222-2222-222222222222"),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/get-event.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement get-event**

```typescript
// src/services/get-event.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_EVENT_COLUMNS } from "../schemas/search.js";
import type { Event, GetEventResult } from "../types/event.js";

export class EventNotFoundError extends Error {
  constructor(id: string) {
    super(`Event not found: ${id}`);
    this.name = "EventNotFoundError";
  }
}

export async function getEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<GetEventResult> {
  const { data, error } = await supabase
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new EventNotFoundError(id);
  }

  return { event: data as Event };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/services/get-event.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/get-event.ts tests/services/get-event.test.ts
git commit -m "feat: add getEvent service with not-found error"
```

---

### Task 5: Fastify REST routes (TDD)

**Files:**
- Create: `src/routes/events.ts`
- Test: `tests/routes/events.test.ts`

- [ ] **Step 1: Write failing route tests**

```typescript
// tests/routes/events.test.ts
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsRoutes } from "../../src/routes/events.js";
import * as searchModule from "../../src/services/search-events.js";
import * as getModule from "../../src/services/get-event.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("events routes", () => {
  it("GET /events returns search results", async () => {
    vi.spyOn(searchModule, "searchEvents").mockResolvedValue({
      events: [],
      count: 0,
    });

    const app = Fastify();
    await app.register(eventsRoutes, {
      supabase: {} as never,
    });

    const res = await app.inject({ method: "GET", url: "/events?city=Würzburg" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], count: 0 });
    await app.close();
  });

  it("GET /events/:id returns 404 when not found", async () => {
    vi.spyOn(getModule, "getEvent").mockRejectedValue(
      new getModule.EventNotFoundError("22222222-2222-2222-2222-222222222222"),
    );

    const app = Fastify();
    await app.register(eventsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "GET",
      url: "/events/22222222-2222-2222-2222-222222222222",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/routes/events.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement routes**

```typescript
// src/routes/events.ts
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchEventsQuerySchema, eventIdParamSchema } from "../schemas/search.js";
import { searchEvents } from "../services/search-events.js";
import { EventNotFoundError, getEvent } from "../services/get-event.js";

interface EventsRouteOptions {
  supabase: SupabaseClient;
}

export const eventsRoutes: FastifyPluginAsync<EventsRouteOptions> = async (app, opts) => {
  app.get("/events", async (request, reply) => {
    const parsed = searchEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    try {
      const result = await searchEvents(opts.supabase, parsed.data);
      return result;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to search events" });
    }
  });

  app.get("/events/:id", async (request, reply) => {
    const parsed = eventIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid event id",
        details: parsed.error.flatten(),
      });
    }

    try {
      return await getEvent(opts.supabase, parsed.data.id);
    } catch (error) {
      if (error instanceof EventNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch event" });
    }
  });
};
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/routes/events.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/events.ts tests/routes/events.test.ts
git commit -m "feat: add GET /events and GET /events/:id routes"
```

---

### Task 6: MCP tools and Streamable HTTP transport

**Files:**
- Create: `src/mcp/tools.ts`, `src/mcp/server.ts`

- [ ] **Step 1: Implement MCP tool registration**

```typescript
// src/mcp/tools.ts
import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { searchEvents } from "../services/search-events.js";
import { EventNotFoundError, getEvent } from "../services/get-event.js";

const searchInputSchema = z.object({
  query: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  city: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_free: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function registerEventTools(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "search_events",
    {
      title: "Search Mainfranken IT events",
      description:
        "Search upcoming IT events in the Mainfranken region (Würzburg, Aschaffenburg, Schweinfurt, etc.). " +
        "Filter by keywords, city, date range, tags, and free/paid. Returns up to 50 events.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const result = await searchEvents(supabase, input);
      const text =
        result.count === 0
          ? "No events found for the given filters."
          : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event by ID",
      description: "Fetch full details for a single event by UUID.",
      inputSchema: z.object({ id: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const result = await getEvent(supabase, id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        if (error instanceof EventNotFoundError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }
        throw error;
      }
    },
  );
}
```

- [ ] **Step 2: Implement MCP HTTP mount**

```typescript
// src/mcp/server.ts
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerEventTools } from "./tools.js";

export function createMcpServer(supabase: SupabaseClient) {
  const server = new McpServer({
    name: "mainfranken-it-events",
    version: "0.1.0",
  });
  registerEventTools(server, supabase);
  return server;
}

export async function registerMcpRoutes(app: FastifyInstance, supabase: SupabaseClient) {
  const mcpServer = createMcpServer(supabase);
  const transports = new Map<string, NodeStreamableHTTPServerTransport>();

  app.post("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      await mcpServer.connect(transport);
    }

    reply.raw.on("close", () => {
      if (sessionId) {
        transports.delete(sessionId);
      }
      transport?.close();
    });

    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  app.get("/mcp", async (_request, reply) => {
    return reply.status(405).send({ error: "Method not allowed" });
  });

  app.delete("/mcp", async (_request, reply) => {
    return reply.status(405).send({ error: "Method not allowed" });
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: PASS (add `tests/tsconfig` reference or include tests in vitest only — if tsc complains about tests, keep `tsc` scoped to `src/`)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts
git commit -m "feat: add MCP search_events and get_event tools over Streamable HTTP"
```

---

### Task 7: App bootstrap and entrypoint

**Files:**
- Create: `src/app.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement app.ts**

```typescript
// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnv } from "./lib/env.js";
import { getSupabase } from "./lib/supabase.js";
import { eventsRoutes } from "./routes/events.js";
import { registerMcpRoutes } from "./mcp/server.js";

export async function buildApp() {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(eventsRoutes, { supabase });
  await registerMcpRoutes(app, supabase);

  app.get("/health", async () => ({ status: "ok" }));

  return { app, env };
}
```

- [ ] **Step 2: Implement index.ts**

```typescript
// src/index.ts
import { buildApp } from "./app.js";

const { app, env } = await buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 4: Manual REST smoke against live Supabase**

```bash
npm run dev
# separate terminal:
curl -s "http://localhost:3000/events?city=Würzburg" | jq .
curl -s "http://localhost:3000/health" | jq .
```

Expected: JSON with `events` array (≥1 from seed data), health `{ "status": "ok" }`

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/index.ts
git commit -m "feat: wire Fastify app with REST, MCP, and health check"
```

---

### Task 8: MCP smoke script and README

**Files:**
- Create: `scripts/smoke-mcp.mjs`, `README.md`
- Modify: `package.json` (add `smoke:mcp` script)

- [ ] **Step 1: Add smoke script**

```javascript
// scripts/smoke-mcp.mjs
const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const initRes = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    },
  }),
});

if (!initRes.ok) {
  console.error("initialize failed", initRes.status, await initRes.text());
  process.exit(1);
}

const sessionId = initRes.headers.get("mcp-session-id");
console.log("MCP session:", sessionId ?? "(stateless)");
console.log("MCP smoke: initialize OK — connect with your MCP client for tool calls");
```

```bash
npm pkg set scripts.smoke:mcp="node scripts/smoke-mcp.mjs"
```

- [ ] **Step 2: Add README**

Document in `README.md`:
- Prerequisites: Node 24, `.env` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `npm install`, `npm run dev`, `npm test`
- REST examples: `GET /events?city=Würzburg&tags=meetup`
- MCP endpoint: `POST /mcp` (Streamable HTTP)
- Link to design spec

- [ ] **Step 3: Run smoke script with dev server running**

```bash
npm run smoke:mcp
```

Expected: `initialize OK`

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-mcp.mjs README.md package.json
git commit -m "docs: add README and MCP smoke script"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Node 24 + latest packages | Task 1 |
| Shared `searchEvents` / `getEvent` services | Tasks 3–4 |
| `GET /events` with filters | Tasks 2, 3, 5 |
| `GET /events/:id` | Tasks 4, 5 |
| MCP `search_events`, `get_event` | Task 6 |
| Remote Streamable HTTP `/mcp` | Task 6 |
| Public, no auth | all tasks (no auth middleware) |
| Exclude `content_hash`, `source`, `embedding` | `PUBLIC_EVENT_COLUMNS` in Task 2 |
| Error handling 400/404/500 | Tasks 4, 5, 6 |
| CORS on REST | Task 7 |
| Unit + integration tests | Tasks 2–5 |
| MCP smoke test | Task 8 |
| Comma-separated `tags` | Task 2 schema |

**Deferred (not in this plan):** deploy to Fly/Railway, `POST /ingest/events`, auth/RSVP/OTP.

---

## Notes for implementer

- If `zod` v4 import path differs (`zod/v4` vs `zod`), match what `@modelcontextprotocol/server` expects — check node_modules after install.
- Supabase `.or()` filter for `query` may need quoting adjustments; if integration smoke fails, switch to two-step filter or `textSearch` — fix in Task 3 with a live test.
- `ilike` on `city` is case-insensitive in Postgres; pass pattern as plain string (Supabase adds wildcards only when using `ilike` with `%` in value — use `params.city` directly; for partial match use `%${city}%`).
- Keep `node_modules/` and `.env` out of git (already in `.gitignore`).
