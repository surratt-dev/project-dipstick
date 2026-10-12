import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Pure template-invariant checker -- harden-team-creation-topic-copy (#215)
// design.md D8 / tasks.md 7.2-7.3. Takes the rows and the baseline as
// arguments so a unit test can show it FAILS on a mutated template (G2).
// The baseline itself lives only in template-invariants-integration.test.ts.
// ---------------------------------------------------------------------------

export interface TemplateRow {
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  status: string;
  is_default: boolean;
  first_session_description: string | null;
}

export interface BaselineTopic {
  name: string;
  voteType: string;
  promptSha256: string;
  firstSessionDescriptionSha256: string;
}

export type InvariantId =
  | "(a) active default count and names equal the baseline"
  | "(b) active default positions are exactly 1..N"
  | "(c) no non-active default"
  | "(d) no non-default row on the template"
  | "(e) no memberships or sessions on the template team"
  | "(f) baseline content (prompt, vote_type, first_session_description)";

export interface Violation {
  invariant: InvariantId;
  detail: string;
}

export const sha256 = (text: string | null): string => createHash("sha256").update(text ?? "", "utf8").digest("hex");

export function checkTemplateInvariants(
  rows: readonly TemplateRow[],
  baseline: readonly BaselineTopic[],
  membershipsAndSessions: number,
): Violation[] {
  const out: Violation[] = [];
  const activeDefaults = rows
    .filter((r) => r.is_default && r.status === "active")
    .sort((a, b) => a.display_order - b.display_order);

  const names = activeDefaults.map((r) => r.name);
  const expectedNames = baseline.map((b) => b.name);
  if (activeDefaults.length !== baseline.length || names.some((n, i) => n !== expectedNames[i])) {
    out.push({
      invariant: "(a) active default count and names equal the baseline",
      detail: `expected ${baseline.length} active defaults ${JSON.stringify(expectedNames)}, found ${activeDefaults.length} ${JSON.stringify(names)}`,
    });
  }

  const positions = activeDefaults.map((r) => r.display_order);
  if (positions.some((p, i) => p !== i + 1) || positions.length !== baseline.length) {
    out.push({
      invariant: "(b) active default positions are exactly 1..N",
      detail: `positions ${JSON.stringify(positions)}`,
    });
  }

  const nonActive = rows.filter((r) => r.is_default && r.status !== "active");
  if (nonActive.length > 0) {
    out.push({
      invariant: "(c) no non-active default",
      detail: `${nonActive.length} default row(s) not active: ${JSON.stringify(nonActive.map((r) => [r.name, r.status]))}`,
    });
  }

  const nonDefault = rows.filter((r) => !r.is_default);
  if (nonDefault.length > 0) {
    out.push({
      invariant: "(d) no non-default row on the template",
      detail: `${nonDefault.length} non-default row(s): ${JSON.stringify(nonDefault.map((r) => r.name))}`,
    });
  }

  if (membershipsAndSessions !== 0) {
    out.push({
      invariant: "(e) no memberships or sessions on the template team",
      detail: `${membershipsAndSessions} row(s)`,
    });
  }

  for (const b of baseline) {
    const row = activeDefaults.find((r) => r.name === b.name);
    if (!row) continue; // reported by (a)
    const changed: string[] = [];
    if (row.vote_type !== b.voteType) changed.push("vote_type");
    if (sha256(row.prompt) !== b.promptSha256) changed.push("prompt");
    if (sha256(row.first_session_description) !== b.firstSessionDescriptionSha256) {
      changed.push("first_session_description");
    }
    if (changed.length > 0) {
      out.push({
        invariant: "(f) baseline content (prompt, vote_type, first_session_description)",
        detail: `"${b.name}": ${changed.join(", ")} differ from the baseline`,
      });
    }
  }
  return out;
}

/** Failure message for one invariant, or "" when it holds. */
export function messageFor(violations: readonly Violation[], invariant: InvariantId): string {
  return violations
    .filter((v) => v.invariant === invariant)
    .map((v) => `Template invariant violated: ${v.invariant}: ${v.detail}`)
    .join("\n");
}
