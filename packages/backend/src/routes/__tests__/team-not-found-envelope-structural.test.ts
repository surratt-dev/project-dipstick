import { describe, it, expect } from "vitest";
import { productionSources } from "./helpers/backend-sources.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184 m5) task 2.6, spec "Every team-not-found
// response uses one canonical envelope" → "Structural guard against drift".
//
// The "Team not found." message literal may appear in backend production
// source only inside routes/error-envelope.ts (teamNotFoundEnvelope()). Any
// other occurrence is a hand-built team-not-found body that can drift from
// the shared envelope (category, code), which is exactly the m5 finding.
// ---------------------------------------------------------------------------

const OWNER = "routes/error-envelope.ts";

const ALLOWLIST: ReadonlySet<string> = new Set([
  OWNER,
  // Temporary: removed by task 2.4; see #184 m5. teams.ts still hand-builds
  // its three team-not-found 404s until 2.4's revertible commit swaps them to
  // teamNotFoundEnvelope(). That commit deletes this entry.
  "routes/teams.ts",
]);

describe('"Team not found." appears only in routes/error-envelope.ts (#184 m5)', () => {
  it("no other backend source file contains the literal", () => {
    const offenders = productionSources()
      .filter((f) => f.text.includes("Team not found."))
      .map((f) => f.rel)
      .filter((rel) => !ALLOWLIST.has(rel));
    expect(offenders).toEqual([]);
  });

  it("the owner still defines it (the guard is not vacuous)", () => {
    const owner = productionSources().find((f) => f.rel === OWNER);
    expect(owner?.text).toContain('"Team not found."');
  });
});
