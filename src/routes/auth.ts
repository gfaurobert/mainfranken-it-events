import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import { registerEmailSchema } from "../schemas/auth.js";
import { registerUser, RegisterRateLimitedError } from "../services/register-user.js";

interface AuthRoutesOptions {
  supabase: SupabaseClient;
  env: Env;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    try {
      return await registerUser(opts.supabase, opts.env, {
        email: parsed.data.email,
      });
    } catch (error) {
      if (error instanceof RegisterRateLimitedError) {
        return reply.status(429).send({ error: error.message });
      }

      request.log.error(error);
      return reply.status(500).send({
        error: "Failed to register user",
      });
    }
  });
};
