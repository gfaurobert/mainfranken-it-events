import { describe, expect, it } from "vitest";
import {
  connectionOtpLookup,
  generateConnectionOtpCode,
  hashConnectionOtp,
  verifyConnectionOtp,
} from "../../src/lib/connection-otp.js";

describe("connection-otp", () => {
  it("generates a 6-digit zero-padded code", () => {
    const code = generateConnectionOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("hashes and verifies codes", async () => {
    const code = "482917";
    const hash = await hashConnectionOtp(code);
    expect(connectionOtpLookup(code)).toHaveLength(64);
    expect(await verifyConnectionOtp(code, hash)).toBe(true);
    expect(await verifyConnectionOtp("000000", hash)).toBe(false);
  });
});
