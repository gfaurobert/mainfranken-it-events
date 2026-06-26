import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_EVENT_COLUMNS } from "../schemas/search.js";
import type { Event, GetEventResult } from "../types/event.js";

export class EventNotFoundError extends Error {
  constructor(id: string) {
    super(`Event not found: ${id}`);
    this.name = "EventNotFoundError";
  }
}

export async function getEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<GetEventResult> {
  const { data, error } = await supabase
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new EventNotFoundError(id);
  }

  return { event: data as Event };
}
