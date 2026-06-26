import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ConnectionOtpRequestRateLimitedError } from "../../src/services/connection-errors.js";
import { requestConnectionOtp } from "../../src/services/request-connection-otp.js";

describe("requestConnectionOtp", () => {
  it("returns a 6-digit code and expiry", async () => {
    const invalidateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null }),
    };
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
    };
    const insertChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const client = {
      from: vi.fn(() => {
        callIndex += 1;
        if (callIndex === 1) return countChain;
        if (callIndex === 2) return invalidateChain;
        return insertChain;
      }),
    } as unknown as SupabaseClient;

    const result = await requestConnectionOtp(client, "issuer-1");

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.expires_at).toBeTruthy();
    expect(insertChain.insert).toHaveBeenCalledOnce();
  });

  it("rejects when hourly rate limit exceeded", async () => {
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(countChain),
    } as unknown as SupabaseClient;

    await expect(requestConnectionOtp(client, "issuer-1")).rejects.toThrow(
      ConnectionOtpRequestRateLimitedError,
    );
  });
});
