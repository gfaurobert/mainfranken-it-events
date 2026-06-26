# User Connections via OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global user-to-user connections via a 6-digit OTP handshake, then let authenticated users query connected friends' RSVPs (`going` + `interested`) through MCP tools and matching REST routes.

**Architecture:** Extend the existing Fastify + MCP monolith. New `connections` and `connection_otps` tables. Five service modules hold all logic; `src/mcp/connections.ts` and `src/routes/me-connections.ts` are thin adapters. OTP crypto mirrors PAT (`sha256` lookup + `bcrypt` hash). Privacy enforced in services (service-role Supabase client + connection graph checks).

**Tech Stack:** Node 24, TypeScript, Fastify, Zod v4, `@supabase/supabase-js`, bcryptjs, Vitest

**Spec:** `docs/superpowers/specs/2026-06-26-user-connections-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260626120000_user_connections.sql` | `connections`, `connection_otps` tables + indexes |
| `src/lib/connection-otp.ts` | Generate 6-digit code, sha256 lookup, bcrypt hash/verify |
| `src/lib/canonical-connection-pair.ts` | `user_a < user_b` canonical pair + other-user helper |
| `src/types/connection.ts` | Connection, OTP result, list events result types |
| `src/services/connection-errors.ts` | Typed errors for OTP/connection flows |
| `src/services/request-connection-otp.ts` | Issue OTP, invalidate prior, rate limit |
| `src/services/redeem-connection-otp.ts` | Validate OTP, create connection |
| `src/services/list-connections.ts` | List connected users with `display_name` |
| `src/services/list-connection-events.ts` | Name resolve + RSVP/event join with filters |
| `src/services/remove-connection.ts` | Delete canonical connection row |
| `src/mcp/connections.ts` | Register 5 connection MCP tools |
| `src/routes/me-connections.ts` | REST routes under `/me/connections` |
| `src/mcp/server.ts` | Wire `registerConnectionTools` |
| `src/mcp/tools.ts` | Re-export `registerConnectionTools` |
| `src/app.ts` | Register `meConnectionsRoutes` |
| `tests/lib/connection-otp.test.ts` | OTP crypto unit tests |
| `tests/services/connection-otp.test.ts` | request + redeem service tests |
| `tests/services/connections.test.ts` | list, events, remove tests |
| `tests/mcp/connections.test.ts` | MCP tool adapter tests |
| `tests/routes/me-connections.test.ts` | REST integration via `inject()` |
| `docs/FEATURES.md` | Mark connect feature done |
| `SPEC.md` | Align UC-6/7 to global (not per-event) connections |

**Protected MCP tools (new):** `request_connection_otp`, `redeem_connection_otp`, `list_connections`, `list_connection_events`, `remove_connection`

**OTP lookup note:** Same pattern as PAT — `code_lookup = sha256(code)` for indexed DB lookup, `code_hash = bcrypt(code)` for verification.

---

### Task 1: Supabase migration (connections, connection_otps)

**Files:**
- Create: `supabase/migrations/20260626120000_user_connections.sql`

- [ ] **Step 1: Create migration SQL**

```sql
-- connections: undirected link, canonical user_a < user_b
create table if not exists public.connections (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint connections_ordered check (user_a < user_b)
);

create index connections_user_a_idx on public.connections (user_a);
create index connections_user_b_idx on public.connections (user_b);

alter table public.connections enable row level security;
-- no policies: service role only

-- connection_otps: ephemeral 6-digit handshake codes
create table if not exists public.connection_otps (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references auth.users (id) on delete cascade,
  code_lookup text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index connection_otps_code_lookup_active_idx
  on public.connection_otps (code_lookup)
  where used_at is null;

create index connection_otps_issuer_created_idx
  on public.connection_otps (issuer_id, created_at desc);

alter table public.connection_otps enable row level security;
-- no policies: service role only
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `user-supabase` MCP `apply_migration` tool with name `user_connections` and the SQL above.

- [ ] **Step 3: Verify tables**

```bash
cd /home/gregoire/mainfranken-it-events
pnpm run check:supabase
```

Expected: checks pass. Confirm `connections` and `connection_otps` exist via `list_tables` MCP tool.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626120000_user_connections.sql
git commit -m "feat(db): add connections and connection_otps tables"
```

---

### Task 2: OTP crypto helpers + connection types + errors

**Files:**
- Create: `src/lib/connection-otp.ts`
- Create: `src/lib/canonical-connection-pair.ts`
- Create: `src/types/connection.ts`
- Create: `src/services/connection-errors.ts`
- Create: `tests/lib/connection-otp.test.ts`

- [ ] **Step 1: Write failing OTP crypto test**

