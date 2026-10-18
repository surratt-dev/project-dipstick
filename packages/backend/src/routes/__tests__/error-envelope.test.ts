import { describe, it, expect } from "vitest";
import { buildErrorEnvelope } from "../error-envelope.js";

describe("buildErrorEnvelope", () => {
  it("without extra is byte-identical to the pre-#299 shape (key set and order)", () => {
    const e = buildErrorEnvelope("precondition_failed", "m", "C");
    expect(Object.keys(e.error)).toEqual(["category", "code", "message", "correlationId"]);
    const f = buildErrorEnvelope("invalid_request", "m", "C", "name");
    expect(Object.keys(f.error)).toEqual(["category", "code", "field", "message", "correlationId"]);
    expect(Object.keys(buildErrorEnvelope("not_found", "m").error)).toEqual(["category", "message", "correlationId"]);
  });

  it("adds extras and never lets them overwrite the base keys", () => {
    const e = buildErrorEnvelope("precondition_failed", "real", "REAL", undefined, {
      conflictingTopicId: "t1",
      conflictingName: "",
      category: "forbidden",
      code: "EVIL",
      message: "evil",
      correlationId: "evil",
    });
    expect(e.error.conflictingTopicId).toBe("t1");
    expect(e.error.conflictingName).toBe("");
    expect(e.error.category).toBe("precondition_failed");
    expect(e.error.code).toBe("REAL");
    expect(e.error.message).toBe("real");
    expect(e.error.correlationId).not.toBe("evil");
  });
});
