import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { requireAuthUserId } from "../lib/auth-context.js";
import { rsvpStatusSchema } from "../schemas/auth.js";
import {
  ConnectionNameNotFoundError,
  ConnectionNotFoundError,
  ConnectionOtpRedeemRateLimitedError,
  ConnectionOtpRequestRateLimitedError,
  ExpiredConnectionOtpError,
  InvalidConnectionOtpError,
  RedeemOwnOtpError,
} from "../services/connection-errors.js";
import { listConnectionEvents } from "../services/list-connection-events.js";
import { listConnections } from "../services/list-connections.js";
import { redeemConnectionOtp } from "../services/redeem-connection-otp.js";
import { removeConnection } from "../services/remove-connection.js";
import { requestConnectionOtp } from "../services/request-connection-otp.js";

const redeemConnectionOtpInputSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const listConnectionEventsInputSchema = z.object({
  display_name: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  status: rsvpStatusSchema.optional(),
});

const removeConnectionInputSchema = z.object({
  user_id: z.string().uuid(),
});

const emptyInputSchema = z.object({});

function formatConnectionOtpMessage(code: string, expiresAt: string) {
  return `Share this code with your friend: ${code} (expires ${expiresAt})`;
}

function authErrorResult(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  if (!error.message.startsWith("Authentication required")) return undefined;

  return {
    content: [{ type: "text" as const, text: error.message }],
    isError: true,
  };
}

function connectionErrorResult(error: unknown) {
  if (
    error instanceof InvalidConnectionOtpError ||
    error instanceof ExpiredConnectionOtpError ||
    error instanceof RedeemOwnOtpError ||
    error instanceof ConnectionNameNotFoundError ||
    error instanceof ConnectionNotFoundError ||
    error instanceof ConnectionOtpRequestRateLimitedError ||
    error instanceof ConnectionOtpRedeemRateLimitedError
  ) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  return undefined;
}

export function registerConnectionTools(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "request_connection_otp",
    {
      title: "Request connection code",
      description:
        "Generate a 6-digit code to share with a friend so they can connect with you. Requires PAT auth.",
      inputSchema: emptyInputSchema,
    },
    async () => {
      try {
        const userId = requireAuthUserId();
        const result = await requestConnectionOtp(supabase, userId);
        const message = formatConnectionOtpMessage(result.code, result.expires_at);
        const structuredContent = { message, code: result.code, expires_at: result.expires_at };
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "redeem_connection_otp",
    {
      title: "Redeem connection code",
      description:
        "Redeem a 6-digit code from a friend to connect with them. Requires PAT auth.",
      inputSchema: redeemConnectionOtpInputSchema,
    },
    async ({ code }) => {
      try {
        const userId = requireAuthUserId();
        const result = await redeemConnectionOtp(supabase, userId, code);
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "list_connections",
    {
      title: "List my connections",
      description: "List users you are connected with. Requires PAT auth.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const userId = requireAuthUserId();
        const result = await listConnections(supabase, userId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "list_connection_events",
    {
      title: "List connection events",
      description:
        "List upcoming events your connections are attending. Optionally filter by display name, date range, or RSVP status. Requires PAT auth.",
      inputSchema: listConnectionEventsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const userId = requireAuthUserId();
        const result = await listConnectionEvents(supabase, userId, input);

        if (result.ambiguous && result.matches) {
          const matchList = result.matches
            .map((m) => `- ${m.display_name ?? m.user_id} (${m.user_id})`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Multiple connections match that name. Please pick one by user_id:\n${matchList}`,
              },
            ],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );

  server.registerTool(
    "remove_connection",
    {
      title: "Remove connection",
      description: "Remove a connection with another user. Requires PAT auth.",
      inputSchema: removeConnectionInputSchema,
    },
    async ({ user_id }) => {
      try {
        const userId = requireAuthUserId();
        await removeConnection(supabase, userId, user_id);
        return {
          content: [{ type: "text", text: "Connection removed." }],
          structuredContent: { ok: true },
        };
      } catch (error) {
        const authError = authErrorResult(error);
        if (authError) return authError;
        const connError = connectionErrorResult(error);
        if (connError) return connError;
        throw error;
      }
    },
  );
}
