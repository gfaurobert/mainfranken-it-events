import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalConnectionPair } from "../lib/canonical-connection-pair.js";
import { ConnectionNotFoundError } from "./connection-errors.js";

export async function removeConnection(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string,
): Promise<void> {
  const pair = canonicalConnectionPair(userId, otherUserId);

  const { data, error } = await supabase
    .from("connections")
    .delete()
    .eq("user_a", pair.user_a)
    .eq("user_b", pair.user_b)
    .select("user_a");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ConnectionNotFoundError();
  }
}
