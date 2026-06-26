import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/lib/env.js";

const smtpEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_FROM: "Test <test@example.com>",
};

describe("loadEnv", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("uses PORT from environment", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    process.env.PORT = "3789";
    Object.assign(process.env, smtpEnv);

    const env = loadEnv();
    expect(env.PORT).toBe(3789);
  });

  it("defaults PORT to 3000 when unset", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    delete process.env.PORT;
    Object.assign(process.env, smtpEnv);

    const env = loadEnv();
    expect(env.PORT).toBe(3000);
  });

  it("parses SMTP settings", () => {
    const env = loadEnv({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_FROM: "Test <test@example.com>",
      REGISTER_EMAIL_COOLDOWN_SECONDS: "120",
    });
    expect(env.SMTP_HOST).toBe("smtp.example.com");
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.REGISTER_EMAIL_COOLDOWN_SECONDS).toBe(120);
  });
});
