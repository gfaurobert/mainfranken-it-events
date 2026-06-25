import { describe, expect, it, vi } from "vitest";
import { resolvePatFromHeader } from "../../src/services/resolve-pat.js";
import { hashPat, patLookup } from "../../src/lib/pat.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("resolvePatFromHeader", () => {
  it("returns userId for valid bearer pat", async () => {
    const pat = "mfe_pat_validtoken1234567890";
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { user_id: "user-1", token_hash: await hashPat(pat) },
        error: null,
      }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;

    const userId = await resolvePatFromHeader(client, `Bearer ${pat}`);
    expect(userId).toBe("user-1");
    expect(chain.eq).toHaveBeenCalledWith("token_lookup", patLookup(pat));
  });

  it("returns null for missing header", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    expect(await resolvePatFromHeader(client, undefined)).toBeNull();
  });
});
