import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authContext } from "../../src/lib/auth-context.js";
import { registerConnectionTools } from "../../src/mcp/connections.js";
import { InvalidConnectionOtpError } from "../../src/services/connection-errors.js";
import * as listConnectionsModule from "../../src/services/list-connections.js";
import * as redeemConnectionOtpModule from "../../src/services/redeem-connection-otp.js";
import * as requestConnectionOtpModule from "../../src/services/request-connection-otp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

interface ToolHandler {
  (input: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
}

function setupConnectionTools() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        _definition: unknown,
        handler: ToolHandler,
      ) => {
        handlers.set(name, handler);
      },
    ),
  } as unknown as McpServer;

  registerConnectionTools(server, {} as SupabaseClient);
  return handlers;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mcp connection tools", () => {
  it("request_connection_otp requires auth", async () => {
    const tools = setupConnectionTools();

    const result = await tools.get("request_connection_otp")!({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Authentication required");
  });

  it("redeem_connection_otp maps InvalidConnectionOtpError to isError", async () => {
    vi.spyOn(redeemConnectionOtpModule, "redeemConnectionOtp").mockRejectedValue(
      new InvalidConnectionOtpError(),
    );
    const tools = setupConnectionTools();

    const result = await authContext.run({ userId: "user-123" }, async () =>
      tools.get("redeem_connection_otp")!({ code: "123456" }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Code not found");
  });

  it("protected tools use authenticated context user id", async () => {
    vi.spyOn(requestConnectionOtpModule, "requestConnectionOtp").mockResolvedValue({
      code: "123456",
      expires_at: "2026-06-25T12:15:00.000Z",
    });
    vi.spyOn(listConnectionsModule, "listConnections").mockResolvedValue({
      connections: [],
      count: 0,
    });
    const tools = setupConnectionTools();

    let otpResult: Awaited<ReturnType<ToolHandler>> | undefined;
    await authContext.run({ userId: "user-123" }, async () => {
      otpResult = await tools.get("request_connection_otp")!({});
      await tools.get("list_connections")!({});
    });

    expect(otpResult?.content[0]?.text).toContain("123456");
    expect(otpResult?.content[0]?.text).not.toContain("[object Object]");
    expect(otpResult?.structuredContent?.message).toContain("123456");

    expect(requestConnectionOtpModule.requestConnectionOtp).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
    );
    expect(listConnectionsModule.listConnections).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
    );
  });
});
