const port = process.env.PORT ?? "3000";
const base = process.env.SMOKE_BASE_URL ?? `http://localhost:${port}`;

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function parseSseMessages(text) {
  const messages = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      messages.push(JSON.parse(line.slice(6)));
    }
  }
  return messages;
}

async function mcpRequest(body, sessionId) {
  const headers = { ...mcpHeaders };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    sessionId: res.headers.get("mcp-session-id") ?? sessionId,
    messages: parseSseMessages(text),
    raw: text,
  };
}

const init = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    },
  },
  null,
);

if (!init.ok) {
  console.error("initialize failed", init.status, init.raw);
  process.exit(1);
}

const sessionId = init.sessionId;
const initResult = init.messages.find((m) => m.id === 1)?.result;
if (!initResult?.serverInfo?.name) {
  console.error("initialize missing serverInfo", init.messages);
  process.exit(1);
}

console.log("MCP session:", sessionId);
console.log("MCP smoke: initialize OK —", initResult.serverInfo.name, initResult.serverInfo.version);

const initialized = await mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
if (initialized.status !== 202) {
  console.error("notifications/initialized failed", initialized.status, initialized.raw);
  process.exit(1);
}

const tools = await mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
const toolNames = tools.messages.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name) ?? [];
if (!toolNames.includes("search_events")) {
  console.error("tools/list missing search_events", tools.messages);
  process.exit(1);
}
console.log("MCP smoke: tools/list OK —", toolNames.join(", "));

const search = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_events",
      arguments: { city: "Würzburg" },
    },
  },
  sessionId,
);

const searchResult = search.messages.find((m) => m.id === 3)?.result;
const structured = searchResult?.structuredContent;
const events = structured?.events;
const count = structured?.count;

if (!Array.isArray(events) || typeof count !== "number") {
  console.error("search_events unexpected response", search.messages);
  process.exit(1);
}

if (count < 1) {
  console.error("search_events expected at least 1 Würzburg event, got", count);
  process.exit(1);
}

console.log(`MCP smoke: search_events OK — ${count} event(s), first: ${events[0].title}`);

const eventId = events[0].id;
const get = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "get_event",
      arguments: { id: eventId },
    },
  },
  sessionId,
);

const getResult = get.messages.find((m) => m.id === 4)?.result;
const event = getResult?.structuredContent?.event;
if (!event || event.id !== eventId) {
  console.error("get_event unexpected response", get.messages);
  process.exit(1);
}

console.log(`MCP smoke: get_event OK — ${event.title}`);
console.log("MCP smoke: all checks passed");