```typescript
// tests/lib/connection-otp.test.ts
import { describe, expect, it } from "vitest";
import {
  connectionOtpLookup,
  generateConnectionOtpCode,
  hashConnectionOtp,
  verifyConnectionOtp,
} from "../../src/lib/connection-otp.js";

describe("connection-otp", () => {
  it("generates a 6-digit zero-padded code", () => {
    const code = generateConnectionOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("hashes and verifies codes", async () => {
    const code = "482917";
    const hash = await hashConnectionOtp(code);
    expect(connectionOtpLookup(code)).toHaveLength(64);
    expect(await verifyConnectionOtp(code, hash)).toBe(true);
    expect(await verifyConnectionOtp("000000", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/lib/connection-otp.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers and types**

```typescript
// src/lib/connection-otp.ts
import { createHash, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export function generateConnectionOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function connectionOtpLookup(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function hashConnectionOtp(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyConnectionOtp(code: string, codeHash: string): Promise<boolean> {
  return bcrypt.compare(code, codeHash);
}
```

```typescript
// src/lib/canonical-connection-pair.ts
export function canonicalConnectionPair(userIdA: string, userIdB: string) {
  return userIdA < userIdB
    ? { user_a: userIdA, user_b: userIdB }
    : { user_a: userIdB, user_b: userIdA };
}

export function otherConnectionUserId(
  viewerId: string,
  userA: string,
  userB: string,
): string {
  return userA === viewerId ? userB : userA;
}
```

```typescript
// src/types/connection.ts
import type { RsvpStatus } from "./rsvp.js";

export interface ConnectionSummary {
  user_id: string;
  display_name: string | null;
  connected_at: string;
}

export interface RequestConnectionOtpResult {
  code: string;
  expires_at: string;
}

export interface RedeemConnectionOtpResult {
  connection: { user_id: string; display_name: string | null };
  message: string;
}

export interface ConnectionEventItem {
  event: {
    id: string;
    title: string;
    starts_at: string;
    city: string | null;
  };
  attendee: {
    user_id: string;
    display_name: string | null;
    status: RsvpStatus;
  };
}

export interface ListConnectionEventsResult {
  events: ConnectionEventItem[];
  count: number;
  ambiguous?: boolean;
  matches?: Array<{ user_id: string; display_name: string | null }>;
}
```

```typescript
// src/services/connection-errors.ts
export class ConnectionOtpRequestRateLimitedError extends Error {
  constructor() {
    super("Please wait before requesting another connection code");
    this.name = "ConnectionOtpRequestRateLimitedError";
  }
}

export class ConnectionOtpRedeemRateLimitedError extends Error {
  constructor() {
    super("Too many failed code attempts. Please wait a minute and try again.");
    this.name = "ConnectionOtpRedeemRateLimitedError";
  }
}

export class InvalidConnectionOtpError extends Error {
  constructor() {
    super("Code not found or already used.");
    this.name = "InvalidConnectionOtpError";
  }
}

export class ExpiredConnectionOtpError extends Error {
  constructor() {
    super("Code expired. Ask your friend to generate a new one.");
    this.name = "ExpiredConnectionOtpError";
  }
}

export class SelfConnectionError extends Error {
  constructor() {
    super("You cannot connect with yourself.");
    this.name = "SelfConnectionError";
  }
}

export class RedeemOwnOtpError extends Error {
  constructor() {
    super("You cannot redeem your own code.");
    this.name = "RedeemOwnOtpError";
  }
}

export class ConnectionNameNotFoundError extends Error {
  constructor(name: string) {
    super(`No connected user matching '${name}'.`);
    this.name = "ConnectionNameNotFoundError";
  }
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("You are not connected with this user.");
    this.name = "ConnectionNotFoundError";
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm test tests/lib/connection-otp.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/connection-otp.ts src/lib/canonical-connection-pair.ts src/types/connection.ts src/services/connection-errors.ts tests/lib/connection-otp.test.ts
git commit -m "feat: add connection OTP crypto helpers and error types"
```

---

### Task 3: request-connection-otp service

**Files:**
- Create: `src/services/request-connection-otp.ts`
- Create: `tests/services/connection-otp.test.ts` (first tests)

- [ ] **Step 1: Write failing test for OTP issuance**

```typescript
// tests/services/connection-otp.test.ts (append to describe block)
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestConnectionOtp } from "../../src/services/request-connection-otp.js";
import { ConnectionOtpRequestRateLimitedError } from "../../src/services/connection-errors.js";

describe("requestConnectionOtp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a 6-digit code and expiry", async () => {
    const invalidateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null }),
    };
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
    };
    const insertChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "connection_otps") {
          return {
            ...invalidateChain,
            ...countChain,
            ...insertChain,
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await requestConnectionOtp(client, "issuer-1");

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.expires_at).toBeTruthy();
    expect(insertChain.insert).toHaveBeenCalledOnce();
  });

  it("rejects when hourly rate limit exceeded", async () => {
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await expect(requestConnectionOtp(client, "issuer-1")).rejects.toBeInstanceOf(
      ConnectionOtpRequestRateLimitedError,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/services/connection-otp.test.ts
```

- [ ] **Step 3: Implement service**

```typescript
// src/services/request-connection-otp.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectionOtpLookup,
  generateConnectionOtpCode,
  hashConnectionOtp,
} from "../lib/connection-otp.js";
import type { RequestConnectionOtpResult } from "../types/connection.js";
import { ConnectionOtpRequestRateLimitedError } from "./connection-errors.js";

const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_OTPS_PER_HOUR = 5;

export async function requestConnectionOtp(
  supabase: SupabaseClient,
  issuerId: string,
): Promise<RequestConnectionOtpResult> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("connection_otps")
    .select("id", { count: "exact", head: true })
    .eq("issuer_id", issuerId)
    .gte("created_at", oneHourAgo);

  if (countError) throw countError;
  if ((count ?? 0) >= MAX_OTPS_PER_HOUR) {
    throw new ConnectionOtpRequestRateLimitedError();
  }

  const { error: invalidateError } = await supabase
    .from("connection_otps")
    .update({ used_at: new Date().toISOString() })
    .eq("issuer_id", issuerId)
    .is("used_at", null);

  if (invalidateError) throw invalidateError;

  const code = generateConnectionOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { error: insertError } = await supabase.from("connection_otps").insert({
    issuer_id: issuerId,
    code_lookup: connectionOtpLookup(code),
    code_hash: await hashConnectionOtp(code),
    expires_at: expiresAt,
  });

  if (insertError) throw insertError;

  return { code, expires_at: expiresAt };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm test tests/services/connection-otp.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/request-connection-otp.ts tests/services/connection-otp.test.ts
git commit -m "feat: add request-connection-otp service"
```

---

### Task 4: redeem-connection-otp service

**Files:**
- Create: `src/services/redeem-connection-otp.ts`
- Modify: `tests/services/connection-otp.test.ts`

- [ ] **Step 1: Write failing redeem tests**

Add to `tests/services/connection-otp.test.ts`:

```typescript
import { redeemConnectionOtp } from "../../src/services/redeem-connection-otp.js";
import {
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
  SelfConnectionError,
} from "../../src/services/connection-errors.js";
import * as otpLib from "../../src/lib/connection-otp.js";

describe("redeemConnectionOtp", () => {
  it("creates connection and marks OTP used", async () => {
    vi.spyOn(otpLib, "verifyConnectionOtp").mockResolvedValue(true);

    const otpRow = {
      id: "otp-1",
      issuer_id: "user-a",
      code_hash: "hash",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    };

    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: otpRow, error: null }),
    };
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const connectionSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const connectionInsertChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { display_name: "Gregor" },
        error: null,
      }),
    };

    let connectionOtpsCall = 0;
    let connectionsCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === "connection_otps") {
          connectionOtpsCall += 1;
          return connectionOtpsCall === 1 ? selectChain : updateChain;
        }
        if (table === "connections") {
          connectionsCall += 1;
          return connectionsCall === 1 ? connectionSelectChain : connectionInsertChain;
        }
        if (table === "profiles") return profileChain;
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await redeemConnectionOtp(client, "user-b", "482917");

    expect(result.connection.user_id).toBe("user-a");
    expect(result.connection.display_name).toBe("Gregor");
    expect(connectionInsertChain.insert).toHaveBeenCalledOnce();
  });

  it("rejects redeeming own OTP", async () => {
    vi.spyOn(otpLib, "verifyConnectionOtp").mockResolvedValue(true);

    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "otp-1",
          issuer_id: "user-a",
          code_hash: "hash",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          used_at: null,
        },
        error: null,
      }),
    };
    const client = {
      from: vi.fn().mockReturnValue(selectChain),
    } as unknown as SupabaseClient;

    await expect(redeemConnectionOtp(client, "user-a", "482917")).rejects.toBeInstanceOf(
      RedeemOwnOtpError,
    );
  });

  it("rejects invalid code", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(selectChain),
    } as unknown as SupabaseClient;

    await expect(redeemConnectionOtp(client, "user-b", "000000")).rejects.toBeInstanceOf(
      InvalidConnectionOtpError,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/services/connection-otp.test.ts
```

- [ ] **Step 3: Implement redeem service with in-memory failed-attempt tracker**

```typescript
// src/services/redeem-connection-otp.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalConnectionPair } from "../lib/canonical-connection-pair.js";
import { connectionOtpLookup, verifyConnectionOtp } from "../lib/connection-otp.js";
import type { RedeemConnectionOtpResult } from "../types/connection.js";
import {
  ConnectionOtpRedeemRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
  SelfConnectionError,
} from "./connection-errors.js";

const MAX_FAILED_REDEEMS_PER_MINUTE = 5;
const REDEEM_WINDOW_MS = 60_000;

const failedRedeemAttempts = new Map<string, { count: number; windowStart: number }>();

export function resetRedeemRateLimitsForTests() {
  failedRedeemAttempts.clear();
}

function recordFailedRedeem(redeemerId: string) {
  const now = Date.now();
  const entry = failedRedeemAttempts.get(redeemerId);
  if (!entry || now - entry.windowStart > REDEEM_WINDOW_MS) {
    failedRedeemAttempts.set(redeemerId, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
}

function assertRedeemRateLimit(redeemerId: string) {
  const entry = failedRedeemAttempts.get(redeemerId);
  if (entry && Date.now() - entry.windowStart <= REDEEM_WINDOW_MS) {
    if (entry.count >= MAX_FAILED_REDEEMS_PER_MINUTE) {
      throw new ConnectionOtpRedeemRateLimitedError();
    }
  }
}

async function getDisplayName(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.display_name ?? null;
}

export async function redeemConnectionOtp(
  supabase: SupabaseClient,
  redeemerId: string,
  code: string,
): Promise<RedeemConnectionOtpResult> {
  assertRedeemRateLimit(redeemerId);

  const { data: otpRow, error: lookupError } = await supabase
    .from("connection_otps")
    .select("id, issuer_id, code_hash, expires_at, used_at")
    .eq("code_lookup", connectionOtpLookup(code))
    .is("used_at", null)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (!otpRow) {
    recordFailedRedeem(redeemerId);
    throw new InvalidConnectionOtpError();
  }

  if (!(await verifyConnectionOtp(code, otpRow.code_hash))) {
    recordFailedRedeem(redeemerId);
    throw new InvalidConnectionOtpError();
  }

  if (new Date(otpRow.expires_at).getTime() <= Date.now()) {
    recordFailedRedeem(redeemerId);
    throw new ExpiredConnectionOtpError();
  }

  if (otpRow.issuer_id === redeemerId) {
    throw new RedeemOwnOtpError();
  }

  const pair = canonicalConnectionPair(otpRow.issuer_id, redeemerId);

  const { data: existing, error: existingError } = await supabase
    .from("connections")
    .select("user_a, user_b")
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b)
    .maybeSingle();

  if (existingError) throw existingError;

  const issuerDisplayName = await getDisplayName(supabase, otpRow.issuer_id);

  if (!existing) {
    const { error: insertError } = await supabase.from("connections").insert(pair);
    if (insertError) throw insertError;
  }

  const { error: markUsedError } = await supabase
    .from("connection_otps")
    .update({ used_at: new Date().toISOString(), used_by: redeemerId })
    .eq("id", otpRow.id);

  if (markUsedError) throw markUsedError;

  const message = existing
    ? `You're already connected with ${issuerDisplayName ?? "this user"}.`
    : `You're now connected with ${issuerDisplayName ?? "this user"}.`;

  return {
    connection: { user_id: otpRow.issuer_id, display_name: issuerDisplayName },
    message,
  };
}
```

Remove the duplicate `SelfConnectionError` check (redeem own OTP covers it) when implementing.

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm test tests/services/connection-otp.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/redeem-connection-otp.ts tests/services/connection-otp.test.ts
git commit -m "feat: add redeem-connection-otp service"
```

---

### Task 5: list-connections, list-connection-events, remove-connection services

**Files:**
- Create: `src/services/list-connections.ts`
- Create: `src/services/list-connection-events.ts`
- Create: `src/services/remove-connection.ts`
- Create: `tests/services/connections.test.ts`

- [ ] **Step 1: Write failing list/remove tests**

```typescript
// tests/services/connections.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listConnections } from "../../src/services/list-connections.js";
import { listConnectionEvents } from "../../src/services/list-connection-events.js";
import { removeConnection } from "../../src/services/remove-connection.js";
import { ConnectionNameNotFoundError, ConnectionNotFoundError } from "../../src/services/connection-errors.js";

describe("listConnections", () => {
  it("returns connected users with display names", async () => {
    const rows = [
      { user_a: "me", user_b: "friend-1", created_at: "2026-06-26T10:00:00.000Z" },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "friend-1", display_name: "Martin" }],
        error: null,
      }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "connections") return chain;
        if (table === "profiles") return profileChain;
        throw new Error(table);
      }),
    } as unknown as SupabaseClient;

    const result = await listConnections(client, "me");

    expect(result.count).toBe(1);
    expect(result.connections[0]?.display_name).toBe("Martin");
  });
});

describe("listConnectionEvents", () => {
  it("returns ambiguous matches without events", async () => {
    vi.spyOn(
      await import("../../src/services/list-connections.js"),
      "listConnections",
    ).mockResolvedValue({
      connections: [
        { user_id: "u1", display_name: "Martin Müller", connected_at: "t" },
        { user_id: "u2", display_name: "Martin Schmidt", connected_at: "t" },
      ],
      count: 2,
    });

    const client = {} as SupabaseClient;
    const result = await listConnectionEvents(client, "me", { display_name: "Martin" });

    expect(result.ambiguous).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.events).toHaveLength(0);
  });

  it("throws when name not found", async () => {
    vi.spyOn(
      await import("../../src/services/list-connections.js"),
      "listConnections",
    ).mockResolvedValue({
      connections: [{ user_id: "u1", display_name: "Anna", connected_at: "t" }],
      count: 1,
    });

    await expect(
      listConnectionEvents({} as SupabaseClient, "me", { display_name: "Martin" }),
    ).rejects.toBeInstanceOf(ConnectionNameNotFoundError);
  });
});

describe("removeConnection", () => {
  it("deletes canonical connection row", async () => {
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ user_a: "a", user_b: "b" }], error: null }),
    };
    chain.eq = vi
      .fn()
      .mockReturnValueOnce(chain)
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ data: [{ user_a: "a", user_b: "b" }], error: null });

    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await removeConnection(client, "a", "b");
    expect(chain.delete).toHaveBeenCalledOnce();
  });

  it("throws when not connected", async () => {
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    chain.eq = vi.fn().mockReturnValue(chain);

    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await expect(removeConnection(client, "a", "c")).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/services/connections.test.ts
```

- [ ] **Step 3: Implement services**

```typescript
// src/services/list-connections.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { otherConnectionUserId } from "../lib/canonical-connection-pair.js";
import type { ConnectionSummary } from "../types/connection.js";

export interface ListConnectionsResult {
  connections: ConnectionSummary[];
  count: number;
}

export async function listConnections(
  supabase: SupabaseClient,
  userId: string,
): Promise<ListConnectionsResult> {
  const { data: rows, error } = await supabase
    .from("connections")
    .select("user_a, user_b, created_at")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (error) throw error;

  const otherUserIds = (rows ?? []).map((row) =>
    otherConnectionUserId(userId, row.user_a, row.user_b),
  );

  if (otherUserIds.length === 0) {
    return { connections: [], count: 0 };
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", otherUserIds);

  if (profileError) throw profileError;

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const connections: ConnectionSummary[] = (rows ?? []).map((row) => {
    const otherId = otherConnectionUserId(userId, row.user_a, row.user_b);
    return {
      user_id: otherId,
      display_name: profileById.get(otherId) ?? null,
      connected_at: row.created_at,
    };
  });

  return { connections, count: connections.length };
}
```

```typescript
// src/services/list-connection-events.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RsvpStatus } from "../types/rsvp.js";
import type { ConnectionEventItem, ListConnectionEventsResult } from "../types/connection.js";
import { ConnectionNameNotFoundError } from "./connection-errors.js";
import { listConnections } from "./list-connections.js";

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

export interface ListConnectionEventsParams {
  display_name?: string;
  date_from?: string;
  date_to?: string;
  status?: RsvpStatus;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function defaultDateTo() {
  return new Date(Date.now() + SIX_MONTHS_MS).toISOString();
}

export async function listConnectionEvents(
  supabase: SupabaseClient,
  userId: string,
  params: ListConnectionEventsParams = {},
): Promise<ListConnectionEventsResult> {
  const { connections } = await listConnections(supabase, userId);

  let targetConnections = connections;

  if (params.display_name) {
    const needle = normalizeName(params.display_name);
    const matches = connections.filter((c) =>
      (c.display_name ?? "").toLowerCase().includes(needle),
    );

    if (matches.length === 0) {
      throw new ConnectionNameNotFoundError(params.display_name);
    }

    if (matches.length > 1) {
      return {
        events: [],
        count: 0,
        ambiguous: true,
        matches: matches.map((m) => ({
          user_id: m.user_id,
          display_name: m.display_name,
        })),
      };
    }

    targetConnections = matches;
  }

  const targetUserIds = targetConnections.map((c) => c.user_id);
  const displayNameById = new Map(targetConnections.map((c) => [c.user_id, c.display_name]));

  const dateFrom = params.date_from ?? new Date().toISOString();
  const dateTo = params.date_to ?? defaultDateTo();

  let query = supabase
    .from("rsvps")
    .select("user_id, status, event:events(id, title, starts_at, city)")
    .in("user_id", targetUserIds)
    .gte("event.starts_at", dateFrom)
    .lte("event.starts_at", dateTo)
    .order("event.starts_at", { ascending: true });

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const events: ConnectionEventItem[] = (data ?? [])
    .filter((row) => row.event)
    .map((row) => ({
      event: row.event as ConnectionEventItem["event"],
      attendee: {
        user_id: row.user_id,
        display_name: displayNameById.get(row.user_id) ?? null,
        status: row.status as RsvpStatus,
      },
    }));

  return { events, count: events.length };
}
```

```typescript
// src/services/remove-connection.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalConnectionPair } from "../lib/canonical-connection-pair.js";
import { ConnectionNotFoundError } from "./connection-errors.js";

export async function removeConnection(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string,
): Promise<void> {
  const pair = canonicalConnectionPair(userId, otherUserId);

  const { data, error } = await supabase
    .from("connections")
    .delete()
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b)
    .select("user_a");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ConnectionNotFoundError();
  }
}
```

**Note:** Supabase nested filter `.gte("event.starts_at", ...)` may need a two-step query (fetch RSVPs + filter in JS) if the client rejects nested filters. If tests fail against real Supabase, fetch RSVPs with event join then filter `starts_at` in TypeScript.

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test tests/services/connections.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/list-connections.ts src/services/list-connection-events.ts src/services/remove-connection.ts tests/services/connections.test.ts
git commit -m "feat: add connection list, events, and remove services"
```

---

### Task 6: MCP connection tools

**Files:**
- Create: `src/mcp/connections.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Create: `tests/mcp/connections.test.ts`

- [ ] **Step 1: Write failing MCP adapter tests**

Mirror `tests/mcp/auth.test.ts` pattern — mock services, verify auth required, verify userId passed through.

```typescript
// tests/mcp/connections.test.ts
import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../src/lib/auth-context.js";
import { registerConnectionTools } from "../../src/mcp/connections.js";
import * as requestOtpModule from "../../src/services/request-connection-otp.js";
import * as redeemOtpModule from "../../src/services/redeem-connection-otp.js";
import { InvalidConnectionOtpError } from "../../src/services/connection-errors.js";

// ... setupConnectionTools() helper like auth.test.ts ...

describe("mcp connection tools", () => {
  it("request_connection_otp requires auth", async () => {
    const tools = setupConnectionTools();
    const result = await tools.get("request_connection_otp")!({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Authentication required");
  });

  it("redeem_connection_otp maps InvalidConnectionOtpError", async () => {
    vi.spyOn(redeemOtpModule, "redeemConnectionOtp").mockRejectedValue(
      new InvalidConnectionOtpError(),
    );
    const tools = setupConnectionTools();

    await authContext.run({ userId: "user-b" }, async () => {
      const result = await tools.get("redeem_connection_otp")!({ code: "123456" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Code not found");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/mcp/connections.test.ts
```

- [ ] **Step 3: Implement MCP tools**

```typescript
// src/mcp/connections.ts
import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { requireAuthUserId } from "../lib/auth-context.js";
import { rsvpStatusSchema } from "../schemas/auth.js";
import { requestConnectionOtp } from "../services/request-connection-otp.js";
import { redeemConnectionOtp } from "../services/redeem-connection-otp.js";
import { listConnections } from "../services/list-connections.js";
import { listConnectionEvents } from "../services/list-connection-events.js";
import { removeConnection } from "../services/remove-connection.js";
import {
  ConnectionNameNotFoundError,
  ConnectionNotFoundError,
  ConnectionOtpRedeemRateLimitedError,
  ConnectionOtpRequestRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "../services/connection-errors.js";

const redeemOtpInputSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const listConnectionEventsInputSchema = z.object({
  display_name: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  status: rsvpStatusSchema.optional(),
});

const removeConnectionInputSchema = z.object({
  user_id: z.string().uuid(),
});

function authErrorResult(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  if (!error.message.startsWith("Authentication required")) return undefined;
  return {
    content: [{ type: "text" as const, text: error.message }],
    isError: true,
  };
}

function connectionErrorResult(error: unknown) {
  if (
    error instanceof InvalidConnectionOtpError ||
    error instanceof ExpiredConnectionOtpError ||
    error instanceof RedeemOwnOtpError ||
    error instanceof ConnectionNameNotFoundError ||
    error instanceof ConnectionNotFoundError ||
    error instanceof ConnectionOtpRequestRateLimitedError ||
    error instanceof ConnectionOtpRedeemRateLimitedError
  ) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  return undefined;
}

export function registerConnectionTools(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "request_connection_otp",
    {
      title: "Request connection OTP",
      description:
        "Generate a 6-digit code to share with another person so they can connect with you. Code expires in 15 minutes.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const userId = requireAuthUserId();
        const result = await requestConnectionOtp(supabase, userId);
        return {
          content: [
            {
              type: "text",
              text: `Share this code with your friend: ${result.code} (expires ${result.expires_at})`,
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "redeem_connection_otp",
    {
      title: "Redeem connection OTP",
      description: "Connect with another user using their 6-digit code.",
      inputSchema: redeemOtpInputSchema,
    },
    async ({ code }) => {
      try {
        const userId = requireAuthUserId();
        const result = await redeemConnectionOtp(supabase, userId, code);
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "list_connections",
    {
      title: "List my connections",
      description: "List users you are connected with.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const userId = requireAuthUserId();
        const result = await listConnections(supabase, userId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        throw error;
      }
    },
  );

  server.registerTool(
    "list_connection_events",
    {
      title: "List events my connections attend",
      description:
        "List upcoming events your connections marked as going or interested. Filter by friend name, date range, or status.",
      inputSchema: listConnectionEventsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const userId = requireAuthUserId();
        const result = await listConnectionEvents(supabase, userId, input);
        const text = result.ambiguous
          ? `Multiple connections match that name. Ask the user to pick:\n${JSON.stringify(result.matches, null, 2)}`
          : result.count === 0
            ? "No matching events found."
            : JSON.stringify(result, null, 2);
        return {
          content: [{ type: "text", text }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "remove_connection",
    {
      title: "Remove connection",
      description: "Unlink a connected user.",
      inputSchema: removeConnectionInputSchema,
    },
    async ({ user_id }) => {
      try {
        const userId = requireAuthUserId();
        await removeConnection(supabase, userId, user_id);
        return {
          content: [{ type: "text", text: "Connection removed." }],
          structuredContent: { ok: true },
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );
}
```

Wire in `src/mcp/tools.ts`:

```typescript
export { registerConnectionTools } from "./connections.js";
```

Wire in `src/mcp/server.ts` inside `createMcpServer`:

```typescript
import { registerEventTools, registerAuthTools, registerConnectionTools } from "./tools.js";
// ...
registerConnectionTools(server, supabase);
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test tests/mcp/connections.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/connections.ts src/mcp/tools.ts src/mcp/server.ts tests/mcp/connections.test.ts
git commit -m "feat: add MCP connection tools"
```

---

### Task 7: REST routes for connections

**Files:**
- Create: `src/routes/me-connections.ts`
- Modify: `src/app.ts`
- Create: `tests/routes/me-connections.test.ts`

- [ ] **Step 1: Write failing route test**

Follow `tests/routes/me-rsvps.test.ts` pattern with `buildApp()` + `inject()`. Mock services or use test doubles. At minimum:

- `POST /me/connections/otp` → 401 without PAT
- `GET /me/connections` → 401 without PAT
- `POST /me/connections/otp/redeem` with invalid body → 400

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test tests/routes/me-connections.test.ts
```

- [ ] **Step 3: Implement routes**

```typescript
// src/routes/me-connections.ts
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { rsvpStatusSchema } from "../schemas/auth.js";
import { buildRequirePatPreHandler } from "../plugins/require-pat.js";
import { requestConnectionOtp } from "../services/request-connection-otp.js";
import { redeemConnectionOtp } from "../services/redeem-connection-otp.js";
import { listConnections } from "../services/list-connections.js";
import { listConnectionEvents } from "../services/list-connection-events.js";
import { removeConnection } from "../services/remove-connection.js";
import {
  ConnectionNameNotFoundError,
  ConnectionNotFoundError,
  ConnectionOtpRedeemRateLimitedError,
  ConnectionOtpRequestRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "../services/connection-errors.js";

const redeemBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const userIdParamsSchema = z.object({ user_id: z.string().uuid() });
const eventsQuerySchema = z.object({
  display_name: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  status: rsvpStatusSchema.optional(),
});

interface MeConnectionsRouteOptions {
  supabase: SupabaseClient;
}

function mapConnectionError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof InvalidConnectionOtpError) return reply.status(404).send({ error: error.message });
  if (error instanceof ExpiredConnectionOtpError) return reply.status(410).send({ error: error.message });
  if (error instanceof RedeemOwnOtpError) return reply.status(400).send({ error: error.message });
  if (error instanceof ConnectionNameNotFoundError) return reply.status(404).send({ error: error.message });
  if (error instanceof ConnectionNotFoundError) return reply.status(404).send({ error: error.message });
  if (
    error instanceof ConnectionOtpRequestRateLimitedError ||
    error instanceof ConnectionOtpRedeemRateLimitedError
  ) {
    return reply.status(429).send({ error: (error as Error).message });
  }
  return null;
}

export const meConnectionsRoutes: FastifyPluginAsync<MeConnectionsRouteOptions> = async (
  app,
  opts,
) => {
  const requirePat = buildRequirePatPreHandler(opts.supabase);

  app.post("/me/connections/otp", { preHandler: requirePat }, async (request, reply) => {
    try {
      return await requestConnectionOtp(opts.supabase, request.userId!);
    } catch (error) {
      const mapped = mapConnectionError(error, reply);
      if (mapped) return mapped;
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to request connection OTP" });
    }
  });

  app.post(
    "/me/connections/otp/redeem",
    { preHandler: requirePat },
    async (request, reply) => {
      const parsed = redeemBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      try {
        return await redeemConnectionOtp(opts.supabase, request.userId!, parsed.data.code);
      } catch (error) {
        const mapped = mapConnectionError(error, reply);
        if (mapped) return mapped;
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to redeem connection OTP" });
      }
    },
  );

  app.get("/me/connections", { preHandler: requirePat }, async (request, reply) => {
    try {
      return await listConnections(opts.supabase, request.userId!);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to list connections" });
    }
  });

  app.get("/me/connections/events", { preHandler: requirePat }, async (request, reply) => {
    const parsed = eventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }
    try {
      return await listConnectionEvents(opts.supabase, request.userId!, parsed.data);
    } catch (error) {
      const mapped = mapConnectionError(error, reply);
      if (mapped) return mapped;
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to list connection events" });
    }
  });

  app.delete(
    "/me/connections/:user_id",
    { preHandler: requirePat },
    async (request, reply) => {
      const parsed = userIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid user id", details: parsed.error.flatten() });
      }
      try {
        await removeConnection(opts.supabase, request.userId!, parsed.data.user_id);
        return { ok: true };
      } catch (error) {
        const mapped = mapConnectionError(error, reply);
        if (mapped) return mapped;
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to remove connection" });
      }
    },
  );
};
```

Register in `src/app.ts`:

```typescript
import { meConnectionsRoutes } from "./routes/me-connections.js";
// ...
await app.register(meConnectionsRoutes, { supabase });
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test tests/routes/me-connections.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/me-connections.ts src/app.ts tests/routes/me-connections.test.ts
git commit -m "feat: add REST routes for user connections"
```

---

### Task 8: Full test suite + docs

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `SPEC.md` (UC-6/7 global connections)

- [ ] **Step 1: Run full test suite**

```bash
cd /home/gregoire/mainfranken-it-events
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 2: Update FEATURES.md**

