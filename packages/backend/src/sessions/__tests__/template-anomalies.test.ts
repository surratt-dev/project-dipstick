import { describe, it, expect } from "vitest";
import { detectTemplateAnomalies, type TemplateTopicFact } from "../template-anomalies.js";

// harden-team-creation-topic-copy (#215) tasks.md 6.2.

// Ids sort by their numeric suffix so canonical order is easy to read.
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = (n: number, order: number, over: Partial<TemplateTopicFact> = {}): TemplateTopicFact => ({
  id: id(n),
  is_default: true,
  status: "active",
  display_order: order,
  ...over,
});
const healthy = Array.from({ length: 12 }, (_, i) => row(i + 1, i + 1));

describe("detectTemplateAnomalies", () => {
  const table: Array<{ label: string; facts: TemplateTopicFact[]; anomalies: string[]; topicIds: string[] }> = [
    { label: "empty template", facts: [], anomalies: [], topicIds: [] },
    { label: "healthy", facts: healthy, anomalies: [], topicIds: [] },
    {
      label: "gap",
      facts: [row(1, 1), row(2, 2), row(3, 4)],
      anomalies: ["non_contiguous_order"],
      topicIds: [],
    },
    {
      label: "nonzero start",
      facts: [row(1, 2), row(2, 3)],
      anomalies: ["non_contiguous_order"],
      topicIds: [],
    },
    {
      label: "start at zero",
      facts: [row(1, 0), row(2, 1)],
      anomalies: ["non_contiguous_order"],
      topicIds: [],
    },
    {
      label: "duplicates only (must not fire non_contiguous_order)",
      facts: [row(1, 1), row(2, 2), row(3, 2), row(4, 3)],
      anomalies: ["duplicate_active_order"],
      topicIds: [id(2), id(3)],
    },
    {
      label: "archived default",
      facts: [row(1, 1), row(2, 2), row(3, 3, { status: "archived" })],
      anomalies: ["non_active_default"],
      topicIds: [id(3)],
    },
    {
      label: "archived non-default (fires non_default_row)",
      facts: [row(1, 1), row(2, 2), row(3, 9, { is_default: false, status: "archived" })],
      anomalies: ["non_default_row"],
      topicIds: [id(3)],
    },
    {
      label: "active non-default also fires non_default_row",
      facts: [row(1, 1), row(2, 5, { is_default: false })],
      anomalies: ["non_default_row"],
      topicIds: [id(2)],
    },
    {
      label: "combined: archived default plus a position gap",
      facts: [row(1, 1), row(2, 3), row(3, 2, { status: "archived" })],
      anomalies: ["non_active_default", "non_contiguous_order"],
      topicIds: [id(3)],
    },
    {
      label: "topicIds in canonical order (display_order, then id), not input order",
      facts: [row(9, 9, { is_default: false }), row(1, 1), row(5, 2, { is_default: false }), row(3, 2, { is_default: false })],
      anomalies: ["non_default_row"],
      topicIds: [id(3), id(5), id(9)],
    },
  ];

  it.each(table)("$label", ({ facts, anomalies, topicIds }) => {
    const out = detectTemplateAnomalies(facts);
    expect([...out.anomalies].sort()).toEqual([...anomalies].sort());
    expect(out.topicIds).toEqual(topicIds);
  });

  it("caps topicIds at 50", () => {
    const facts = [row(1, 1), ...Array.from({ length: 60 }, (_, i) => row(100 + i, 200 + i, { is_default: false }))];
    const out = detectTemplateAnomalies(facts);
    expect(out.anomalies).toEqual(["non_default_row"]);
    expect(out.topicIds).toHaveLength(50);
    expect(out.topicIds[0]).toBe(id(100));
  });

  it("lists a row that is both a duplicate-position row and otherwise affected once", () => {
    // Row 2 is an active default sharing position 2 with row 3; adding a
    // non-default row at the same id set must not repeat any id.
    const out = detectTemplateAnomalies([row(1, 1), row(2, 2), row(3, 2), row(4, 3, { is_default: false })]);
    expect(out.topicIds).toEqual([id(2), id(3), id(4)]);
    expect(new Set(out.topicIds).size).toBe(out.topicIds.length);
  });
});
