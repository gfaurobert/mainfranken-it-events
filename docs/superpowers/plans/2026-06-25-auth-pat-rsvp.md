# Auth, PAT & RSVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent registration (email-delivered PAT), PAT-gated MCP/REST tools for RSVPs, and Supabase schema — while keeping `search_events` / `get_event` public.

**Architecture:** Extend the existing Fastify + MCP monolith in `.worktrees/feat-api-mcp-find-events/`. `services/` holds logic; routes/MCP are thin adapters. Identity in `auth.users`; agent tokens in `access_tokens` (bcrypt + sha256 lookup); RSVPs in `rsvps`. PAT emailed via nodemailer + `SMTP_*` env vars. MCP reads `Authorization: Bearer mfe_pat_…` per HTTP request via `AsyncLocalStorage`.

**Tech Stack:** Node 24, TypeScript, Fastify, Zod v4, `@supabase/supabase-js`, nodemailer, bcryptjs, Vitest

**Spec:** `docs/superpowers/specs/2026-06-25-auth-pat-rsvp-design.md`

**Worktree:** `/home/gregoire/Development/mainfranken-it-events/.worktrees/feat-api-mcp-find-events`

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260625120000_auth_pat_rsvp.sql` | `profiles`, `access_tokens`, `rsvps` + RLS |
| `src/lib/env.ts` | Add SMTP + cooldown env validation |
| `src/lib/auth-context.ts` | `AsyncLocalStorage` for per-request `userId` |
| `src/lib/pat.ts` | Generate PAT, sha256 lookup, bcrypt hash/verify |
| `src/types/rsvp.ts` | `RsvpStatus`, `RsvpWithEvent` types |
| `src/schemas/auth.ts` | Zod: register email, RSVP status |
| `src/services/send-pat-email.ts` | nodemailer transport + plain-text template |
| `src/services/register-user.ts` | create/find auth user, rotate PAT, send email |
| `src/services/resolve-pat.ts` | Bearer → `userId` via `access_tokens` |
| `src/services/set-rsvp.ts` | upsert RSVP |
| `src/services/list-my-rsvps.ts` | list with event summary |
| `src/services/remove-rsvp.ts` | delete RSVP row |
| `src/routes/auth.ts` | `POST /auth/register` |
| `src/routes/me-rsvps.ts` | `GET/PUT/DELETE /me/rsvps` |
| `src/plugins/require-pat.ts` | Fastify `preHandler` for REST PAT auth |
| `src/mcp/auth.ts` | `requireMcpAuth()`, `registerAuthTools()` |
| `src/mcp/tools.ts` | extend with RSVP tools |
| `src/mcp/server.ts` | resolve PAT per request, pass `env` |
| `src/app.ts` | wire new routes + `env` through |
| `tests/lib/pat.test.ts` | PAT crypto unit tests |
| `tests/services/register-user.test.ts` | mocked Supabase + email |
| `tests/services/resolve-pat.test.ts` | token resolution |
| `tests/services/rsvp.test.ts` | set/list/remove |
| `tests/routes/auth.test.ts` | register never leaks PAT |
| `tests/routes/me-rsvps.test.ts` | 401 without PAT, 200 with |
| `docs/FEATURES.md` | mark auth/RSVP done |

**PAT lookup note:** bcrypt is not searchable. Store `token_lookup = sha256(pat)` for indexed lookup, `token_hash = bcrypt(pat)` for verification.

**Public MCP tools:** `search_events`, `get_event`, `register_user`  
**Protected MCP tools:** `set_rsvp`, `list_my_rsvps`, `remove_rsvp`

---

### Task 1: Supabase migration (profiles, access_tokens, rsvps)

**Files:**
- Create: `supabase/migrations/20260625120000_auth_pat_rsvp.sql`

- [ ] **Step 1: Create migration SQL**

```sql
-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  last_pat_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- access_tokens (service role only — no RLS policies for anon/authenticated)
create table if not exists public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_lookup text not null,
  token_hash text not null,
  label text not null default 'agent',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index access_tokens_token_lookup_active_idx
  on public.access_tokens (token_lookup)
  where revoked_at is null;

create index access_tokens_user_id_active_idx
  on public.access_tokens (user_id)
  where revoked_at is null;

