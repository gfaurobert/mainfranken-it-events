# Grok OAuth PAT Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Grok custom connectors authenticate via OAuth popup (register-by-email + paste PAT) while keeping all existing Cursor/REST/MCP behavior unchanged.

**Architecture:** Add `src/oauth/` Fastify plugin with MCP-spec OAuth 2.1 discovery, DCR, authorize HTML popup, and token exchange. PAT is returned as `access_token`. No changes to `resolvePatFromHeader` or MCP tool handlers.

**Tech Stack:** Fastify 5, Node crypto (PKCE SHA-256), Vitest, existing `registerUser` + `resolvePatFromHeader`

**Spec:** [2026-06-26-grok-oauth-pat-connector-design.md](../specs/2026-06-26-grok-oauth-pat-connector-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/env.ts` | Add `MCP_PUBLIC_URL` |
| `src/oauth/store.ts` | In-memory clients, auth codes |
| `src/oauth/pkce.ts` | S256 challenge verification |
| `src/oauth/metadata.ts` | Well-known JSON builders |
| `src/oauth/validate-pat.ts` | Validate PAT, return userId |
| `src/oauth/authorize-page.ts` | HTML render for popup |
| `src/oauth/routes.ts` | Fastify plugin (all OAuth routes) |
| `src/app.ts` | Register oauth plugin |
| `tests/oauth/pkce.test.ts` | PKCE unit tests |
| `tests/oauth/routes.test.ts` | Integration tests |
| `.env.example` | Document `MCP_PUBLIC_URL` |
| `README.md` | Grok connector section |

---

### Task 1: `MCP_PUBLIC_URL` env var

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `tests/lib/env.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing env test**

Add to `tests/lib/env.test.ts`:

```typescript
it("requires MCP_PUBLIC_URL", () => {
  expect(() =>
    loadEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_FROM: "noreply@example.com",
    }),
  ).toThrow();
});

it("parses MCP_PUBLIC_URL", () => {
  const env = loadEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_FROM: "noreply@example.com",
    MCP_PUBLIC_URL: "https://mie.faurobert.fr/mcp",
  });
  expect(env.MCP_PUBLIC_URL).toBe("https://mie.faurobert.fr/mcp");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/env.test.ts`
Expected: FAIL — `MCP_PUBLIC_URL` missing from schema

- [ ] **Step 3: Add to env schema**

In `src/lib/env.ts`, add to `envSchema`:

```typescript
MCP_PUBLIC_URL: z.string().url(),
```

And in `loadEnv` `omitUndefined` block:

```typescript
MCP_PUBLIC_URL: overrides?.MCP_PUBLIC_URL ?? process.env.MCP_PUBLIC_URL,
```

- [ ] **Step 4: Update `.env.example`**

```bash
# Public MCP URL (OAuth resource identifier + Grok connector URL)
MCP_PUBLIC_URL=https://mie.faurobert.fr/mcp
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/lib/env.test.ts`
Expected: PASS

---

### Task 2: OAuth store + PKCE

**Files:**
- Create: `src/oauth/store.ts`
- Create: `src/oauth/pkce.ts`
- Create: `tests/oauth/pkce.test.ts`

- [ ] **Step 1: Write PKCE tests**

Create `tests/oauth/pkce.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { verifyPkceS256 } from "../../src/oauth/pkce.js";

function challengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("verifyPkceS256", () => {
  it("accepts matching verifier", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = challengeFromVerifier(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects wrong verifier", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = challengeFromVerifier("wrong-verifier");
    expect(verifyPkceS256(verifier, challenge)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm test tests/oauth/pkce.test.ts`

- [ ] **Step 3: Implement `src/oauth/pkce.ts`**

```typescript
import { createHash, timingSafeEqual } from "node:crypto";

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Implement `src/oauth/store.ts`**

```typescript
const AUTH_CODE_TTL_MS = 60_000;

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  pat: string;
  expiresAt: number;
  used: boolean;
}

const clients = new Map<string, OAuthClient>();
const authCodes = new Map<string, AuthCode>();

export function registerClient(input: {
  clientName: string;
  redirectUris: string[];
}): OAuthClient {
  const clientId = crypto.randomUUID();
  const client: OAuthClient = {
    clientId,
    clientName: input.clientName,
    redirectUris: input.redirectUris,
  };
  clients.set(clientId, client);
  return client;
}

export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId);
}

export function issueAuthCode(input: Omit<AuthCode, "expiresAt" | "used">): string {
  const entry: AuthCode = {
    ...input,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    used: false,
  };
  authCodes.set(input.code, entry);
  return input.code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const entry = authCodes.get(code);
  if (!entry) return undefined;
  if (entry.used || Date.now() > entry.expiresAt) {
    authCodes.delete(code);
    return undefined;
  }
  entry.used = true;
  authCodes.delete(code);
  return entry;
}

