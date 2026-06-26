import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectionOtpLookup,
  generateConnectionOtpCode,
  hashConnectionOtp,
} from "../lib/connection-otp.js";
import type { RequestConnectionOtpResult } from "../types/connection.js";
import { ConnectionOtpRequestRateLimitedError } from "./connection-errors.js";

const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_OTPS_PER_HOUR = 5;

export async function requestConnectionOtp(
  supabase: SupabaseClient,
  issuerId: string,
): Promise<RequestConnectionOtpResult> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("connection_otps")
    .select("id", { count: "exact", head: true })
    .eq("issuer_id", issuerId)
    .gte("created_at", oneHourAgo);

  if (countError) throw countError;
  if ((count ?? 0) >= MAX_OTPS_PER_HOUR) {
    throw new ConnectionOtpRequestRateLimitedError();
  }

  const { error: invalidateError } = await supabase
    .from("connection_otps")
    .update({ used_at: new Date().toISOString() })
    .eq("issuer_id", issuerId)
    .is("used_at", null);

  if (invalidateError) throw invalidateError;

  const code = generateConnectionOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { error: insertError } = await supabase.from("connection_otps").insert({
    issuer_id: issuerId,
    code_lookup: connectionOtpLookup(code),
    code_hash: await hashConnectionOtp(code),
    expires_at: expiresAt,
  });

  if (insertError) throw insertError;

  return { code, expires_at: expiresAt };
}