alter table public.access_tokens enable row level security;
-- no policies: only service role can read/write

-- rsvps
create table if not exists public.rsvps (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null check (status in ('interested', 'going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.rsvps enable row level security;

create policy "rsvps_select_own"
  on public.rsvps for select
  using (auth.uid() = user_id);

create policy "rsvps_insert_own"
  on public.rsvps for insert
  with check (auth.uid() = user_id);

create policy "rsvps_update_own"
  on public.rsvps for update
  using (auth.uid() = user_id);

create policy "rsvps_delete_own"
  on public.rsvps for delete
  using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run the migration SQL against the project using the Supabase MCP `apply_migration` (or equivalent) tool.

- [ ] **Step 3: Verify tables exist**

```bash
cd /home/gregoire/Development/mainfranken-it-events/.worktrees/feat-api-mcp-find-events
pnpm run check:supabase
```

Expected: existing checks pass; manually confirm `profiles`, `access_tokens`, `rsvps` via Supabase table editor or SQL.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625120000_auth_pat_rsvp.sql
git commit -m "feat(db): add profiles, access_tokens, and rsvps tables"
```

---

### Task 2: Dependencies + env validation

**Files:**
- Modify: `package.json`
- Modify: `src/lib/env.ts`
- Modify: `.env.example` (already has SMTP placeholders in repo root; sync worktree copy)

- [ ] **Step 1: Install dependencies**

```bash
cd /home/gregoire/Development/mainfranken-it-events/.worktrees/feat-api-mcp-find-events
pnpm add nodemailer bcryptjs
pnpm add -D @types/nodemailer @types/bcryptjs
```

- [ ] **Step 2: Write failing env test**

Create `tests/lib/env.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/lib/env.js";

describe("loadEnv", () => {
  it("parses SMTP settings", () => {
    const env = loadEnv({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_FROM: "Test <test@example.com>",
      REGISTER_EMAIL_COOLDOWN_SECONDS: "120",
    });
    expect(env.SMTP_HOST).toBe("smtp.example.com");
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.REGISTER_EMAIL_COOLDOWN_SECONDS).toBe(120);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
pnpm test tests/lib/env.test.ts
```

Expected: FAIL — `loadEnv` does not accept overrides / missing SMTP fields.

- [ ] **Step 4: Update `src/lib/env.ts`**

```typescript
import * as z from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(1),
  REGISTER_EMAIL_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Record<string, string | undefined>) {
  const serviceKey =
    overrides?.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;

  return envSchema.parse({
    SUPABASE_URL: overrides?.SUPABASE_URL ?? process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    PORT: overrides?.PORT ?? process.env.PORT,
    SMTP_HOST: overrides?.SMTP_HOST ?? process.env.SMTP_HOST,
    SMTP_PORT: overrides?.SMTP_PORT ?? process.env.SMTP_PORT,
    SMTP_SECURE: overrides?.SMTP_SECURE ?? process.env.SMTP_SECURE,
    SMTP_USER: overrides?.SMTP_USER ?? process.env.SMTP_USER,
    SMTP_PASS: overrides?.SMTP_PASS ?? process.env.SMTP_PASS,
    SMTP_FROM: overrides?.SMTP_FROM ?? process.env.SMTP_FROM,
    REGISTER_EMAIL_COOLDOWN_SECONDS:
      overrides?.REGISTER_EMAIL_COOLDOWN_SECONDS ??
      process.env.REGISTER_EMAIL_COOLDOWN_SECONDS,
  });
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
pnpm test tests/lib/env.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/env.ts tests/lib/env.test.ts .env.example
git commit -m "feat: validate SMTP env vars for PAT email delivery"
```

---

### Task 3: PAT crypto utilities

**Files:**
- Create: `src/lib/pat.ts`
- Test: `tests/lib/pat.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { generatePat, hashPat, patLookup, verifyPat } from "../../src/lib/pat.js";

describe("pat", () => {
  it("generatePat returns mfe_pat_ prefix", () => {
    const pat = generatePat();
    expect(pat.startsWith("mfe_pat_")).toBe(true);
    expect(pat.length).toBeGreaterThan(20);
  });

  it("patLookup is deterministic", () => {
    const pat = "mfe_pat_testtoken";
    expect(patLookup(pat)).toBe(patLookup(pat));
  });

  it("verifyPat accepts valid pat against hash", async () => {
    const pat = generatePat();
    const hash = await hashPat(pat);
    expect(await verifyPat(pat, hash)).toBe(true);
    expect(await verifyPat(pat + "x", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm test tests/lib/pat.test.ts
```

- [ ] **Step 3: Implement `src/lib/pat.ts`**

```typescript
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PAT_PREFIX = "mfe_pat_";
const BCRYPT_ROUNDS = 10;

export function generatePat(): string {
  return PAT_PREFIX + randomBytes(32).toString("base64url");
}

export function patLookup(pat: string): string {
  return createHash("sha256").update(pat).digest("hex");
}

export function isPatFormat(pat: string): boolean {
  return pat.startsWith(PAT_PREFIX) && pat.length > PAT_PREFIX.length + 10;
}

export async function hashPat(pat: string): Promise<string> {
  return bcrypt.hash(pat, BCRYPT_ROUNDS);
}

export async function verifyPat(pat: string, tokenHash: string): Promise<boolean> {
  return bcrypt.compare(pat, tokenHash);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm test tests/lib/pat.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/pat.ts tests/lib/pat.test.ts
git commit -m "feat: add PAT generate, lookup, and bcrypt helpers"
```

---

### Task 4: Send PAT email (nodemailer)

**Files:**
- Create: `src/services/send-pat-email.ts`
- Test: `tests/services/send-pat-email.test.ts`

- [ ] **Step 1: Write failing test with mock transport**

```typescript
import { describe, expect, it, vi } from "vitest";
import { buildPatEmail, sendPatEmail } from "../../src/services/send-pat-email.js";
import type { Env } from "../../src/lib/env.js";

const env = {
  SMTP_HOST: "smtp.test",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_FROM: "Test <noreply@test.com>",
} as Env;

describe("sendPatEmail", () => {
  it("buildPatEmail includes pat and setup hint", () => {
    const { subject, text } = buildPatEmail({
      pat: "mfe_pat_abc",
      isRenewal: false,
    });
    expect(subject).toContain("agent token");
    expect(text).toContain("mfe_pat_abc");
    expect(text).toContain("Authorization: Bearer");
  });

  it("sendPatEmail calls transport.sendMail", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
    const transport = { sendMail } as never;

    await sendPatEmail(
      transport,
      env,
      { to: "user@example.com", pat: "mfe_pat_xyz", isRenewal: true },
    );

    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0].to).toBe("user@example.com");
    expect(sendMail.mock.calls[0][0].text).toContain("mfe_pat_xyz");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm test tests/services/send-pat-email.test.ts
```

- [ ] **Step 3: Implement `src/services/send-pat-email.ts`**

```typescript
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Env } from "../lib/env.js";

export interface PatEmailInput {
  to: string;
  pat: string;
  isRenewal: boolean;
}

export function createSmtpTransport(env: Env): Transporter {
  const auth =
    env.SMTP_USER && env.SMTP_PASS
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined;

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth,
  });
}

export function buildPatEmail(input: { pat: string; isRenewal: boolean }) {
  const subject = input.isRenewal
    ? "Your new Mainfranken IT-Events agent token"
    : "Your Mainfranken IT-Events agent token";

  const text = [
    "Hello,",
    "",
    "Use this personal access token so your AI agent can save events and confirm attendance:",
    "",
    input.pat,
    "",
    "Add it to your MCP server config:",
    `  Authorization: Bearer ${input.pat}`,
    "",
    input.isRenewal
      ? "Your previous token has been revoked."
      : "Keep this token private. Anyone with it can act as you.",
    "",
    "— Mainfranken IT-Events",
  ].join("\n");

  return { subject, text };
}

export async function sendPatEmail(
  transport: Transporter,
  env: Env,
  input: PatEmailInput,
): Promise<void> {
  const { subject, text } = buildPatEmail({
    pat: input.pat,
    isRenewal: input.isRenewal,
  });

  await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject,
    text,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm test tests/services/send-pat-email.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/send-pat-email.ts tests/services/send-pat-email.test.ts
git commit -m "feat: send PAT delivery email via nodemailer"
```

---

### Task 5: Register user service

**Files:**
- Create: `src/services/register-user.ts`
- Create: `src/schemas/auth.ts`
- Test: `tests/services/register-user.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  registerUser,
  RegisterRateLimitedError,
} from "../../src/services/register-user.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../src/lib/env.js";

const env = { REGISTER_EMAIL_COOLDOWN_SECONDS: 300 } as Env;

describe("registerUser", () => {
  it("returns ok message without pat in response", async () => {
    const sendPatEmail = vi.fn().mockResolvedValue(undefined);
    const authAdmin = {
      createUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "a@b.com" } },
        error: null,
      }),
      listUsers: vi.fn(),
    };
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "access_tokens") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const client = {
      auth: { admin: authAdmin },
      from,
    } as unknown as SupabaseClient;

    const result = await registerUser(client, env, {
      email: "a@b.com",
      sendPatEmail,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("mfe_pat_");
    expect(sendPatEmail).toHaveBeenCalledOnce();
  });

  it("throws RegisterRateLimitedError when cooldown active", async () => {
    const recent = new Date().toISOString();
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "user-1", last_pat_sent_at: recent },
        error: null,
      }),
    }));
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: "user-1", email: "a@b.com" }] },
          }),
        },
      },
      from,
    } as unknown as SupabaseClient;

    await expect(
      registerUser(client, env, {
        email: "a@b.com",
        sendPatEmail: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RegisterRateLimitedError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm test tests/services/register-user.test.ts
```

- [ ] **Step 3: Create `src/schemas/auth.ts`**

```typescript
import * as z from "zod";

export const registerEmailSchema = z.object({
  email: z.string().email(),
});

export const rsvpStatusSchema = z.enum(["interested", "going"]);
```

- [ ] **Step 4: Implement `src/services/register-user.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import { generatePat, hashPat, patLookup } from "../lib/pat.js";
import { sendPatEmail, createSmtpTransport } from "./send-pat-email.js";

export class RegisterRateLimitedError extends Error {
  constructor() {
    super("Please wait before requesting another token");
    this.name = "RegisterRateLimitedError";
  }
}

interface RegisterUserDeps {
  email: string;
  sendPatEmail?: (input: {
    to: string;
    pat: string;
    isRenewal: boolean;
  }) => Promise<void>;
}

export async function registerUser(
  supabase: SupabaseClient,
  env: Env,
  deps: RegisterUserDeps,
) {
  const email = deps.email.trim().toLowerCase();
  const isRenewal = await findExistingUserId(supabase, email);

  if (isRenewal) {
    await assertCooldown(supabase, isRenewal, env.REGISTER_EMAIL_COOLDOWN_SECONDS);
  }

  const userId = isRenewal ?? (await createAuthUser(supabase, email));
  const displayName = email.split("@")[0] ?? email;

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    display_name: displayName,
    last_pat_sent_at: new Date().toISOString(),
  });
  if (profileError) throw profileError;

  await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);

  const pat = generatePat();
  const { error: tokenError } = await supabase.from("access_tokens").insert({
    user_id: userId,
    token_lookup: patLookup(pat),
    token_hash: await hashPat(pat),
    label: "agent",
  });
  if (tokenError) throw tokenError;

  const deliver =
    deps.sendPatEmail ??
    (async (input) => {
      const transport = createSmtpTransport(env);
      await sendPatEmail(transport, env, input);
    });

  await deliver({ to: email, pat, isRenewal: Boolean(isRenewal) });

  return {
    ok: true as const,
    message:
      "If this email address is valid, you will receive an agent token shortly. " +
      "Add it to your MCP config as: Authorization: Bearer <token>",
  };
}

