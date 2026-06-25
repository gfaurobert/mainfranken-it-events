import { describe, expect, it, vi } from "vitest";
import { getEvent, EventNotFoundError } from "../../src/services/get-event.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("getEvent", () => {
  it("returns event when found", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "DevOps Day",
      description: null,
      starts_at: "2026-07-22T18:00:00+00:00",
      ends_at: null,
      location_name: null,
      city: "Schweinfurt",
      address: null,
      url: null,
      organizer: null,
      tags: ["devops"],
      is_free: true,
      price: null,
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    const result = await getEvent(client, row.id);
    expect(result.event.title).toBe("DevOps Day");
  });

  it("throws EventNotFoundError when missing", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    await expect(
      getEvent(client, "22222222-2222-2222-2222-222222222222"),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});
