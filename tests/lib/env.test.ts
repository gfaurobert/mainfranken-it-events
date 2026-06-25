import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/lib/env.js";

describe("loadEnv", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("uses PORT from environment", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    process.env.PORT = "3789";

    const env = loadEnv();
    expect(env.PORT).toBe(3789);
  });

  it("defaults PORT to 3000 when unset", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    delete process.env.PORT;

    const env = loadEnv();
    expect(env.PORT).toBe(3000);
  });
});
