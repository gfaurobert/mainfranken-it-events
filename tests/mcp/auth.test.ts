import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../src/lib/env.js";
import { authContext } from "../../src/lib/auth-context.js";
import { registerAuthTools } from "../../src/mcp/auth.js";
import { RegisterRateLimitedError } from "../../src/services/register-user.js";
import * as registerUserModule from "../../src/services/register-user.js";
import * as listMyRsvpsModule from "../../src/services/list-my-rsvps.js";
import * as removeRsvpModule from "../../src/services/remove-rsvp.js";
import * as setRsvpModule from "../../src/services/set-rsvp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

interface ToolHandler {
  (input: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
}

function setupAuthTools() {
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

  registerAuthTools(server, {} as SupabaseClient, {} as Env);
  return handlers;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mcp auth tools", () => {
  it("register_user is public and never includes PAT in text", async () => {
    vi.spyOn(registerUserModule, "registerUser").mockResolvedValue({
      ok: true,
      message: "Check your email",
    });
    const tools = setupAuthTools();

    const result = await tools.get("register_user")!({ email: "test@example.com" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("Check your email");
    expect(result.content[0]?.text).not.toContain("mfe_pat_");
  });

  it("register_user returns MCP error for rate limit", async () => {
    vi.spyOn(registerUserModule, "registerUser").mockRejectedValue(
      new RegisterRateLimitedError(),
    );
    const tools = setupAuthTools();

    const result = await tools.get("register_user")!({ email: "test@example.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Please wait");
  });

  it("protected tools return auth error without PAT context", async () => {
    const tools = setupAuthTools();

    const setResult = await tools.get("set_rsvp")!({
      event_id: "11111111-1111-4111-8111-111111111111",
      status: "going",
    });
    const listResult = await tools.get("list_my_rsvps")!({});
    const removeResult = await tools.get("remove_rsvp")!({
      event_id: "11111111-1111-4111-8111-111111111111",
    });

    expect(setResult.isError).toBe(true);
    expect(listResult.isError).toBe(true);
    expect(removeResult.isError).toBe(true);
    expect(setResult.content[0]?.text).toContain("Authentication required");
  });

  it("protected tools use authenticated context user id", async () => {
    vi.spyOn(setRsvpModule, "setRsvp").mockResolvedValue({
      event_id: "11111111-1111-4111-8111-111111111111",
      status: "going",
      updated_at: "2026-06-25T12:00:00.000Z",
    });
    vi.spyOn(listMyRsvpsModule, "listMyRsvps").mockResolvedValue({ rsvps: [], count: 0 });
    vi.spyOn(removeRsvpModule, "removeRsvp").mockResolvedValue(undefined);
    const tools = setupAuthTools();

    await authContext.run({ userId: "user-123" }, async () => {
      await tools.get("set_rsvp")!({
        event_id: "11111111-1111-4111-8111-111111111111",
        status: "going",
      });
      await tools.get("list_my_rsvps")!({});
      await tools.get("remove_rsvp")!({
        event_id: "11111111-1111-4111-8111-111111111111",
      });
    });

    expect(setRsvpModule.setRsvp).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "11111111-1111-4111-8111-111111111111",
      "going",
    );
    expect(listMyRsvpsModule.listMyRsvps).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      undefined,
    );
    expect(removeRsvpModule.removeRsvp).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
