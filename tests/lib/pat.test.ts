import { describe, expect, it } from "vitest";
import { generatePat, hashPat, patLookup, verifyPat } from "../../src/lib/pat.js";

describe("pat", () => {
  it("generatePat returns mfe_pat_ prefix", () => {
    const pat = generatePat();
    expect(pat.startsWith("mfe_pat_")).toBe(true);
    expect(pat.length).toBeGreaterThan(20);
  });

  it("patLookup is deterministic", () => {
    const pat = "mfe_pat_testtoken";
    expect(patLookup(pat)).toBe(patLookup(pat));
  });

  it("verifyPat accepts valid pat against hash", async () => {
    const pat = generatePat();
    const hash = await hashPat(pat);
    expect(await verifyPat(pat, hash)).toBe(true);
    expect(await verifyPat(pat + "x", hash)).toBe(false);
  });
});
