import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meConnectionsRoutes } from "../../src/routes/me-connections.js";
import * as listConnectionsModule from "../../src/services/list-connections.js";
import * as requestOtpModule from "../../src/services/request-connection-otp.js";
import * as resolvePatModule from "../../src/services/resolve-pat.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("me-connections routes", () => {
  it("POST /me/connections/otp returns 401 without PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue(null);

    const app = Fastify();
    await app.register(meConnectionsRoutes, { supabase: {} as never });

    const res = await app.inject({ method: "POST", url: "/me/connections/otp" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /me/connections returns 401 without PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue(null);

    const app = Fastify();
    await app.register(meConnectionsRoutes, { supabase: {} as never });

    const res = await app.inject({ method: "GET", url: "/me/connections" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /me/connections/otp/redeem returns 400 with invalid body", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue("user-1");

    const app = Fastify();
    await app.register(meConnectionsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "POST",
      url: "/me/connections/otp/redeem",
      headers: { authorization: "Bearer mfe_pat_example" },
      payload: { code: "abc" },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /me/connections returns connections with PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue("user-1");
    vi.spyOn(listConnectionsModule, "listConnections").mockResolvedValue({
      connections: [],
      count: 0,
    });

    const app = Fastify();
    await app.register(meConnectionsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "GET",
      url: "/me/connections",
      headers: { authorization: "Bearer mfe_pat_example" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connections: [], count: 0 });
    expect(listConnectionsModule.listConnections).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
    await app.close();
  });

  it("POST /me/connections/otp returns OTP with PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue("user-1");
    vi.spyOn(requestOtpModule, "requestConnectionOtp").mockResolvedValue({
      code: "123456",
      expires_at: "2026-06-26T12:00:00.000Z",
    });

    const app = Fastify();
    await app.register(meConnectionsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "POST",
      url: "/me/connections/otp",
      headers: { authorization: "Bearer mfe_pat_example" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      code: "123456",
      expires_at: "2026-06-26T12:00:00.000Z",
      message: "Share this code with your friend: 123456 (expires 2026-06-26T12:00:00.000Z)",
    });
    expect(requestOtpModule.requestConnectionOtp).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
    await app.close();
  });
});
