import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalConnectionPair } from "../lib/canonical-connection-pair.js";
import { connectionOtpLookup, verifyConnectionOtp } from "../lib/connection-otp.js";
import type { RedeemConnectionOtpResult } from "../types/connection.js";
import {
  ConnectionOtpRedeemRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "./connection-errors.js";

const MAX_FAILED_REDEEMS_PER_MINUTE = 5;
const REDEEM_WINDOW_MS = 60_000;

const failedRedeemAttempts = new Map<string, { count: number; windowStart: number }>();

export function resetRedeemRateLimitsForTests() {
  failedRedeemAttempts.clear();
}

function recordFailedRedeem(redeemerId: string) {
  const now = Date.now();
  const entry = failedRedeemAttempts.get(redeemerId);
  if (!entry || now - entry.windowStart > REDEEM_WINDOW_MS) {
    failedRedeemAttempts.set(redeemerId, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
}

function assertRedeemRateLimit(redeemerId: string) {
  const entry = failedRedeemAttempts.get(redeemerId);
  if (entry && Date.now() - entry.windowStart <= REDEEM_WINDOW_MS) {
    if (entry.count >= MAX_FAILED_REDEEMS_PER_MINUTE) {
      throw new ConnectionOtpRedeemRateLimitedError();
    }
  }
}

async function getDisplayName(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.display_name ?? null;
}

export async function redeemConnectionOtp(
  supabase: SupabaseClient,
  redeemerId: string,
  code: string,
): Promise<RedeemConnectionOtpResult> {
  assertRedeemRateLimit(redeemerId);

  const { data: otpRow, error: lookupError } = await supabase
    .from("connection_otps")
    .select("id, issuer_id, code_hash, expires_at, used_at")
    .eq("code_lookup", connectionOtpLookup(code))
    .is("used_at", null)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (!otpRow) {
    recordFailedRedeem(redeemerId);
    throw new InvalidConnectionOtpError();
  }

  if (!(await verifyConnectionOtp(code, otpRow.code_hash))) {
    recordFailedRedeem(redeemerId);
    throw new InvalidConnectionOtpError();
  }

  if (new Date(otpRow.expires_at).getTime() <= Date.now()) {
    recordFailedRedeem(redeemerId);
    throw new ExpiredConnectionOtpError();
  }

  if (otpRow.issuer_id === redeemerId) {
    throw new RedeemOwnOtpError();
  }

  const pair = canonicalConnectionPair(otpRow.issuer_id, redeemerId);

  const { data: existing, error: existingError } = await supabase
    .from("connections")
    .select("user_a, user_b")
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b)
    .maybeSingle();

  if (existingError) throw existingError;

  const issuerDisplayName = await getDisplayName(supabase, otpRow.issuer_id);

  if (!existing) {
    const { error: insertError } = await supabase.from("connections").insert(pair);
    if (insertError) throw insertError;
  }

  const { error: markUsedError } = await supabase
    .from("connection_otps")
    .update({ used_at: new Date().toISOString(), used_by: redeemerId })
    .eq("id", otpRow.id);

  if (markUsedError) throw markUsedError;

  const message = existing
    ? `You're already connected with ${issuerDisplayName ?? "this user"}.`
    : `You're now connected with ${issuerDisplayName ?? "this user"}.`;

  return {
    connection: { user_id: otpRow.issuer_id, display_name: issuerDisplayName },
    message,
  };
}
