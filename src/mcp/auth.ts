import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import type { Env } from "../lib/env.js";
import { requireAuthUserId, getRequestLog } from "../lib/auth-context.js";
import { registerEmailSchema, rsvpStatusSchema } from "../schemas/auth.js";
import { RegisterRateLimitedError, registerUser } from "../services/register-user.js";
import { listMyRsvps } from "../services/list-my-rsvps.js";
import { removeRsvp } from "../services/remove-rsvp.js";
import { EventNotFoundError } from "../services/get-event.js";
import { setRsvp } from "../services/set-rsvp.js";

const setRsvpInputSchema = z.object({
  event_id: z.string().uuid(),
  status: rsvpStatusSchema,
});

const listMyRsvpsInputSchema = z.object({
  status: rsvpStatusSchema.optional(),
});

const removeRsvpInputSchema = z.object({
  event_id: z.string().uuid(),
});

function authErrorResult(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  if (!error.message.startsWith("Authentication required")) return undefined;

  return {
    content: [{ type: "text" as const, text: error.message }],
    isError: true,
  };
}

export function registerAuthTools(server: McpServer, supabase: SupabaseClient, env: Env) {
  server.registerTool(
    "register_user",
    {
      title: "Register user for MCP PAT",
      description:
        "Request a personal access token by email. For security reasons, the token is sent via email and is never returned by this tool.",
      inputSchema: registerEmailSchema,
    },
    async ({ email }) => {
      try {
        const result = await registerUser(supabase, env, {
          email,
          log: getRequestLog(),
        });
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof RegisterRateLimitedError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "set_rsvp",
    {
      title: "Set my RSVP",
      description: "Set your RSVP status for an event (interested or going). Requires PAT auth.",
      inputSchema: setRsvpInputSchema,
    },
    async ({ event_id, status }) => {
      try {
        const userId = requireAuthUserId();
        const result = await setRsvp(supabase, userId, event_id, status);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
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

  server.registerTool(
    "list_my_rsvps",
    {
      title: "List my RSVPs",
      description: "List your RSVPs and related event summaries. Requires PAT auth.",
      inputSchema: listMyRsvpsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => {
      try {
        const userId = requireAuthUserId();
        const result = await listMyRsvps(supabase, userId, status);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        throw error;
      }
    },
  );

  server.registerTool(
    "remove_rsvp",
    {
      title: "Remove my RSVP",
      description: "Remove your RSVP for an event. Requires PAT auth.",
      inputSchema: removeRsvpInputSchema,
    },
    async ({ event_id }) => {
      try {
        const userId = requireAuthUserId();
        await removeRsvp(supabase, userId, event_id);
        return {
          content: [{ type: "text", text: "RSVP removed." }],
          structuredContent: { ok: true },
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        throw error;
      }
    },
  );
}
