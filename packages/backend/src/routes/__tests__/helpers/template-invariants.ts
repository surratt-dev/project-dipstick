import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Pure template-invariant checker -- harden-team-creation-topic-copy (#215)
// design.md D8 / tasks.md 7.2-7.3, reshaped by admin-default-topic-maintenance
// (#216) design.md E6. Takes the rows (and, for (f), the baseline) as
// arguments so a unit test can show it FAILS on a mutated template (G2).
// The baseline itself lives only in template-invariants-integration.test.ts.
//
// (a)-(e) are STRUCTURAL and hold for any healthy template, including one an
// administrator has edited through the maintenance endpoints. (f) is the
// migration-time BASELINE content check; it applies only while no audited
// maintenance write exists, and is a separate function so the integration
// test can skip it (never pass it) once one does.
// ---------------------------------------------------------------------------
import {
  MAX_ACTIVE_DEFAULTS,
  MIN_ACTIVE_DEFAULTS,
  findDefaultRowViolation,
  nameKey,
} from "../../../sessions/default-topic-validation.js";

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
  | "(a) active default count within 1..15 and active names unique"
  | "(b) active default positions are exactly 1..N"
  | "(c) every default row, active or archived, passes the maintenance field validation"
  | "(d) no non-default row on the template"
  | "(e) no memberships or sessions on the template team"
  | "(f) baseline content (names, positions, prompt, vote_type, first_session_description)";

export const BASELINE_INVARIANT: InvariantId =
  "(f) baseline content (names, positions, prompt, vote_type, first_session_description)";

export interface Violation {
  invariant: InvariantId;
  detail: string;
}

export const sha256 = (text: string | null): string => createHash("sha256").update(text ?? "", "utf8").digest("hex");

/** Structural invariants (a) to (e): hold for any healthy template, edited or not. */
export function checkTemplateInvariants(rows: readonly TemplateRow[], membershipsAndSessions: number): Violation[] {
  const out: Violation[] = [];
  const activeDefaults = rows
    .filter((r) => r.is_default && r.status === "active")
    .sort((a, b) => a.display_order - b.display_order);

  const keys = activeDefaults.map((r) => nameKey(r.name));
  const duplicateKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (
    activeDefaults.length < MIN_ACTIVE_DEFAULTS ||
    activeDefaults.length > MAX_ACTIVE_DEFAULTS ||
    duplicateKeys.length > 0
  ) {
    out.push({
      invariant: "(a) active default count within 1..15 and active names unique",
      detail: `${activeDefaults.length} active default(s); duplicate name key(s) ${JSON.stringify([...new Set(duplicateKeys)])}`,
    });
  }

  const positions = activeDefaults.map((r) => r.display_order);
  if (positions.some((p, i) => p !== i + 1)) {
    out.push({
      invariant: "(b) active default positions are exactly 1..N",
      detail: `positions ${JSON.stringify(positions)}`,
    });
  }

  // Archived defaults are valid state (never copied); every default row, in
  // either status, must still pass the field validation the endpoints apply.
  const invalid = rows
    .filter((r) => r.is_default)
    .map((r) => ({ row: r, violation: findDefaultRowViolation(r) }))
    .filter((x) => x.violation !== null);
  if (invalid.length > 0) {
    out.push({
      invariant: "(c) every default row, active or archived, passes the maintenance field validation",
      detail: invalid
        .map((x) => `"${x.row.name}" (${x.row.status}): ${x.violation!.code} on ${x.violation!.field}`)
        .join("; "),
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
  return out;
}

/**
 * (f): the active defaults equal the migration-time baseline (exactly its
 * names and positions, and each prompt, vote_type and first_session_description).
 * Meaningful only while no audited maintenance write exists.
 */
export function checkBaselineContent(rows: readonly TemplateRow[], baseline: readonly BaselineTopic[]): Violation[] {
  const out: Violation[] = [];
  const activeDefaults = rows
    .filter((r) => r.is_default && r.status === "active")
    .sort((a, b) => a.display_order - b.display_order);

  const names = activeDefaults.map((r) => r.name);
  const expectedNames = baseline.map((b) => b.name);
  if (
    activeDefaults.length !== baseline.length ||
    names.some((n, i) => n !== expectedNames[i]) ||
    activeDefaults.some((r, i) => r.display_order !== i + 1)
  ) {
    out.push({
      invariant: BASELINE_INVARIANT,
      detail: `expected ${baseline.length} active defaults ${JSON.stringify(expectedNames)} at positions 1..N, found ${activeDefaults.length} ${JSON.stringify(names)} at ${JSON.stringify(activeDefaults.map((r) => r.display_order))}`,
    });
  }

  for (const b of baseline) {
    const row = activeDefaults.find((r) => r.name === b.name);
    if (!row) continue; // reported above
    const changed: string[] = [];
    if (row.vote_type !== b.voteType) changed.push("vote_type");
    if (sha256(row.prompt) !== b.promptSha256) changed.push("prompt");
    if (sha256(row.first_session_description) !== b.firstSessionDescriptionSha256) {
      changed.push("first_session_description");
    }
    if (changed.length > 0) {
      out.push({
        invariant: BASELINE_INVARIANT,
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