Change connect row to **Done** with tool/route names.

- [ ] **Step 3: Update SPEC.md UC-6/7**

Remove per-event OTP scoping. OTP is global; connection is permanent until disconnect.

- [ ] **Step 4: Commit**

```bash
git add docs/FEATURES.md SPEC.md
git commit -m "docs: mark user connections feature complete"
```

---

### Task 9: Manual smoke (optional but recommended)

- [ ] **Step 1: Register two test users, obtain PATs from email**

- [ ] **Step 2: User A — `request_connection_otp` → share code**

- [ ] **Step 3: User B — `redeem_connection_otp` → verify connection**

- [ ] **Step 4: User A sets RSVP on an event; User B queries `list_connection_events({ display_name })`**

- [ ] **Step 5: User B calls `set_rsvp` on same event**

Expected: end-to-end social flow works via MCP or curl with PAT headers.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Global connections | Task 1, 4 |
| 6-digit OTP, 15 min, single-use | Task 2, 3, 4 |
| One active OTP per issuer | Task 3 |
| `going` + `interested` visibility | Task 5 |
| `display_name` lookup + disambiguation | Task 5, 6 |
| Default 6-month date window | Task 5 |
| `remove_connection` either party | Task 5, 6, 7 |
| MCP + REST parity | Task 6, 7 |
| Rate limits | Task 3, 4 |
| Error messages per spec | Task 2, 4, 6, 7 |
| Tests | Tasks 2–7 |
| Docs | Task 8 |
