import { describe, expect, it, vi } from "vitest";
import {
  registerUser,
  RegisterRateLimitedError,
} from "../../src/services/register-user.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../src/lib/env.js";

const env = { REGISTER_EMAIL_COOLDOWN_SECONDS: 300 } as Env;

describe("registerUser", () => {
  it("returns ok message without pat in response", async () => {
    const sendPatEmail = vi.fn().mockResolvedValue(undefined);
    const authAdmin = {
      createUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "a@b.com" } },
        error: null,
      }),
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
    };
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "access_tokens") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const client = {
      auth: { admin: authAdmin },
      from,
    } as unknown as SupabaseClient;

    const result = await registerUser(client, env, {
      email: "a@b.com",
      sendPatEmail,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("mfe_pat_");
    expect(sendPatEmail).toHaveBeenCalledOnce();
  });

  it("throws RegisterRateLimitedError when cooldown active", async () => {
    const recent = new Date().toISOString();
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "user-1", last_pat_sent_at: recent },
        error: null,
      }),
    }));
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: "user-1", email: "a@b.com" }] },
          }),
        },
      },
      from,
    } as unknown as SupabaseClient;

    await expect(
      registerUser(client, env, {
        email: "a@b.com",
        sendPatEmail: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RegisterRateLimitedError);
  });
});
