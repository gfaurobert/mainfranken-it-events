import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_PASSWORD } = env;

function ok(label, detail) {
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) {
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail);
    return true;
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
    return false;
  }
}

const results = [];

results.push(
  await check("Project URL reachable (auth health)", async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return body.name ?? "healthy";
  }),
);

results.push(
  await check("Publishable key accepted by auth", async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (res.status === 401) throw new Error("key rejected");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "settings readable";
  }),
);

results.push(
  await check("REST API (publishable key)", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? "unauthorized");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "root accessible";
  }),
);

async function connectPostgres(pg, config) {
  const client = new pg.default.Client({
    ...config,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  await client.end();
  const tableList = tables.rows.map((r) => r.tablename);
  return `${tableList.length} public table(s)${tableList.length ? `: ${tableList.join(", ")}` : ""}`;
}

results.push(
  await check("Postgres (connection pooler)", async () => {
    let pg;
    try {
      pg = await import("pg");
    } catch {
      throw new Error("install pg first: pnpm add -D pg");
    }

    const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    if (!projectRef) throw new Error("could not parse project ref from URL");

    const poolerHosts = [
      "aws-0-eu-central-1.pooler.supabase.com",
      "aws-0-eu-west-1.pooler.supabase.com",
    ];

    let lastError;
    for (const host of poolerHosts) {
      try {
        return await connectPostgres(pg, {
          host,
          port: 6543,
          database: "postgres",
          user: `postgres.${projectRef}`,
          password: SUPABASE_PASSWORD,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }),
);

const secretKey = env.SUPABASE_SECRET_KEY ?? "";
if (secretKey.includes("[YOUR-PASSWORD]")) {
  fail("Secret API key configured", "still contains [YOUR-PASSWORD] placeholder");
  results.push(false);
} else if (secretKey.startsWith("sb_secret_") || secretKey.startsWith("eyJ")) {
  results.push(
    await check("REST API (secret key)", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return "root accessible";
    }),
  );
} else if (secretKey.startsWith("postgresql://")) {
  fail(
    "Secret API key configured",
    "value is a Postgres URL, not a Supabase secret key (sb_secret_… or service_role JWT)",
  );
  results.push(false);
} else {
  fail("Secret API key configured", "missing or unrecognized format");
  results.push(false);
}

console.log("");
console.log(
  results.every(Boolean)
    ? "Overall: you have working access with the configured credentials."
    : "Overall: partial or missing access — see failures above.",
);
