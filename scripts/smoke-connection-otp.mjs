/**
 * Smoke test for request_connection_otp (MCP + REST).
 *
 * Usage:
 *   pnpm run smoke:connection-otp
 *   SMOKE_PAT=mfe_pat_... pnpm run smoke:connection-otp   # optional override
 */

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const PAT_PREFIX = "mfe_pat_";
const SMOKE_EMAIL = "smoke-connection-otp@mainfranken-it-events.local";

function generatePat() {
  return PAT_PREFIX + randomBytes(32).toString("base64url");
}

function patLookup(pat) {
  return createHash("sha256").update(pat).digest("hex");
}

async function hashPat(pat) {
  return bcrypt.hash(pat, 10);
}

async function provisionSmokePat() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;

  let userId = usersData.users.find((u) => u.email === SMOKE_EMAIL)?.id;
  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: SMOKE_EMAIL,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user?.id;
  }
  if (!userId) throw new Error("Failed to resolve smoke user id");

  await supabase.from("profiles").upsert({
    id: userId,
    display_name: "Smoke OTP",
  });

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
    label: "smoke-connection-otp",
  });
  if (tokenError) throw tokenError;

  return pat;
}

const port = process.env.PORT ?? "3789";
const base = process.env.SMOKE_BASE_URL ?? `http://localhost:${port}`;
let pat = process.env.SMOKE_PAT;

if (!pat) {
  console.log("No SMOKE_PAT — provisioning ephemeral smoke PAT via Supabase...");
  pat = await provisionSmokePat();
}

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function parseSseMessages(text) {
  const messages = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      messages.push(JSON.parse(line.slice(6)));
    }
  }
  return messages;
}

async function mcpRequest(body, sessionId, authorization) {
  const headers = { ...mcpHeaders };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (authorization) headers.authorization = authorization;

  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    sessionId: res.headers.get("mcp-session-id") ?? sessionId,
    messages: parseSseMessages(text),
    raw: text,
  };
}

function diagnoseToolResult(label, result) {
  console.log(`\n=== ${label} ===`);
  if (!result) {
    console.log("NO RESULT");
    return false;
  }

  console.log("result keys:", Object.keys(result));
  console.log("content:", JSON.stringify(result.content, null, 2));
  console.log("structuredContent:", JSON.stringify(result.structuredContent, null, 2));
  console.log("String(result):", String(result));
  console.log("String(content[0]):", result.content?.[0] ? String(result.content[0]) : "n/a");
  console.log("content[0].text:", result.content?.[0]?.text);
  console.log("structuredContent.message:", result.structuredContent?.message);

  const text = result.content?.[0]?.text;
  const bad = text === "[object Object]";
  if (bad) {
    console.error("FAIL: response stringifies to [object Object]");
    return false;
  }
  return true;
}

console.log("Base URL:", base);
console.log("PAT source:", process.env.SMOKE_PAT ? "SMOKE_PAT env" : "auto-provisioned");

// --- REST without PAT ---
const restNoAuth = await fetch(`${base}/me/connections/otp`, { method: "POST" });
console.log("\nREST POST /me/connections/otp (no PAT):", restNoAuth.status);
console.log(await restNoAuth.json());

const authHeader = pat.startsWith("Bearer ") ? pat : `Bearer ${pat}`;

// --- REST with PAT ---
const restRes = await fetch(`${base}/me/connections/otp`, {
  method: "POST",
  headers: { authorization: authHeader },
});
const restBody = await restRes.json();
console.log("\nREST POST /me/connections/otp (with PAT):", restRes.status);
console.log(JSON.stringify(restBody, null, 2));
if (restBody.message?.includes?.("[object Object]")) {
  console.error("FAIL: REST message is [object Object]");
  process.exit(1);
}

// --- MCP session ---
const init = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-connection-otp", version: "0.1.0" },
    },
  },
  null,
  authHeader,
);

if (!init.ok) {
  console.error("initialize failed", init.status, init.raw);
  process.exit(1);
}

const sessionId = init.sessionId;
await mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, authHeader);

const otpCall = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "request_connection_otp",
      arguments: {},
    },
  },
  sessionId,
  authHeader,
);

const otpResult = otpCall.messages.find((m) => m.id === 2)?.result;
const ok = diagnoseToolResult("MCP request_connection_otp", otpResult);

if (!ok) {
  console.error("\nRaw SSE:", otpCall.raw);
  process.exit(1);
}

if (!otpResult?.content?.[0]?.text?.match(/\d{6}/)) {
  console.error("FAIL: MCP content text missing 6-digit code");
  process.exit(1);
}

console.log("\nPASS: request_connection_otp returns readable text with code");
