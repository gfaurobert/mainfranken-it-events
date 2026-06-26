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

const { SUPABASE_URL, SUPABASE_PASSWORD } = env;
const migrationSql = readFileSync(
  resolve(root, "supabase/migrations/20260626130000_user_connections_fix_otp_schema.sql"),
  "utf8",
);

const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef || !SUPABASE_PASSWORD) {
  console.error("Need SUPABASE_URL and SUPABASE_PASSWORD in .env");
  process.exit(1);
}

const pg = await import("pg");

const poolerHosts = [
  "aws-0-eu-central-1.pooler.supabase.com",
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-0-eu-west-2.pooler.supabase.com",
  "aws-0-eu-west-3.pooler.supabase.com",
];

let client;
let lastError;
for (const host of poolerHosts) {
  const candidate = new pg.default.Client({
    host,
    port: 6543,
    database: "postgres",
    user: `postgres.${projectRef}`,
    password: SUPABASE_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  try {
    await candidate.connect();
    client = candidate;
    console.log("Connected via", host);
    break;
  } catch (error) {
    lastError = error;
  }
}

if (!client) {
  console.error("Could not connect to Postgres pooler:", lastError?.message ?? lastError);
  process.exit(1);
}

try {
  const before = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'connection_otps'
     ORDER BY ordinal_position`,
  );
  console.log("connection_otps columns before:", before.rows.map((r) => r.column_name).join(", ") || "(none)");

  await client.query(migrationSql);
  await client.query("NOTIFY pgrst, 'reload schema'");

  const after = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'connection_otps'
     ORDER BY ordinal_position`,
  );
  console.log("connection_otps columns after:", after.rows.map((r) => r.column_name).join(", "));
  console.log("Migration applied and PostgREST schema reload notified.");
} finally {
  await client.end();
}
