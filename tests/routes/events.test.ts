import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsRoutes } from "../../src/routes/events.js";
import * as searchModule from "../../src/services/search-events.js";
import * as getModule from "../../src/services/get-event.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("events routes", () => {
  it("GET /events returns search results", async () => {
    vi.spyOn(searchModule, "searchEvents").mockResolvedValue({
      events: [],
      count: 0,
    });

    const app = Fastify();
    await app.register(eventsRoutes, {
      supabase: {} as never,
    });

    const res = await app.inject({ method: "GET", url: "/events?city=Würzburg" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], count: 0 });
    await app.close();
  });

  it("GET /events/:id returns 404 when not found", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(getModule, "getEvent").mockRejectedValue(new getModule.EventNotFoundError(id));

    const app = Fastify();
    await app.register(eventsRoutes, { supabase: {} as never });

    const res = await app.inject({
      method: "GET",
      url: `/events/${id}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
