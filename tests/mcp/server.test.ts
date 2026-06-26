import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/lib/env.js";
import { registerMcpRoutes } from "../../src/mcp/server.js";

const env = loadEnv({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "secret",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_FROM: "Test <test@example.com>",
});

describe("mcp routes", () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it("rejects GET /mcp with 405", async () => {
    app = Fastify();
    await registerMcpRoutes(app, {} as never, env);

    const res = await app.inject({ method: "GET", url: "/mcp" });
    expect(res.statusCode).toBe(405);
    expect(res.json()).toEqual({ error: "Method not allowed" });
  });

  it("rejects DELETE /mcp with 405", async () => {
    app = Fastify();
    await registerMcpRoutes(app, {} as never, env);

    const res = await app.inject({ method: "DELETE", url: "/mcp" });
    expect(res.statusCode).toBe(405);
    expect(res.json()).toEqual({ error: "Method not allowed" });
  });
});
