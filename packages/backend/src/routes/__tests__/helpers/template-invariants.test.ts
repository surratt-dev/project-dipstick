import { describe, it, expect } from "vitest";
import {
  checkTemplateInvariants,
  messageFor,
  sha256,
  type BaselineTopic,
  type TemplateRow,
} from "./template-invariants.js";

// harden-team-creation-topic-copy (#215) tasks.md 7.3 (G2): the invariants
// checker can fail, and its messages name the violated invariant.

const baseline: BaselineTopic[] = [
  { name: "A", voteType: "finger", promptSha256: sha256("pa"), firstSessionDescriptionSha256: sha256("da") },
  { name: "B", voteType: "roman", promptSha256: sha256("pb"), firstSessionDescriptionSha256: sha256("db") },
];
const good = (): TemplateRow[] => [
  { name: "A", prompt: "pa", vote_type: "finger", display_order: 1, status: "active", is_default: true, first_session_description: "da" },
  { name: "B", prompt: "pb", vote_type: "roman", display_order: 2, status: "active", is_default: true, first_session_description: "db" },
];

describe("checkTemplateInvariants (#215 7.3)", () => {
  it("passes a template that matches the baseline", () => {
    expect(checkTemplateInvariants(good(), baseline, 0)).toEqual([]);
  });

  it("an archived template default fails 'no non-active default' (and the count invariant)", () => {
    const rows = good();
    rows[1]!.status = "archived";
    const v = checkTemplateInvariants(rows, baseline, 0);
    expect(messageFor(v, "(c) no non-active default")).toContain("no non-active default");
    expect(messageFor(v, "(a) active default count and names equal the baseline")).not.toBe("");
  });

  it("a changed prompt fails 'baseline content' and nothing structural", () => {
    const rows = good();
    rows[0]!.prompt = "tampered";
    const v = checkTemplateInvariants(rows, baseline, 0);
    expect(messageFor(v, "(f) baseline content (prompt, vote_type, first_session_description)")).toContain("baseline content");
    expect(v).toHaveLength(1);
  });

  it("a changed first_session_description or vote_type fails baseline content", () => {
    const rows = good();
    rows[0]!.first_session_description = "x";
    rows[1]!.vote_type = "finger";
    expect(checkTemplateInvariants(rows, baseline, 0)).toHaveLength(2);
  });

  it.each([
    ["a position gap", (r: TemplateRow[]) => void (r[1]!.display_order = 3), "(b)"],
    ["an extra non-default row", (r: TemplateRow[]) => void r.push({ ...r[0]!, name: "C", is_default: false, display_order: 9 }), "(d)"],
  ])("%s fails the matching invariant", (_label, mutate, prefix) => {
    const rows = good();
    mutate(rows);
    expect(checkTemplateInvariants(rows, baseline, 0).some((v) => v.invariant.startsWith(prefix))).toBe(true);
  });

  it("a membership or session on the template fails (e)", () => {
    expect(checkTemplateInvariants(good(), baseline, 1).map((v) => v.invariant)).toEqual([
      "(e) no memberships or sessions on the template team",
    ]);
  });
});
