import { describe, it, expect } from "vitest";
import {
  planDefaultRestore,
  normalizeTopicNameForMatch,
  findActiveNameConflict,
  TOPIC_NAME_PARITY_PAIRS,
} from "../index.js";

const row = (id: string, name: string, displayOrder: number) => ({ id, name, displayOrder });

describe("normalizeTopicNameForMatch", () => {
  it("trims and lowercases, nothing more", () => {
    expect(normalizeTopicNameForMatch("  Code Quality \t")).toBe("code quality");
    expect(normalizeTopicNameForMatch("Équipe")).not.toBe(normalizeTopicNameForMatch("equipe"));
    expect(normalizeTopicNameForMatch("é")).not.toBe(normalizeTopicNameForMatch("é"));
  });
});

describe("planDefaultRestore", () => {
  it("orders by prior display_order then id", () => {
    const plan = planDefaultRestore([row("c", "C", 5), row("a", "A", 4), row("b", "B", 2)], []);
    expect(plan.restore.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks ties by id", () => {
    const plan = planDefaultRestore([row("b", "B", 3), row("a", "A", 3)], []);
    expect(plan.restore.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("skips names matching active topics (case and whitespace)", () => {
    const plan = planDefaultRestore([row("a", "Code Quality", 1), row("b", "Other", 2)], ["code quality "]);
    expect(plan.restore.map((r) => r.id)).toEqual(["b"]);
    expect(plan.skipped).toEqual([{ id: "a", name: "Code Quality", reason: "NAME_ACTIVE" }]);
  });

  it("restores the first of two same-named defaults and skips the second", () => {
    const plan = planDefaultRestore([row("b", "delivery", 2), row("a", "Delivery", 1)], []);
    expect(plan.restore.map((r) => r.id)).toEqual(["a"]);
    expect(plan.skipped.map((r) => r.id)).toEqual(["b"]);
  });

  it("handles empty inputs and all-skipped", () => {
    expect(planDefaultRestore([], [])).toEqual({ restore: [], skipped: [] });
    const plan = planDefaultRestore([row("a", "A", 1)], ["a"]);
    expect(plan.restore).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("treats blank names as one normalized name", () => {
    const plan = planDefaultRestore([row("a", "", 1), row("b", "  ", 2)], []);
    expect(plan.restore.map((r) => r.id)).toEqual(["a"]);
    expect(plan.skipped.map((r) => r.id)).toEqual(["b"]);
  });

  it("is deterministic for stale, tied and negative positions", () => {
    const input = [row("d", "D", -3), row("c", "C", 7), row("b", "B", 7), row("a", "A", -3)];
    const first = planDefaultRestore(input, []);
    const second = planDefaultRestore([...input].reverse(), []);
    expect(first).toEqual(second);
    expect(first.restore.map((r) => r.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("does not mutate its input and keeps restore order for position assignment", () => {
    const input = [row("b", "B", 2), row("a", "A", 1)];
    const plan = planDefaultRestore(input, []);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
    const base = 10;
    const positions = plan.restore.map((r, i) => [r.id, base + 1 + i]);
    expect(positions).toEqual([["a", 11], ["b", 12]]);
  });
});

describe("name parity: findActiveNameConflict and planDefaultRestore agree on TOPIC_NAME_PARITY_PAIRS", () => {
  for (const { existing, candidate, duplicate } of TOPIC_NAME_PARITY_PAIRS) {
    it(`${JSON.stringify(existing)} vs ${JSON.stringify(candidate)} -> ${duplicate ? "duplicate" : "distinct"}`, () => {
      const finder = findActiveNameConflict([{ id: "x", name: existing, displayOrder: 1 }], candidate);
      expect(finder !== null).toBe(duplicate);
      const plan = planDefaultRestore([row("d", candidate, 9)], [existing]);
      expect(plan.skipped.length === 1).toBe(duplicate);
    });
  }
});
