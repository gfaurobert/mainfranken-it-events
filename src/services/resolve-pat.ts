import type { SupabaseClient } from "@supabase/supabase-js";
import { isPatFormat, patLookup, verifyPat } from "../lib/pat.js";

export async function resolvePatFromHeader(
  supabase: SupabaseClient,
  authorization: string | undefined,
): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const pat = authorization.slice("Bearer ".length).trim();
  if (!isPatFormat(pat)) return null;

  const { data, error } = await supabase
    .from("access_tokens")
    .select("user_id, token_hash")
    .eq("token_lookup", patLookup(pat))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!(await verifyPat(pat, data.token_hash))) return null;
  return data.user_id;
}
