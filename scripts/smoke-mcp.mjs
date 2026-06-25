const port = process.env.PORT ?? "3000";
const base = process.env.SMOKE_BASE_URL ?? `http://localhost:${port}`;

const initRes = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    },
  }),
});

if (!initRes.ok) {
  console.error("initialize failed", initRes.status, await initRes.text());
  process.exit(1);
}

const sessionId = initRes.headers.get("mcp-session-id");
console.log("MCP session:", sessionId ?? "(stateless)");
console.log("MCP smoke: initialize OK — connect with your MCP client for tool calls");
