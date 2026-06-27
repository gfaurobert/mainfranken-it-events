# AGENTS.md

## Cursor Cloud specific instructions

This repo is a monorepo with three parts:

- **Node 24 TS API/MCP server** (repo root) — Fastify REST + MCP (Streamable HTTP) backed by
  Supabase. This is the primary product. See `README.md`.
- **`ingest/`** — Python Google ADK agent that scrapes/normalizes events into Supabase
  (`uv`-managed). See `ingest/README.md` / `ingest/CLAUDE.md`.
- **`web/demo/`** — static demo site (served via `pnpm demo`), reads bundled JSON, not the live API.

The update script already runs `pnpm install` (root) and `uv sync` (`ingest`), so deps are fresh.
Below are the non-obvious things needed to actually run/test.

### Node version

Spec requires Node **24** (`engines`). It is installed via nvm (`nvm use 24`), but the default
shell `node` is **v22** (`/exec-daemon/node`), which still runs everything here (install, `vitest`,
and the `tsx`-based `pnpm dev`, since the `--env-file`/`--import` flags exist in 22). Use Node 24
explicitly when you want to match the spec: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`.

### Node API/MCP server (root)

- Test: `pnpm test` (Vitest, 59 tests; all Supabase calls are mocked, so no DB needed).
- Typecheck/build: `pnpm build` (`tsc`) currently reports **2 pre-existing type errors** in
  `src/services/list-my-rsvps.ts` and `src/services/list-connection-events.ts` (PostgREST embed
  casts). These do NOT affect `pnpm dev`/runtime (dev uses `tsx`, no typecheck). There is no
  separate ESLint config; `pnpm build` is the closest thing to a lint gate.
- Run: `pnpm dev` (watch mode). Needs a `.env` (gitignored) with a working Supabase + SMTP.
  Smoke test public MCP tools with the server running: `pnpm smoke:mcp`.

### Supabase backend — required to run the server

`loadEnv()` requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SMTP_*`, and the app uses
both PostgREST (`.from(...)`) and GoTrue (`auth.admin.createUser/listUsers`). Two ways to get one:

1. **Hosted Supabase (the maintainers' intended path).** The committed migrations were applied to a
   hosted project (note the user rule "use supabase MCP to run the migration", and
   `.env.example` / `scripts/check-supabase-access.mjs` point at `*.supabase.co`). Put the project's
   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (and real `SMTP_*`) in `.env`, then `pnpm dev`.

2. **Local Supabase stack (used to validate this environment, no secrets needed).** Requires Docker
   + the Supabase CLI (both preinstalled in the snapshot).
   - Start Docker (no systemd): `sudo dockerd > /tmp/dockerd.log 2>&1 &` then
     `sudo chmod 666 /var/run/docker.sock`. (Docker 29 needs `fuse-overlayfs` + the
     `containerd-snapshotter: false` feature in `/etc/docker/daemon.json`, already configured.)
   - **Do NOT run `supabase db reset` / let `supabase start` apply the repo migrations.** They do
     not apply cleanly locally: `20260625120000_init_schema.sql` and
     `20260625120000_auth_pat_rsvp.sql` share a timestamp and define `profiles`/`access_tokens`/
     `rsvps` differently, and `20260625120500_harden_functions.sql` depends on the hosted-only
     `public.rls_auto_enable()`.
   - Instead: `supabase init` (creates `supabase/config.toml`; keep untracked), temporarily move
     `supabase/migrations` + `supabase/seed.sql` aside, `supabase start`, then apply the
     **consolidated final-state schema** (saved at `~/mainfranken-local-schema.sql`; if absent,
     reconstruct it from `supabase/migrations` final state) and the seed via
     `docker exec -i supabase_db_workspace psql -U postgres -d postgres`.
   - After any manual DDL: grant PostgREST roles
     (`grant all on all tables in schema public to anon, authenticated, service_role;`) and reload
     the schema cache (`notify pgrst, 'reload schema';`) — manual DDL bypasses Supabase's automatic
     grant/notify wiring, otherwise REST returns `42501 permission denied`.
   - `.env` for the local stack: `SUPABASE_URL=http://127.0.0.1:54321`,
     `SUPABASE_SERVICE_ROLE_KEY=<service_role key printed by `supabase start`>`, `PORT=3789`.
   - **Email/PAT delivery:** the app sends PAT emails via its own nodemailer SMTP (not Supabase
     Auth's). Point it at the bundled Mailpit by setting `smtp_port = 54325` under `[local_smtp]` in
     `config.toml` (restart the stack), then `.env`: `SMTP_HOST=127.0.0.1`, `SMTP_PORT=54325`,
     `SMTP_SECURE=false`, `SMTP_FROM="..."`. Read captured tokens from the Mailpit web UI
     (http://127.0.0.1:54324) or its API (`/api/v1/messages`). Studio is at http://127.0.0.1:54323.

### Python ingest agent (`ingest/`)

- `uv` lives at `~/.local/bin/uv`. Tests: `uv run pytest tests/unit tests/integration` run offline
  (unit = 111 passed; integration = 1 passed / 2 skipped). Lint: `uv sync --extra lint` then
  `uv run ruff check` (currently reports ~90 pre-existing findings, mostly in tests).
- Running the actual agent (`agents-cli playground`, `eval`, `deploy`) needs the
  `google-agents-cli` tool (`uv tool install google-agents-cli`) **and** GCP/Vertex AI credentials
  (and `OPENCODE_GO_KEY` for the LiteLLM model). Without those secrets the agent can't run
  end-to-end; unit/integration pytest still pass offline.
