import type { SupabaseClient } from "@supabase/supabase-js";
import type { RsvpStatus } from "../types/rsvp.js";
import { getEvent } from "./get-event.js";

export interface SetRsvpResult {
  event_id: string;
  status: RsvpStatus;
  updated_at: string;
}

export async function setRsvp(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  status: RsvpStatus,
): Promise<SetRsvpResult> {
  await getEvent(supabase, eventId);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("rsvps")
    .upsert(
      { user_id: userId, event_id: eventId, status, updated_at: now },
      { onConflict: "user_id,event_id" },
    )
    .select("event_id, status, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data as SetRsvpResult;
}
