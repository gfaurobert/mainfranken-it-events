import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import { generatePat, hashPat, patLookup } from "../lib/pat.js";
import { sendPatEmail, createSmtpTransport } from "./send-pat-email.js";

export class RegisterRateLimitedError extends Error {
  constructor() {
    super("Please wait before requesting another token");
    this.name = "RegisterRateLimitedError";
  }
}

interface RegisterUserDeps {
  email: string;
  sendPatEmail?: (input: {
    to: string;
    pat: string;
    isRenewal: boolean;
  }) => Promise<void>;
}

export async function registerUser(
  supabase: SupabaseClient,
  env: Env,
  deps: RegisterUserDeps,
) {
  const email = deps.email.trim().toLowerCase();
  const isRenewal = await findExistingUserId(supabase, email);

  if (isRenewal) {
    await assertCooldown(supabase, isRenewal, env.REGISTER_EMAIL_COOLDOWN_SECONDS);
  }

  const userId = isRenewal ?? (await createAuthUser(supabase, email));
  const displayName = email.split("@")[0] ?? email;

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    display_name: displayName,
    last_pat_sent_at: new Date().toISOString(),
  });
  if (profileError) throw profileError;

  await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);

  const pat = generatePat();
  const { error: tokenError } = await supabase.from("access_tokens").insert({
    user_id: userId,
    token_lookup: patLookup(pat),
    token_hash: await hashPat(pat),
    label: "agent",
  });
  if (tokenError) throw tokenError;

  const deliver =
    deps.sendPatEmail ??
    (async (input) => {
      const transport = createSmtpTransport(env);
      await sendPatEmail(transport, env, input);
    });

  await deliver({ to: email, pat, isRenewal: Boolean(isRenewal) });

  return {
    ok: true as const,
    message:
      "If this email address is valid, you will receive an agent token shortly. " +
      "Add it to your MCP config as: Authorization: Bearer <token>",
  };
}

async function findExistingUserId(
  supabase: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  return user?.id ?? null;
}

async function createAuthUser(supabase: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;
  if (!data.user) throw new Error("Failed to create user");
  return data.user.id;
}

async function assertCooldown(
  supabase: SupabaseClient,
  userId: string,
  cooldownSeconds: number,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("last_pat_sent_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.last_pat_sent_at) return;

  const elapsed = Date.now() - new Date(data.last_pat_sent_at).getTime();
  if (elapsed < cooldownSeconds * 1000) {
    throw new RegisterRateLimitedError();
  }
}
