import type { SupabaseClient } from "@supabase/supabase-js";
import { otherConnectionUserId } from "../lib/canonical-connection-pair.js";
import type { ConnectionSummary } from "../types/connection.js";

export interface ListConnectionsResult {
  connections: ConnectionSummary[];
  count: number;
}

export async function listConnections(
  supabase: SupabaseClient,
  userId: string,
): Promise<ListConnectionsResult> {
  const { data: rows, error } = await supabase
    .from("connections")
    .select("user_a, user_b, created_at")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (error) throw error;

  const otherUserIds = (rows ?? []).map((row) =>
    otherConnectionUserId(userId, row.user_a, row.user_b),
  );

  if (otherUserIds.length === 0) {
    return { connections: [], count: 0 };
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", otherUserIds);

  if (profileError) throw profileError;

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const connections: ConnectionSummary[] = (rows ?? []).map((row) => {
    const otherId = otherConnectionUserId(userId, row.user_a, row.user_b);
    return {
      user_id: otherId,
      display_name: profileById.get(otherId) ?? null,
      connected_at: row.created_at,
    };
  });

  return { connections, count: connections.length };
}