async function findExistingUserId(
  supabase: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  return user?.id ?? null;
}

async function createAuthUser(supabase: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;
  if (!data.user) throw new Error("Failed to create user");
  return data.user.id;
}

async function assertCooldown(
  supabase: SupabaseClient,
  userId: string,
  cooldownSeconds: number,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("last_pat_sent_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.last_pat_sent_at) return;

  const elapsed = Date.now() - new Date(data.last_pat_sent_at).getTime();
  if (elapsed < cooldownSeconds * 1000) {
    throw new RegisterRateLimitedError();
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm test tests/services/register-user.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/schemas/auth.ts src/services/register-user.ts tests/services/register-user.test.ts
git commit -m "feat: register user and rotate PAT via email"
```

---

### Task 6: Resolve PAT + auth context

**Files:**
- Create: `src/lib/auth-context.ts`
- Create: `src/services/resolve-pat.ts`
- Test: `tests/services/resolve-pat.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { resolvePatFromHeader } from "../../src/services/resolve-pat.js";
import { hashPat, patLookup } from "../../src/lib/pat.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("resolvePatFromHeader", () => {
  it("returns userId for valid bearer pat", async () => {
    const pat = "mfe_pat_validtoken1234567890";
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { user_id: "user-1", token_hash: await hashPat(pat) },
        error: null,
      }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    const userId = await resolvePatFromHeader(client, `Bearer ${pat}`);
    expect(userId).toBe("user-1");
    expect(chain.eq).toHaveBeenCalledWith("token_lookup", patLookup(pat));
  });

  it("returns null for missing header", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    expect(await resolvePatFromHeader(client, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm test tests/services/resolve-pat.test.ts
```

- [ ] **Step 3: Implement auth context + resolver**

`src/lib/auth-context.ts`:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthContext {
  userId?: string;
}

export const authContext = new AsyncLocalStorage<AuthContext>();

export function getAuthUserId(): string | undefined {
  return authContext.getStore()?.userId;
}

export function requireAuthUserId(): string {
  const userId = getAuthUserId();
  if (!userId) {
    throw new Error("Authentication required. Call register_user and configure your PAT.");
  }
  return userId;
}
```

`src/services/resolve-pat.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPatFormat, patLookup, verifyPat } from "../lib/pat.js";

export async function resolvePatFromHeader(
  supabase: SupabaseClient,
  authorization: string | undefined,
): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const pat = authorization.slice("Bearer ".length).trim();
  if (!isPatFormat(pat)) return null;

  const { data, error } = await supabase
    .from("access_tokens")
    .select("user_id, token_hash")
    .eq("token_lookup", patLookup(pat))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!(await verifyPat(pat, data.token_hash))) return null;
  return data.user_id;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm test tests/services/resolve-pat.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-context.ts src/services/resolve-pat.ts tests/services/resolve-pat.test.ts
git commit -m "feat: resolve Bearer PAT to user id"
```

---

### Task 7: REST auth + RSVP routes

**Files:**
- Create: `src/plugins/require-pat.ts`
- Create: `src/routes/auth.ts`
- Create: `src/services/set-rsvp.ts`
- Create: `src/services/list-my-rsvps.ts`
- Create: `src/services/remove-rsvp.ts`
- Create: `src/types/rsvp.ts`
- Create: `src/routes/me-rsvps.ts`
- Modify: `src/app.ts`
- Test: `tests/routes/auth.test.ts`, `tests/routes/me-rsvps.test.ts`, `tests/services/rsvp.test.ts`

- [ ] **Step 1: Create `src/types/rsvp.ts`**

```typescript
export type RsvpStatus = "interested" | "going";

export interface RsvpWithEvent {
  event_id: string;
  status: RsvpStatus;
  updated_at: string;
  event: {
    id: string;
    title: string;
    starts_at: string;
    city: string | null;
  };
}
```

- [ ] **Step 2: Implement RSVP services**

`src/services/set-rsvp.ts` — upsert into `rsvps` with service role, filter by `userId` param.

`src/services/list-my-rsvps.ts` — join `events` for summary fields.

`src/services/remove-rsvp.ts` — delete where `user_id` + `event_id`.

Use service-role client but always pass explicit `userId` from resolved PAT (same pattern as existing event services).

Example `set-rsvp.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RsvpStatus } from "../types/rsvp.js";
import { EventNotFoundError, getEvent } from "./get-event.js";

export async function setRsvp(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  status: RsvpStatus,
) {
  await getEvent(supabase, eventId);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("rsvps")
    .upsert(
      { user_id: userId, event_id: eventId, status, updated_at: now },
      { onConflict: "user_id,event_id" },
    )
    .select("event_id, status, updated_at")
    .single();

  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Write RSVP unit tests** in `tests/services/rsvp.test.ts` (mock Supabase chains).

- [ ] **Step 4: Create `src/plugins/require-pat.ts`**

```typescript
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePatFromHeader } from "../services/resolve-pat.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

interface Options {
  supabase: SupabaseClient;
}

export const requirePatPlugin: FastifyPluginAsync<Options> = async (app, opts) => {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await resolvePatFromHeader(
      opts.supabase,
      request.headers.authorization,
    );
    if (!userId) {
      return reply.status(401).send({
        error: "Authentication required",
        message: "Provide Authorization: Bearer <pat> or call POST /auth/register",
      });
    }
    request.userId = userId;
  });
};
```

- [ ] **Step 5: Create routes**

`src/routes/auth.ts` — `POST /auth/register` body `{ email }`, map errors:
- `RegisterRateLimitedError` → 429
- validation → 400
- other → 500 (log, generic message)

`src/routes/me-rsvps.ts` — register with `requirePatPlugin`:
- `GET /me/rsvps?status=`
- `PUT /me/rsvps/:event_id` body `{ status }`
- `DELETE /me/rsvps/:event_id`

- [ ] **Step 6: Wire `src/app.ts`**

```typescript
import { authRoutes } from "./routes/auth.js";
import { meRsvpsRoutes } from "./routes/me-rsvps.js";

// inside buildApp:
await app.register(authRoutes, { supabase, env });
await app.register(meRsvpsRoutes, { supabase, env });
```

Pass `env` into `buildApp` from existing `loadEnv()`.

- [ ] **Step 7: Write route tests**

`tests/routes/auth.test.ts` — inject `POST /auth/register`, mock `registerUser` via fastify decorator or vi.mock on service; assert response has no `mfe_pat_`.

`tests/routes/me-rsvps.test.ts` — `GET /me/rsvps` without header → 401; with valid mocked PAT resolution → 200.

- [ ] **Step 8: Run all tests**

```bash
pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add src/types/rsvp.ts src/services/set-rsvp.ts src/services/list-my-rsvps.ts \
  src/services/remove-rsvp.ts src/plugins/require-pat.ts src/routes/auth.ts \
  src/routes/me-rsvps.ts src/app.ts tests/services/rsvp.test.ts \
  tests/routes/auth.test.ts tests/routes/me-rsvps.test.ts
git commit -m "feat: REST register and PAT-protected RSVP endpoints"
```

---

### Task 8: MCP auth wiring + tools

**Files:**
- Create: `src/mcp/auth.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/app.ts` (pass `env` to MCP)

- [ ] **Step 1: Create `src/mcp/auth.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import { requireAuthUserId } from "../lib/auth-context.js";
import { registerEmailSchema } from "../schemas/auth.js";
import { registerUser, RegisterRateLimitedError } from "../services/register-user.js";
import { setRsvp } from "../services/set-rsvp.js";
import { listMyRsvps } from "../services/list-my-rsvps.js";
import { removeRsvp } from "../services/remove-rsvp.js";
import { rsvpStatusSchema } from "../schemas/auth.js";

function authError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function registerAuthTools(
  server: McpServer,
  supabase: SupabaseClient,
  env: Env,
) {
  server.registerTool(
    "register_user",
    {
      title: "Register for agent access",
      description:
        "Register with your email to receive a personal access token by email. " +
        "Add the token to your MCP config as Authorization: Bearer <token>. " +
        "Does not return the token in this chat.",
      inputSchema: z.object({ email: z.string() }),
      annotations: { readOnlyHint: false },
    },
    async (input) => {
      const parsed = registerEmailSchema.safeParse(input);
      if (!parsed.success) return authError("Invalid email address");

      try {
        const result = await registerUser(supabase, env, { email: parsed.data.email });
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (error) {
        if (error instanceof RegisterRateLimitedError) {
          return authError(error.message);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "set_rsvp",
    {
      title: "Save or confirm event attendance",
      description:
        'Set RSVP status: "interested" to save for later, "going" to confirm attendance. Requires PAT.',
      inputSchema: z.object({
        event_id: z.string().uuid(),
        status: rsvpStatusSchema,
      }),
    },
    async (input) => {
      try {
        const userId = requireAuthUserId();
        const result = await setRsvp(supabase, userId, input.event_id, input.status);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("Authentication required")) {
          return authError(error.message);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "list_my_rsvps",
    {
      title: "List my saved and attending events",
      description: "List your RSVPs. Optional status filter. Requires PAT.",
      inputSchema: z.object({ status: rsvpStatusSchema.optional() }),
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const userId = requireAuthUserId();
        const result = await listMyRsvps(supabase, userId, input.status);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("Authentication required")) {
          return authError(error.message);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "remove_rsvp",
    {
      title: "Remove saved or attending event",
      description: "Remove your RSVP for an event. Requires PAT.",
      inputSchema: z.object({ event_id: z.string().uuid() }),
    },
    async (input) => {
      try {
        const userId = requireAuthUserId();
        await removeRsvp(supabase, userId, input.event_id);
        return {
          content: [{ type: "text", text: "RSVP removed." }],
          structuredContent: { ok: true },
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("Authentication required")) {
          return authError(error.message);
        }
        throw error;
      }
    },
  );
}
```

- [ ] **Step 2: Update `src/mcp/tools.ts`**

Split: keep `registerEventTools` for search/get; call `registerAuthTools` from `createMcpServer`.

- [ ] **Step 3: Update `src/mcp/server.ts`**

Import `authContext` and `resolvePatFromHeader`. Change signatures:

```typescript
export function createMcpServer(supabase: SupabaseClient, env: Env) {
  const server = new McpServer({ name: "mainfranken-it-events", version: "0.2.0" });
  registerEventTools(server, supabase);
  registerAuthTools(server, supabase, env);
  return server;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  supabase: SupabaseClient,
  env: Env,
) {
  // in handleMcpPost, before transport.handleRequest:
  const userId =
    (await resolvePatFromHeader(supabase, request.headers.authorization)) ?? undefined;

  reply.hijack();
  await authContext.run({ userId }, async () => {
    await transport.handleRequest(request.raw, reply.raw, body);
  });
}
```

Apply the same `authContext.run` wrapper in `handleMcpSessionRequest`.

Pass `env` when calling `createMcpServer(supabase, env)`.

- [ ] **Step 4: Update `src/app.ts`**

```typescript
await registerMcpRoutes(app, supabase, env);
```

- [ ] **Step 5: Manual smoke (optional)**

```bash
pnpm dev
# Terminal 2:
curl -s -X POST http://localhost:3789/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
```

Expected: `{ "ok": true, "message": "..." }` with no PAT in JSON. Check inbox.

- [ ] **Step 6: Run tests**

```bash
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add src/mcp/auth.ts src/mcp/tools.ts src/mcp/server.ts src/app.ts
git commit -m "feat: MCP register_user and PAT-gated RSVP tools"
```

---

### Task 9: Docs + FEATURES tracker

**Files:**
- Modify: `docs/FEATURES.md` (repo root and worktree copy if duplicated)
- Modify: `README.md` in worktree (MCP PAT setup snippet)

- [ ] **Step 1: Update FEATURES.md**

| Feature | Status |
|---------|--------|
| Auth (register + PAT email) | **Done** |
| RSVP (save / going / remove) | **Done** |
| Connect via OTP | Planned |

- [ ] **Step 2: Add MCP config example to worktree README**

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

Note: `register_user` works without the header; RSVP tools need it.

- [ ] **Step 3: Commit**

```bash
git add docs/FEATURES.md README.md
git commit -m "docs: document PAT setup and RSVP features"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `profiles` table | Task 1 |
| `access_tokens` + single active PAT | Task 1, 5 |
| `rsvps` interested/going | Task 1, 7 |
| Email via nodemailer + SMTP env | Task 2, 4 |
| PAT never in agent response | Task 5, 7, 8 |
| Renew revokes previous PAT | Task 5 |
| Rate limit register | Task 5 |
| Public find tools | unchanged |
| `register_user` public MCP | Task 8 |
| Protected RSVP MCP tools | Task 8 |
| REST mirror | Task 7 |
| `remove_rsvp` | Task 7, 8 |
| bcrypt + Bearer auth | Task 3, 6 |

## Manual test plan

1. Fill `.env` with Supabase + SMTP credentials.
2. `pnpm dev`
3. Agent calls `register_user` → check email for `mfe_pat_…`
4. Add PAT to MCP headers.
5. `set_rsvp` with `interested`, then `going`, then `list_my_rsvps`, then `remove_rsvp`.
6. Call `register_user` again → old PAT stops working, new email arrives.
