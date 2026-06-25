import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_EVENT_COLUMNS } from "../schemas/search.js";
import type { Event, SearchEventsParams, SearchEventsResult } from "../types/event.js";

function escapePostgrestFilterValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export async function searchEvents(
  supabase: SupabaseClient,
  params: SearchEventsParams,
): Promise<SearchEventsResult> {
  const limit = params.limit ?? 20;

  let query = supabase.from("events").select(PUBLIC_EVENT_COLUMNS);

  if (params.query) {
    const pattern = escapePostgrestFilterValue(`%${params.query}%`);
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (params.date_from) {
    query = query.gte("starts_at", params.date_from);
  }
  if (params.date_to) {
    query = query.lte("starts_at", params.date_to);
  }
  if (params.city) {
    query = query.ilike("city", params.city);
  }
  if (params.tags?.length) {
    query = query.overlaps("tags", params.tags);
  }
  if (params.is_free !== undefined) {
    query = query.eq("is_free", params.is_free);
  }

  const { data, error } = await query
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }

  const events = (data ?? []) as Event[];
  return { events, count: events.length };
}
