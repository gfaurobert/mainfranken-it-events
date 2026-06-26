import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { rsvpStatusSchema } from "../schemas/auth.js";
import { buildRequirePatPreHandler } from "../plugins/require-pat.js";
import { requestConnectionOtp } from "../services/request-connection-otp.js";
import { redeemConnectionOtp } from "../services/redeem-connection-otp.js";
import { listConnections } from "../services/list-connections.js";
import { listConnectionEvents } from "../services/list-connection-events.js";
import { removeConnection } from "../services/remove-connection.js";
import {
  ConnectionNameNotFoundError,
  ConnectionNotFoundError,
  ConnectionOtpRedeemRateLimitedError,
  ConnectionOtpRequestRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "../services/connection-errors.js";

const redeemBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const userIdParamsSchema = z.object({ user_id: z.string().uuid() });
const eventsQuerySchema = z.object({
  display_name: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  status: rsvpStatusSchema.optional(),
});

interface MeConnectionsRouteOptions {
  supabase: SupabaseClient;
}

function mapConnectionError(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidConnectionOtpError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof ExpiredConnectionOtpError) {
    return reply.status(410).send({ error: error.message });
  }
  if (error instanceof RedeemOwnOtpError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof ConnectionNameNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof ConnectionNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (
    error instanceof ConnectionOtpRequestRateLimitedError ||
    error instanceof ConnectionOtpRedeemRateLimitedError
  ) {
    return reply.status(429).send({ error: error.message });
  }
  return null;
}

export const meConnectionsRoutes: FastifyPluginAsync<MeConnectionsRouteOptions> = async (
  app,
  opts,
) => {
  const requirePat = buildRequirePatPreHandler(opts.supabase);

  app.post("/me/connections/otp", { preHandler: requirePat }, async (request, reply) => {
    try {
      return await requestConnectionOtp(opts.supabase, request.userId!);
    } catch (error) {
      const mapped = mapConnectionError(error, reply);
      if (mapped) return mapped;
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to request connection OTP" });
    }
  });

  app.post(
    "/me/connections/otp/redeem",
    { preHandler: requirePat },
    async (request, reply) => {
      const parsed = redeemBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }
      try {
        return await redeemConnectionOtp(opts.supabase, request.userId!, parsed.data.code);
      } catch (error) {
        const mapped = mapConnectionError(error, reply);
        if (mapped) return mapped;
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to redeem connection OTP" });
      }
    },
  );

  app.get("/me/connections", { preHandler: requirePat }, async (request, reply) => {
    try {
      return await listConnections(opts.supabase, request.userId!);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to list connections" });
    }
  });

  app.get("/me/connections/events", { preHandler: requirePat }, async (request, reply) => {
    const parsed = eventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }
    try {
      return await listConnectionEvents(opts.supabase, request.userId!, parsed.data);
    } catch (error) {
      const mapped = mapConnectionError(error, reply);
      if (mapped) return mapped;
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to list connection events" });
    }
  });

  app.delete(
    "/me/connections/:user_id",
    { preHandler: requirePat },
    async (request, reply) => {
      const parsed = userIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid user id",
          details: parsed.error.flatten(),
        });
      }
      try {
        await removeConnection(opts.supabase, request.userId!, parsed.data.user_id);
        return { ok: true };
      } catch (error) {
        const mapped = mapConnectionError(error, reply);
        if (mapped) return mapped;
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to remove connection" });
      }
    },
  );
};
