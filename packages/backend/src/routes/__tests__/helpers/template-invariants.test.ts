import { describe, it, expect } from "vitest";
import {
  BASELINE_INVARIANT,
  checkBaselineContent,
  checkTemplateInvariants,
  messageFor,
  sha256,
  type BaselineTopic,
  type TemplateRow,
} from "./template-invariants.js";

// harden-team-creation-topic-copy (#215) tasks.md 7.3 (G2), reshaped by
// admin-default-topic-maintenance (#216) task 2.2: the invariants checker can
// fail, its messages name the violated invariant, and an archived default is
// valid state.

const baseline: BaselineTopic[] = [
  { name: "A", voteType: "finger", promptSha256: sha256("pa"), firstSessionDescriptionSha256: sha256("da") },
  { name: "B", voteType: "roman", promptSha256: sha256("pb"), firstSessionDescriptionSha256: sha256("db") },
];
const good = (): TemplateRow[] => [
  { name: "A", prompt: "pa", vote_type: "finger", display_order: 1, status: "active", is_default: true, first_session_description: "da" },
  { name: "B", prompt: "pb", vote_type: "roman", display_order: 2, status: "active", is_default: true, first_session_description: "db" },
];

const COUNT = "(a) active default count within 1..15 and active names unique";
const POSITIONS = "(b) active default positions are exactly 1..N";
const FIELDS = "(c) every default row, active or archived, passes the maintenance field validation";

describe("checkTemplateInvariants (#215 7.3, reshaped in #216 2.2)", () => {
  it("passes a template that matches the baseline", () => {
    expect(checkTemplateInvariants(good(), 0)).toEqual([]);
    expect(checkBaselineContent(good(), baseline)).toEqual([]);
  });

  it("an edited template (different content, still healthy) passes the structural invariants", () => {
    const rows = good();
    rows[0]!.prompt = "an administrator rewrote this";
    expect(checkTemplateInvariants(rows, 0)).toEqual([]);
  });

  it("archived default is valid", () => {
    const rows = good();
    rows.push({ name: "Old", prompt: "po", vote_type: "finger", display_order: 3, status: "archived", is_default: true, first_session_description: "do" });
    expect(checkTemplateInvariants(rows, 0)).toEqual([]);
  });

  it("zero active fails the count invariant", () => {
    const rows = good().map((r) => ({ ...r, status: "archived" }));
    const v = checkTemplateInvariants(rows, 0);
    expect(messageFor(v, COUNT)).toContain("0 active default");
  });

  it("16 active defaults fail the count invariant", () => {
    const rows: TemplateRow[] = Array.from({ length: 16 }, (_, i) => ({
      name: `T${i}`, prompt: "p", vote_type: "finger", display_order: i + 1, status: "active", is_default: true, first_session_description: "d",
    }));
    expect(messageFor(checkTemplateInvariants(rows, 0), COUNT)).not.toBe("");
  });

  it("two active names equal after trim and lowercase fail the count/uniqueness invariant", () => {
    const rows = good();
    rows[1]!.name = " a ";
    expect(messageFor(checkTemplateInvariants(rows, 0), COUNT)).toContain("duplicate name key");
  });

  it("an archived default with invalid fields fails (c); so does an active one", () => {
    const rows = good();
    rows.push({ name: "Old", prompt: "<b>x</b>", vote_type: "finger", display_order: 3, status: "archived", is_default: true, first_session_description: "do" });
    expect(messageFor(checkTemplateInvariants(rows, 0), FIELDS)).toContain("PROMPT_FORMAT_INVALID");
    const empty = good();
    empty[0]!.prompt = "   ";
    expect(messageFor(checkTemplateInvariants(empty, 0), FIELDS)).toContain("DEFAULT_FIELD_REQUIRED");
  });

  it("a changed prompt fails 'baseline content' and nothing structural", () => {
    const rows = good();
    rows[0]!.prompt = "tampered";
    expect(checkTemplateInvariants(rows, 0)).toEqual([]);
    const v = checkBaselineContent(rows, baseline);
    expect(messageFor(v, BASELINE_INVARIANT)).toContain("baseline content");
    expect(v).toHaveLength(1);
  });

  it("a changed first_session_description or vote_type fails baseline content", () => {
    const rows = good();
    rows[0]!.first_session_description = "x";
    rows[1]!.vote_type = "finger";
    expect(checkBaselineContent(rows, baseline)).toHaveLength(2);
  });

  it("an archived baseline default fails baseline content (the active set no longer equals the baseline)", () => {
    const rows = good();
    rows[1]!.status = "archived";
    expect(messageFor(checkBaselineContent(rows, baseline), BASELINE_INVARIANT)).not.toBe("");
  });

  it.each([
    ["a position gap", (r: TemplateRow[]) => void (r[1]!.display_order = 3), "(b)"],
    ["an extra non-default row", (r: TemplateRow[]) => void r.push({ ...r[0]!, name: "C", is_default: false, display_order: 9 }), "(d)"],
  ])("%s fails the matching invariant", (_label, mutate, prefix) => {
    const rows = good();
    mutate(rows);
    expect(checkTemplateInvariants(rows, 0).some((v) => v.invariant.startsWith(prefix))).toBe(true);
  });

  it("a gap names the positions invariant", () => {
    const rows = good();
    rows[1]!.display_order = 4;
    expect(messageFor(checkTemplateInvariants(rows, 0), POSITIONS)).toContain("[1,4]");
  });

  it("a membership or session on the template fails (e)", () => {
    expect(checkTemplateInvariants(good(), 1).map((v) => v.invariant)).toEqual([
      "(e) no memberships or sessions on the template team",
    ]);
  });
});
