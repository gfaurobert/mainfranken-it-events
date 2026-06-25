import { describe, expect, it, vi } from "vitest";
import { searchEvents } from "../../src/services/search-events.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeMockClient(rows: unknown[], error: Error | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    overlaps: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { from, chain, client: { from } as unknown as SupabaseClient };
}

describe("searchEvents", () => {
  it("returns mapped events and count", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "KI Stammtisch",
      description: "LLM talk",
      starts_at: "2026-07-15T18:00:00+00:00",
      ends_at: null,
      location_name: "Hub",
      city: "Würzburg",
      address: null,
      url: "https://example.com",
      organizer: "MF IT",
      tags: ["ki"],
      is_free: true,
      price: null,
    };
    const { client, chain } = makeMockClient([row]);
    const result = await searchEvents(client, { city: "Würzburg", limit: 10 });
    expect(result.count).toBe(1);
    expect(result.events[0]?.title).toBe("KI Stammtisch");
    expect(chain.ilike).toHaveBeenCalledWith("city", "Würzburg");
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("throws on supabase error", async () => {
    const { client } = makeMockClient([], new Error("db down") as never);
    await expect(searchEvents(client, {})).rejects.toThrow("db down");
  });
});
