import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meRsvpsRoutes } from "../../src/routes/me-rsvps.js";
import * as listModule from "../../src/services/list-my-rsvps.js";
import * as removeModule from "../../src/services/remove-rsvp.js";
import * as resolvePatModule from "../../src/services/resolve-pat.js";
import * as setModule from "../../src/services/set-rsvp.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("me-rsvps routes", () => {
  it("GET /me/rsvps returns 401 without PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue(null);

    const app = Fastify();
    await app.register(meRsvpsRoutes, { supabase: {} as never });

    const res = await app.inject({ method: "GET", url: "/me/rsvps" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /me/rsvps returns user RSVPs with PAT", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue("user-1");
    vi.spyOn(listModule, "listMyRsvps").mockResolvedValue({
      rsvps: [],
      count: 0,
    });

    const app = Fastify();
    await app.register(meRsvpsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "GET",
      url: "/me/rsvps?status=going",
      headers: { authorization: "Bearer mfe_pat_example" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rsvps: [], count: 0 });
    expect(listModule.listMyRsvps).toHaveBeenCalledWith(expect.anything(), "user-1", "going");
    await app.close();
  });

  it("PUT/DELETE /me/rsvps use authenticated user", async () => {
    vi.spyOn(resolvePatModule, "resolvePatFromHeader").mockResolvedValue("user-1");
    vi.spyOn(setModule, "setRsvp").mockResolvedValue({
      event_id: "11111111-1111-4111-8111-111111111111",
      status: "going",
      updated_at: "2026-06-25T12:00:00.000Z",
    });
    vi.spyOn(removeModule, "removeRsvp").mockResolvedValue(undefined);

    const app = Fastify();
    await app.register(meRsvpsRoutes, { supabase: {} as never });

    const putRes = await app.inject({
      method: "PUT",
      url: "/me/rsvps/11111111-1111-4111-8111-111111111111",
      headers: { authorization: "Bearer mfe_pat_example" },
      payload: { status: "going" },
    });
    expect(putRes.statusCode).toBe(200);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/me/rsvps/11111111-1111-4111-8111-111111111111",
      headers: { authorization: "Bearer mfe_pat_example" },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });
    await app.close();
  });
});
