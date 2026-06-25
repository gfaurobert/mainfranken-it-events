import { describe, expect, it } from "vitest";
import { searchEventsQuerySchema } from "../../src/schemas/search.js";

describe("searchEventsQuerySchema", () => {
  it("parses comma-separated tags and applies defaults", () => {
    const result = searchEventsQuerySchema.parse({
      city: "Würzburg",
      tags: "python,meetup",
      limit: "10",
    });
    expect(result.city).toBe("Würzburg");
    expect(result.tags).toEqual(["python", "meetup"]);
    expect(result.limit).toBe(10);
  });

  it("rejects limit above 50", () => {
    expect(() => searchEventsQuerySchema.parse({ limit: "99" })).toThrow();
  });
});
