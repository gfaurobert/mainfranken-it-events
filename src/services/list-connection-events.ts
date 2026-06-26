import type { SupabaseClient } from "@supabase/supabase-js";
import type { RsvpStatus } from "../types/rsvp.js";
import type { ConnectionEventItem, ListConnectionEventsResult } from "../types/connection.js";
import { ConnectionNameNotFoundError } from "./connection-errors.js";
import { listConnections } from "./list-connections.js";

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

export interface ListConnectionEventsParams {
  display_name?: string;
  date_from?: string;
  date_to?: string;
  status?: RsvpStatus;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function defaultDateTo() {
  return new Date(Date.now() + SIX_MONTHS_MS).toISOString();
}

export async function listConnectionEvents(
  supabase: SupabaseClient,
  userId: string,
  params: ListConnectionEventsParams = {},
): Promise<ListConnectionEventsResult> {
  const { connections } = await listConnections(supabase, userId);

  let targetConnections = connections;

  if (params.display_name) {
    const needle = normalizeName(params.display_name);
    const matches = connections.filter((c) =>
      (c.display_name ?? "").toLowerCase().includes(needle),
    );

    if (matches.length === 0) {
      throw new ConnectionNameNotFoundError(params.display_name);
    }

    if (matches.length > 1) {
      return {
        events: [],
        count: 0,
        ambiguous: true,
        matches: matches.map((m) => ({
          user_id: m.user_id,
          display_name: m.display_name,
        })),
      };
    }

    targetConnections = matches;
  }

  const targetUserIds = targetConnections.map((c) => c.user_id);
  const displayNameById = new Map(targetConnections.map((c) => [c.user_id, c.display_name]));

  const dateFromMs = new Date(params.date_from ?? new Date().toISOString()).getTime();
  const dateToMs = new Date(params.date_to ?? defaultDateTo()).getTime();

  let query = supabase
    .from("rsvps")
    .select("user_id, status, event:events(id, title, starts_at, city)")
    .in("user_id", targetUserIds);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const events: ConnectionEventItem[] = (data ?? [])
    .filter((row) => row.event)
    .map((row) => ({
      event: row.event as ConnectionEventItem["event"],
      attendee: {
        user_id: row.user_id,
        display_name: displayNameById.get(row.user_id) ?? null,
        status: row.status as RsvpStatus,
      },
    }))
    .filter((item) => {
      const startsAt = new Date(item.event.starts_at).getTime();
      return startsAt >= dateFromMs && startsAt <= dateToMs;
    })
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));

  return { events, count: events.length };
}
