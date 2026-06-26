import { describe, expect, it } from "vitest";
import { formatServiceError } from "../../src/lib/format-service-error.js";

describe("formatServiceError", () => {
  it("returns Error message", () => {
    expect(formatServiceError(new Error("boom"))).toBe("boom");
  });

  it("returns PostgREST-style object message", () => {
    expect(
      formatServiceError({
        code: "PGRST204",
        message: "Could not find the 'code_hash' column",
      }),
    ).toBe("Could not find the 'code_hash' column");
  });

  it("does not return [object Object]", () => {
    expect(
      formatServiceError({ code: "PGRST204", message: "schema cache stale" }),
    ).not.toBe("[object Object]");
  });
});
