import type { FastifyPluginAsync } from "fastify";
import type { preHandlerHookHandler } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePatFromHeader } from "../services/resolve-pat.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

interface RequirePatPluginOptions {
  supabase: SupabaseClient;
}

export function buildRequirePatPreHandler(
  supabase: SupabaseClient,
): preHandlerHookHandler {
  return async (request, reply) => {
    const userId = await resolvePatFromHeader(supabase, request.headers.authorization);
    if (!userId) {
      return reply.status(401).send({
        error: "Authentication required",
        message: "Provide Authorization: Bearer <pat> or call POST /auth/register",
      });
    }
    request.userId = userId;
  };
}

export const requirePatPlugin: FastifyPluginAsync<RequirePatPluginOptions> = async (
  app,
  opts,
) => {
  app.addHook("preHandler", buildRequirePatPreHandler(opts.supabase));
};
