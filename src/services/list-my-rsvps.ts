import type { SupabaseClient } from "@supabase/supabase-js";
import type { RsvpStatus, RsvpWithEvent } from "../types/rsvp.js";

export interface ListMyRsvpsResult {
  rsvps: RsvpWithEvent[];
  count: number;
}

export async function listMyRsvps(
  supabase: SupabaseClient,
  userId: string,
  status?: RsvpStatus,
): Promise<ListMyRsvpsResult> {
  let query = supabase
    .from("rsvps")
    .select("event_id, status, updated_at, event:events(id, title, starts_at, city)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rsvps = (data ?? []) as RsvpWithEvent[];
  return { rsvps, count: rsvps.length };
}
