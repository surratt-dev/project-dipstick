import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Grep-based non-disclosure regression test (task 1.9, design.md Decision
// D1a/D2, Security design review Finding 5).
//
// This scans source text rather than exercising behavior, because the
// invariant under test — "no branch anywhere reads event.code or an
// outcome-type for any purpose, except the one named exception" — is a
// structural property of the code, not something that always has an
// observable behavioral difference a black-box test could catch (e.g. a
// dead `if (code === STALE_SIGNAL_CLOSE_CODE) { /* no-op */ }` branch would
// pass every behavioral test in connectionHealth.test.ts while still
// re-introducing the exact code-review smell task 1.9 exists to catch).
//
// Comments are stripped before matching: this file's own header comments
// legitimately name STALE_SIGNAL_CLOSE_CODE in prose (to explain why it is
// deliberately absent from the code), which is not the thing this
// invariant is about.
// ---------------------------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));

function readSourceWithoutComments(relativePath: string): string {
  const raw = readFileSync(path.join(dir, relativePath), "utf-8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("connectionHealth.ts non-disclosure invariants (task 1.9)", () => {
  const code = readSourceWithoutComments("../connectionHealth.ts");

  it("never references STALE_SIGNAL_CLOSE_CODE as a symbol", () => {
    expect(code).not.toMatch(/STALE_SIGNAL_CLOSE_CODE/);
  });

  it("reads event.code exactly once, to extract it, not to branch on it", () => {
    const propertyAccesses = code.match(/\.code\b/g) ?? [];
    expect(propertyAccesses.length).toBe(1);
  });

  it("compares against a close code exactly once, and it is the named REAUTH_GRACE_EXPIRED_CLOSE_CODE exception", () => {
    const namedExceptionComparisons = code.match(/===\s*REAUTH_GRACE_EXPIRED_CLOSE_CODE/g) ?? [];
    expect(namedExceptionComparisons.length).toBe(1);

    // No comparison against a raw numeric close-code literal (4000/4001)
    // anywhere — the only legitimate value this module compares against is
    // the named constant above, imported once at the top of the file.
    const rawNumericCloseCodeComparisons = code.match(/===\s*4000\b|===\s*4001\b/g) ?? [];
    expect(rawNumericCloseCodeComparisons).toEqual([]);
  });

  it("performs no console logging of event.code, event.reason, or the parsed message body", () => {
    const consoleCalls = code.match(/console\.[a-zA-Z]+\([^]*?\)/g) ?? [];
    expect(consoleCalls.length).toBe(0);
  });
});

describe("ConnectionStatusBanner.tsx non-disclosure invariants (task 1.9 — retry/render call sites)", () => {
  const code = readSourceWithoutComments("../../components/ConnectionStatusBanner.tsx");

  it("never references STALE_SIGNAL_CLOSE_CODE or REAUTH_GRACE_EXPIRED_CLOSE_CODE as symbols", () => {
    expect(code).not.toMatch(/STALE_SIGNAL_CLOSE_CODE/);
    expect(code).not.toMatch(/REAUTH_GRACE_EXPIRED_CLOSE_CODE/);
  });

  it("never reads .code or compares against a raw numeric close-code literal", () => {
    expect(code).not.toMatch(/\.code\b/);
    expect(code).not.toMatch(/===\s*4000\b|===\s*4001\b/);
  });

  it("performs no console logging at all", () => {
    const consoleCalls = code.match(/console\.[a-zA-Z]+\([^]*?\)/g) ?? [];
    expect(consoleCalls.length).toBe(0);
  });
});

describe("FacilitatorReadinessGrid.tsx non-disclosure invariants (task 1.9 — retry/render call sites)", () => {
  const code = readSourceWithoutComments("../../components/FacilitatorReadinessGrid.tsx");

  it("never references STALE_SIGNAL_CLOSE_CODE or REAUTH_GRACE_EXPIRED_CLOSE_CODE as symbols", () => {
    expect(code).not.toMatch(/STALE_SIGNAL_CLOSE_CODE/);
    expect(code).not.toMatch(/REAUTH_GRACE_EXPIRED_CLOSE_CODE/);
  });

  it("never reads .code or compares against a raw numeric close-code literal", () => {
    expect(code).not.toMatch(/\.code\b/);
    expect(code).not.toMatch(/===\s*4000\b|===\s*4001\b/);
  });

  it("performs no console logging at all", () => {
    const consoleCalls = code.match(/console\.[a-zA-Z]+\([^]*?\)/g) ?? [];
    expect(consoleCalls.length).toBe(0);
  });
});
