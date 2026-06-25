import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer, isInitializeRequest } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env.js";
import { authContext } from "../lib/auth-context.js";
import { resolvePatFromHeader } from "../services/resolve-pat.js";
import { registerAuthTools, registerEventTools } from "./tools.js";

export function createMcpServer(supabase: SupabaseClient, env: Env) {
  const server = new McpServer({
    name: "mainfranken-it-events",
    version: "0.1.0",
  });
  registerEventTools(server, supabase);
  registerAuthTools(server, supabase, env);
  return server;
}

function jsonRpcError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply.status(status).send({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function getAuthorizationHeader(request: FastifyRequest): string | undefined {
  const { authorization } = request.headers;
  if (Array.isArray(authorization)) return authorization[0];
  return authorization;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  supabase: SupabaseClient,
  env: Env,
) {
  const transports = new Map<string, NodeStreamableHTTPServerTransport>();

  async function handleMcpPost(request: FastifyRequest, reply: FastifyReply) {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    const body = request.body;

    try {
      let transport: NodeStreamableHTTPServerTransport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          return jsonRpcError(reply, 404, -32001, "Session not found");
        }
      } else if (isInitializeRequest(body)) {
        transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) transports.delete(sid);
        };

        const mcpServer = createMcpServer(supabase, env);
        await mcpServer.connect(transport);
      } else {
        return jsonRpcError(reply, 400, -32000, "Bad Request: Session ID required");
      }

      reply.hijack();
      const userId = await resolvePatFromHeader(supabase, getAuthorizationHeader(request));
      await authContext.run({ userId: userId ?? undefined }, async () => {
        await transport.handleRequest(request.raw, reply.raw, body);
      });
    } catch (error) {
      request.log.error(error);
      if (!reply.raw.headersSent) {
        return jsonRpcError(reply, 500, -32603, "Internal server error");
      }
    }
  }

  async function handleMcpSessionRequest(request: FastifyRequest, reply: FastifyReply) {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      return reply.status(400).send("Missing session ID");
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      return reply.status(404).send("Session not found");
    }

    reply.hijack();
    const userId = await resolvePatFromHeader(supabase, getAuthorizationHeader(request));
    await authContext.run({ userId: userId ?? undefined }, async () => {
      await transport.handleRequest(request.raw, reply.raw);
    });
  }

  app.post("/mcp", handleMcpPost);
  app.get("/mcp", handleMcpSessionRequest);
  app.delete("/mcp", handleMcpSessionRequest);
}
