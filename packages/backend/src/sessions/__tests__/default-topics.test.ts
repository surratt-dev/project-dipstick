import { describe, it, expect } from "vitest";
import { canonicalDefaultsWhere } from "../default-topics.js";

describe("canonicalDefaultsWhere (#215 D1)", () => {
  it("emits the exact predicate for the content.ts alias", () => {
    expect(canonicalDefaultsWhere("dt", 2)).toBe(
      "dt.team_id = $2 AND dt.is_default = true AND dt.status = 'active'",
    );
  });

  it("emits the exact predicate for the copy's unaliased table", () => {
    expect(canonicalDefaultsWhere("topics", 2)).toBe(
      "topics.team_id = $2 AND topics.is_default = true AND topics.status = 'active'",
    );
  });

  it.each([0, 1.5, NaN])("throws for paramIndex %s", (n) => {
    expect(() => canonicalDefaultsWhere("dt", n)).toThrow();
  });
});
