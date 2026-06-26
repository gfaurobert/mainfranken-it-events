import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnv } from "./lib/env.js";
import { getSupabase } from "./lib/supabase.js";
import { eventsRoutes } from "./routes/events.js";
import { authRoutes } from "./routes/auth.js";
import { meRsvpsRoutes } from "./routes/me-rsvps.js";
import { meConnectionsRoutes } from "./routes/me-connections.js";
import { registerMcpRoutes } from "./mcp/server.js";

export async function buildApp() {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(eventsRoutes, { supabase });
  await app.register(authRoutes, { supabase, env });
  await app.register(meRsvpsRoutes, { supabase });
  await app.register(meConnectionsRoutes, { supabase });
  await registerMcpRoutes(app, supabase, env);

  app.get("/health", async () => ({ status: "ok" }));

  return { app, env };
}
