import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import * as getEventModule from "../../src/services/get-event.js";
import { listMyRsvps } from "../../src/services/list-my-rsvps.js";
import { removeRsvp } from "../../src/services/remove-rsvp.js";
import { setRsvp } from "../../src/services/set-rsvp.js";

describe("rsvp services", () => {
  it("setRsvp verifies event and upserts RSVP", async () => {
    vi.spyOn(getEventModule, "getEvent").mockResolvedValue({
      event: { id: "11111111-1111-4111-8111-111111111111" } as never,
    });

    const chain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          event_id: "11111111-1111-4111-8111-111111111111",
          status: "going",
          updated_at: "2026-06-25T12:00:00.000Z",
        },
        error: null,
      }),
    };
    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    const result = await setRsvp(
      client,
      "user-1",
      "11111111-1111-4111-8111-111111111111",
      "going",
    );

    expect(result.status).toBe("going");
    expect(chain.upsert).toHaveBeenCalledOnce();
    expect(getEventModule.getEvent).toHaveBeenCalledWith(
      client,
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("listMyRsvps returns joined event summary", async () => {
    const rows = [
      {
        event_id: "11111111-1111-4111-8111-111111111111",
        status: "interested",
        updated_at: "2026-06-25T12:00:00.000Z",
        event: {
          id: "11111111-1111-4111-8111-111111111111",
          title: "AI Meetup",
          starts_at: "2026-07-01T18:00:00.000Z",
          city: "Würzburg",
        },
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    const result = await listMyRsvps(client, "user-1");

    expect(result.count).toBe(1);
    expect(result.rsvps[0]?.event.title).toBe("AI Meetup");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("removeRsvp deletes user/event row", async () => {
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    chain.eq = vi
      .fn()
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });

    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await removeRsvp(client, "user-1", "11111111-1111-4111-8111-111111111111");

    expect(chain.delete).toHaveBeenCalledOnce();
    expect(chain.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(chain.eq).toHaveBeenNthCalledWith(
      2,
      "event_id",
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
