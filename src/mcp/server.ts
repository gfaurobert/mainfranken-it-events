import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerEventTools } from "./tools.js";

export function createMcpServer(supabase: SupabaseClient) {
  const server = new McpServer({
    name: "mainfranken-it-events",
    version: "0.1.0",
  });
  registerEventTools(server, supabase);
  return server;
}

export async function registerMcpRoutes(app: FastifyInstance, supabase: SupabaseClient) {
  const mcpServer = createMcpServer(supabase);
  const transports = new Map<string, NodeStreamableHTTPServerTransport>();

  app.post("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      await mcpServer.connect(transport);
    }

    reply.raw.on("close", () => {
      if (sessionId) {
        transports.delete(sessionId);
      }
      transport?.close();
    });

    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  app.get("/mcp", async (_request, reply) => {
    return reply.status(405).send({ error: "Method not allowed" });
  });

  app.delete("/mcp", async (_request, reply) => {
    return reply.status(405).send({ error: "Method not allowed" });
  });
}
