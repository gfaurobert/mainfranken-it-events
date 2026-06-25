import Fastify from "fastify";
import type { Env } from "../../src/lib/env.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authRoutes } from "../../src/routes/auth.js";
import * as registerUserModule from "../../src/services/register-user.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth routes", () => {
  it("POST /auth/register returns success without PAT", async () => {
    vi.spyOn(registerUserModule, "registerUser").mockResolvedValue({
      ok: true,
      message: "Check your email",
    });

    const app = Fastify();
    await app.register(authRoutes, {
      supabase: {} as never,
      env: {} as Env,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "test@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: "Check your email" });
    expect(res.body).not.toContain("mfe_pat_");
    await app.close();
  });

  it("POST /auth/register maps rate limit to 429", async () => {
    vi.spyOn(registerUserModule, "registerUser").mockRejectedValue(
      new registerUserModule.RegisterRateLimitedError(),
    );

    const app = Fastify();
    await app.register(authRoutes, {
      supabase: {} as never,
      env: {} as Env,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "test@example.com" },
    });

    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it("POST /auth/register validates body", async () => {
    const app = Fastify();
    await app.register(authRoutes, {
      supabase: {} as never,
      env: {} as Env,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
