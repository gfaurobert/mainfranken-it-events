import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { searchEvents } from "../services/search-events.js";
import { EventNotFoundError, getEvent } from "../services/get-event.js";

const searchInputSchema = z.object({
  query: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  city: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_free: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function registerEventTools(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "search_events",
    {
      title: "Search Mainfranken IT events",
      description:
        "Search upcoming IT events in the Mainfranken region (Würzburg, Aschaffenburg, Schweinfurt, etc.). " +
        "Filter by keywords, city, date range, tags, and free/paid. Returns up to 50 events.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const result = await searchEvents(supabase, input);
      const text =
        result.count === 0
          ? "No events found for the given filters."
          : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event by ID",
      description: "Fetch full details for a single event by UUID.",
      inputSchema: z.object({ id: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const result = await getEvent(supabase, id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof EventNotFoundError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }
        throw error;
      }
    },
  );
}
