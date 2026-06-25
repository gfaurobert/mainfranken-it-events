import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchEventsQuerySchema, eventIdParamSchema } from "../schemas/search.js";
import { searchEvents } from "../services/search-events.js";
import { EventNotFoundError, getEvent } from "../services/get-event.js";

interface EventsRouteOptions {
  supabase: SupabaseClient;
}

export const eventsRoutes: FastifyPluginAsync<EventsRouteOptions> = async (app, opts) => {
  app.get("/events", async (request, reply) => {
    const parsed = searchEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    try {
      const result = await searchEvents(opts.supabase, parsed.data);
      return result;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to search events" });
    }
  });

  app.get("/events/:id", async (request, reply) => {
    const parsed = eventIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid event id",
        details: parsed.error.flatten(),
      });
    }

    try {
      return await getEvent(opts.supabase, parsed.data.id);
    } catch (error) {
      if (error instanceof EventNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch event" });
    }
  });
};
