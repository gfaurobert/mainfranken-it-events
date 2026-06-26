import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as connectionOtp from "../../src/lib/connection-otp.js";
import {
  ConnectionOtpRequestRateLimitedError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "../../src/services/connection-errors.js";
import { requestConnectionOtp } from "../../src/services/request-connection-otp.js";
import {
  redeemConnectionOtp,
  resetRedeemRateLimitsForTests,
} from "../../src/services/redeem-connection-otp.js";

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

describe("redeemConnectionOtp", () => {
  beforeEach(() => {
    resetRedeemRateLimitsForTests();
    vi.restoreAllMocks();
  });

  it("creates connection and marks OTP used", async () => {
    const futureExpiry = new Date(Date.now() + 600_000).toISOString();
    const otpRow = {
      id: "otp-1",
      issuer_id: "issuer-1",
      code_hash: "hash",
      expires_at: futureExpiry,
      used_at: null,
    };

    const otpSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: otpRow, error: null }),
    };
    const connectionsSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const connectionsInsertChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const profilesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { display_name: "Alice" }, error: null }),
    };
    const otpUpdateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const client = {
      from: vi.fn((table: string) => {
        callIndex += 1;
        if (callIndex === 1) {
          expect(table).toBe("connection_otps");
          return otpSelectChain;
        }
        if (callIndex === 2) {
          expect(table).toBe("connections");
          return connectionsSelectChain;
        }
        if (callIndex === 3) {
          expect(table).toBe("profiles");
          return profilesChain;
        }
        if (callIndex === 4) {
          expect(table).toBe("connections");
          return connectionsInsertChain;
        }
        if (callIndex === 5) {
          expect(table).toBe("connection_otps");
          return otpUpdateChain;
        }
        throw new Error(`unexpected from call ${callIndex} for ${table}`);
      }),
    } as unknown as SupabaseClient;

    vi.spyOn(connectionOtp, "verifyConnectionOtp").mockResolvedValue(true);

    const result = await redeemConnectionOtp(client, "redeemer-1", "123456");

    expect(result.connection).toEqual({ user_id: "issuer-1", display_name: "Alice" });
    expect(result.message).toBe("You're now connected with Alice.");
    expect(connectionsInsertChain.insert).toHaveBeenCalledWith({
      user_a: "issuer-1",
      user_b: "redeemer-1",
    });
    expect(otpUpdateChain.update).toHaveBeenCalledWith({
      used_at: expect.any(String),
      used_by: "redeemer-1",
    });
    expect(otpUpdateChain.eq).toHaveBeenCalledWith("id", "otp-1");
  });

  it("rejects redeeming own OTP with RedeemOwnOtpError", async () => {
    const futureExpiry = new Date(Date.now() + 600_000).toISOString();
    const otpRow = {
      id: "otp-1",
      issuer_id: "user-1",
      code_hash: "hash",
      expires_at: futureExpiry,
      used_at: null,
    };

    const otpSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: otpRow, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(otpSelectChain),
    } as unknown as SupabaseClient;

    vi.spyOn(connectionOtp, "verifyConnectionOtp").mockResolvedValue(true);

    await expect(redeemConnectionOtp(client, "user-1", "123456")).rejects.toThrow(
      RedeemOwnOtpError,
    );
  });

  it("rejects invalid code with InvalidConnectionOtpError", async () => {
    const otpSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(otpSelectChain),
    } as unknown as SupabaseClient;

    await expect(redeemConnectionOtp(client, "redeemer-1", "000000")).rejects.toThrow(
      InvalidConnectionOtpError,
    );
  });
});