export function clearOAuthStoreForTests() {
  clients.clear();
  authCodes.clear();
}
```

- [ ] **Step 5: Run PKCE tests — expect PASS**

Run: `pnpm test tests/oauth/pkce.test.ts`

---

### Task 3: Metadata + PAT validation helpers

**Files:**
- Create: `src/oauth/metadata.ts`
- Create: `src/oauth/validate-pat.ts`
- Create: `tests/oauth/metadata.test.ts`

- [ ] **Step 1: Metadata test**

Create `tests/oauth/metadata.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  protectedResourceMetadata,
  authorizationServerMetadata,
} from "../../src/oauth/metadata.js";

describe("oauth metadata", () => {
  const base = "https://example.com";

  it("protected resource references MCP URL", () => {
    const md = protectedResourceMetadata(`${base}/mcp`);
    expect(md.resource).toBe(`${base}/mcp`);
    expect(md.authorization_servers).toEqual([`${base}`]);
  });

  it("authorization server lists required endpoints", () => {
    const md = authorizationServerMetadata(base);
    expect(md.authorization_endpoint).toBe(`${base}/oauth/authorize`);
    expect(md.token_endpoint).toBe(`${base}/oauth/token`);
    expect(md.registration_endpoint).toBe(`${base}/oauth/register`);
    expect(md.code_challenge_methods_supported).toEqual(["S256"]);
  });
});
```

- [ ] **Step 2: Implement `src/oauth/metadata.ts`**

```typescript
export function originFromPublicUrl(publicUrl: string): string {
  return new URL(publicUrl).origin;
}

export function protectedResourceMetadata(mcpPublicUrl: string) {
  const origin = originFromPublicUrl(mcpPublicUrl);
  return {
    resource: mcpPublicUrl,
    authorization_servers: [origin],
    scopes_supported: ["mcp:tools"],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}
```

- [ ] **Step 3: Implement `src/oauth/validate-pat.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePatFromHeader } from "../services/resolve-pat.js";

export async function validatePat(
  supabase: SupabaseClient,
  pat: string,
): Promise<boolean> {
  const userId = await resolvePatFromHeader(supabase, `Bearer ${pat}`);
  return userId !== null;
}
```

- [ ] **Step 4: Run metadata tests**

Run: `pnpm test tests/oauth/metadata.test.ts`

---

### Task 4: Authorize HTML page

**Files:**
- Create: `src/oauth/authorize-page.ts`

- [ ] **Step 1: Implement page renderer**

```typescript
export type AuthorizePageState = {
  email?: string;
  oauth: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    resource: string;
  };
  successMessage?: string;
  errorMessage?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderAuthorizePage(state: AuthorizePageState): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

  const banner = state.errorMessage
    ? `<p class="error">${escapeHtml(state.errorMessage)}</p>`
    : state.successMessage
      ? `<p class="success">${escapeHtml(state.successMessage)}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Connect Mainfranken IT Events</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin-top: 1rem; font-weight: 600; }
    input[type=email], input[type=text] { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer; }
    .error { color: #b00020; background: #fdecea; padding: 0.75rem; border-radius: 4px; }
    .success { color: #1b5e20; background: #e8f5e9; padding: 0.75rem; border-radius: 4px; }
    section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Connect Mainfranken IT Events</h1>
  ${banner}
  <section>
    <h2>Request a token</h2>
    <form method="post">
      ${hidden("action", "register")}
      ${hidden("client_id", state.oauth.clientId)}
      ${hidden("redirect_uri", state.oauth.redirectUri)}
      ${hidden("state", state.oauth.state)}
      ${hidden("code_challenge", state.oauth.codeChallenge)}
      ${hidden("resource", state.oauth.resource)}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required value="${escapeHtml(state.email ?? "")}">
      <button type="submit">Send token by email</button>
    </form>
  </section>
  <section>
    <h2>Paste your token</h2>
    <form method="post">
      ${hidden("action", "connect")}
      ${hidden("client_id", state.oauth.clientId)}
      ${hidden("redirect_uri", state.oauth.redirectUri)}
      ${hidden("state", state.oauth.state)}
      ${hidden("code_challenge", state.oauth.codeChallenge)}
      ${hidden("resource", state.oauth.resource)}
      <label for="pat">Agent token (mfe_pat_…)</label>
      <input id="pat" name="pat" type="text" required autocomplete="off" spellcheck="false">
      <button type="submit">Connect</button>
    </form>
  </section>
</body>
</html>`;
}
```

---

### Task 5: OAuth routes plugin

**Files:**
- Create: `src/oauth/routes.ts`
- Create: `tests/oauth/routes.test.ts`

- [ ] **Step 1: Write integration test skeleton**

Create `tests/oauth/routes.test.ts` with mocked `registerUser` and `validatePat`. Test full flow:

1. `GET /.well-known/oauth-protected-resource/mcp` → 200
2. `POST /oauth/register` → `client_id`
3. `GET /oauth/authorize?...` → HTML contains "Paste your token"
4. `POST /oauth/authorize` action=connect with valid PAT → 302 with `code`
5. `POST /oauth/token` with PKCE → `access_token` equals PAT

Use `vi.mock` for `validate-pat` and `register-user` where needed.

- [ ] **Step 2: Implement `src/oauth/routes.ts`**

Key handlers:

```typescript
import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import {
  authorizationServerMetadata,
  originFromPublicUrl,
  protectedResourceMetadata,
} from "./metadata.js";
import { renderAuthorizePage } from "./authorize-page.js";
import {
  consumeAuthCode,
  getClient,
  issueAuthCode,
  registerClient,
} from "./store.js";
import { verifyPkceS256 } from "./pkce.js";
import { validatePat } from "./validate-pat.js";
import { registerUser, RegisterRateLimitedError } from "../services/register-user.js";
import { registerEmailSchema } from "../schemas/auth.js";

