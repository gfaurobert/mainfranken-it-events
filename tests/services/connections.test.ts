import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionNameNotFoundError,
  ConnectionNotFoundError,
} from "../../src/services/connection-errors.js";
import { listConnectionEvents } from "../../src/services/list-connection-events.js";
import * as listConnectionsModule from "../../src/services/list-connections.js";
import { listConnections } from "../../src/services/list-connections.js";
import { removeConnection } from "../../src/services/remove-connection.js";

describe("listConnections", () => {
  it("returns connected users with display names", async () => {
    const rows = [
      { user_a: "me", user_b: "friend-1", created_at: "2026-06-26T10:00:00.000Z" },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "friend-1", display_name: "Martin" }],
        error: null,
      }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "connections") return chain;
        if (table === "profiles") return profileChain;
        throw new Error(table);
      }),
    } as unknown as SupabaseClient;

    const result = await listConnections(client, "me");

    expect(result.count).toBe(1);
    expect(result.connections[0]?.display_name).toBe("Martin");
  });
});

describe("listConnectionEvents", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ambiguous matches without events", async () => {
    vi.spyOn(listConnectionsModule, "listConnections").mockResolvedValue({
      connections: [
        { user_id: "u1", display_name: "Martin Müller", connected_at: "t" },
        { user_id: "u2", display_name: "Martin Schmidt", connected_at: "t" },
      ],
      count: 2,
    });

    const client = {} as SupabaseClient;
    const result = await listConnectionEvents(client, "me", { display_name: "Martin" });

    expect(result.ambiguous).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.events).toHaveLength(0);
  });

  it("throws when name not found", async () => {
    vi.spyOn(listConnectionsModule, "listConnections").mockResolvedValue({
      connections: [{ user_id: "u1", display_name: "Anna", connected_at: "t" }],
      count: 1,
    });

    await expect(
      listConnectionEvents({} as SupabaseClient, "me", { display_name: "Martin" }),
    ).rejects.toBeInstanceOf(ConnectionNameNotFoundError);
  });
});

describe("removeConnection", () => {
  it("deletes canonical connection row", async () => {
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ user_a: "a", user_b: "b" }], error: null }),
    };
    chain.eq = vi
      .fn()
      .mockReturnValueOnce(chain)
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ data: [{ user_a: "a", user_b: "b" }], error: null });

    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await removeConnection(client, "a", "b");
    expect(chain.delete).toHaveBeenCalledOnce();
  });

  it("throws when not connected", async () => {
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    chain.eq = vi.fn().mockReturnValue(chain);

    const client = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    await expect(removeConnection(client, "a", "c")).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });
});
