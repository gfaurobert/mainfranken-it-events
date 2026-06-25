import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { rsvpStatusSchema } from "../schemas/auth.js";
import { EventNotFoundError } from "../services/get-event.js";
import { listMyRsvps } from "../services/list-my-rsvps.js";
import { removeRsvp } from "../services/remove-rsvp.js";
import { setRsvp } from "../services/set-rsvp.js";
import { buildRequirePatPreHandler } from "../plugins/require-pat.js";

const statusQuerySchema = z.object({
  status: rsvpStatusSchema.optional(),
});

const eventIdParamsSchema = z.object({
  event_id: z.string().uuid(),
});

const updateRsvpBodySchema = z.object({
  status: rsvpStatusSchema,
});

interface MeRsvpsRouteOptions {
  supabase: SupabaseClient;
}

export const meRsvpsRoutes: FastifyPluginAsync<MeRsvpsRouteOptions> = async (app, opts) => {
  const requirePat = buildRequirePatPreHandler(opts.supabase);

  app.get("/me/rsvps", { preHandler: requirePat }, async (request, reply) => {
    const parsed = statusQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    try {
      return await listMyRsvps(opts.supabase, request.userId!, parsed.data.status);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to list RSVPs" });
    }
  });

  app.put("/me/rsvps/:event_id", { preHandler: requirePat }, async (request, reply) => {
    const params = eventIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid event id",
        details: params.error.flatten(),
      });
    }

    const body = updateRsvpBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten(),
      });
    }

    try {
      return await setRsvp(opts.supabase, request.userId!, params.data.event_id, body.data.status);
    } catch (error) {
      if (error instanceof EventNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to set RSVP" });
    }
  });

  app.delete(
    "/me/rsvps/:event_id",
    { preHandler: requirePat },
    async (request, reply) => {
    const params = eventIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid event id",
        details: params.error.flatten(),
      });
    }

    try {
      await removeRsvp(opts.supabase, request.userId!, params.data.event_id);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to remove RSVP" });
    }
    },
  );
};