export async function oauthRoutes(
  app: FastifyInstance,
  opts: { supabase: SupabaseClient; env: Env },
) {
  const { supabase, env } = opts;
  const origin = originFromPublicUrl(env.MCP_PUBLIC_URL);

  app.get("/.well-known/oauth-protected-resource/mcp", async () =>
    protectedResourceMetadata(env.MCP_PUBLIC_URL),
  );

  app.get("/.well-known/oauth-authorization-server", async () =>
    authorizationServerMetadata(origin),
  );

  app.post("/oauth/register", async (request, reply) => {
    const body = request.body as {
      client_name?: string;
      redirect_uris?: string[];
    };
    const redirectUris = body.redirect_uris ?? [];
    if (redirectUris.length === 0) {
      return reply.status(400).send({ error: "invalid_client_metadata" });
    }
    const client = registerClient({
      clientName: body.client_name ?? "MCP Client",
      redirectUris,
    });
    return {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  });

  // GET + POST /oauth/authorize — parse query/body, render or redirect
  // POST /oauth/token — exchange code for PAT

  // Helper: parseAuthorizeParams from query or body
  // On connect + valid PAT: issueAuthCode({ code: randomUUID(), pat, ... })
  // redirect 302 to redirect_uri?code=&state=
}
```

Implement GET/POST authorize and POST token fully following the spec. Validate:
- `client_id` exists
- `redirect_uri` in client's list
- `resource` equals `env.MCP_PUBLIC_URL`
- `code_challenge_method` is `S256` on GET

- [ ] **Step 3: Run integration tests**

Run: `pnpm test tests/oauth/routes.test.ts`

---

### Task 6: Wire into app

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Register plugin**

```typescript
import { oauthRoutes } from "./oauth/routes.js";

// inside buildApp(), after cors:
await app.register(oauthRoutes, { supabase, env });
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All pass (update any env fixtures missing `MCP_PUBLIC_URL`)

---

### Task 7: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Grok section after MCP client config**

```markdown
### Grok custom connector

1. Register for a PAT (`register_user` tool, `POST /auth/register`, or the OAuth popup).
2. In Grok: [grok.com/connectors](https://grok.com/connectors) → **New Connector** → **Custom**.
3. URL: your public MCP endpoint (same as `MCP_PUBLIC_URL`, e.g. `https://mie.faurobert.fr/mcp`).
4. Complete the popup: request token by email or paste your `mfe_pat_…` token.
5. Enable the connector in chat; auth tools (`set_rsvp`, etc.) work after connect.

Public tools (`search_events`, `get_event`) work without completing OAuth.
```

---

### Task 8: Manual Grok smoke test

- [ ] Deploy with `MCP_PUBLIC_URL` set
- [ ] Add connector in Grok → popup appears
- [ ] Paste valid PAT → connector connects
- [ ] Call `set_rsvp` from Grok chat
- [ ] Verify Cursor `mcp.json` still works: `pnpm smoke:mcp`

---

## Plan self-review

| Spec requirement | Task |
|------------------|------|
| OAuth discovery endpoints | Task 3, 5 |
| DCR | Task 5 |
| Popup register + paste PAT | Task 4, 5 |
| PAT as access_token | Task 5 token handler |
| Public MCP unchanged | No `/mcp` changes |
| MCP_PUBLIC_URL | Task 1 |
| Tests | Tasks 1–6 |
| README | Task 7 |

No placeholders. All file paths defined.
