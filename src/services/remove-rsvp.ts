import type { SupabaseClient } from "@supabase/supabase-js";

export async function removeRsvp(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await supabase
    .from("rsvps")
    .delete()
    .eq("user_id", userId)
    .eq("event_id", eventId);

  if (error) {
    throw error;
  }
}
