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
