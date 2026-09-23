import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

  it("is unmodified by facilitator-reconnect-indicator: no new state value or branch related to facilitator_connection_status (session-timeout-continuity design.md Decision 5, tasks.md task 4.14)", () => {
    expect(code).not.toMatch(/facilitator_connection_status/);
    expect(code).not.toMatch(/facilitatorConnected/i);
    // The state union stays exactly the three values it always had.
    expect(code).toMatch(
      /export type ConnectionHealthState = "connected" \| "unknown-reconnecting" \| "reauth-required"/,
    );
  });
});

describe("Exactly one facilitator_connection_status indicator implementation exists (session-timeout-continuity design.md Decision 5, tasks.md task 4.14)", () => {
  function collectSourceFiles(rootDir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(rootDir)) {
      const full = path.join(rootDir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        collectSourceFiles(full, out);
      } else if (/\.(ts|tsx)$/.test(entry) && !full.includes(`${path.sep}__tests__${path.sep}`)) {
        out.push(full);
      }
    }
    return out;
  }

  it("exactly one module names the facilitator_connection_status eventType literal — no second, independent consumer anywhere else in the frontend source tree", () => {
    const hookSource = readSourceWithoutComments("../facilitatorConnectionStatus.ts");
    expect(hookSource).toMatch(/export function useFacilitatorConnectionStatus/);

    const srcRoot = path.resolve(dir, "../../");
    const consumerBasenames = collectSourceFiles(srcRoot)
      .filter((f) => /facilitator_connection_status/.test(readFileSync(f, "utf-8")))
      .map((f) => path.basename(f))
      .sort();

    expect(consumerBasenames).toEqual(["facilitatorConnectionStatus.ts"]);
  });

  it("FacilitatorReconnectIndicator.tsx is the one component that consumes useFacilitatorConnectionStatus, and no other component does", () => {
    const srcRoot = path.resolve(dir, "../../");
    const importerBasenames = collectSourceFiles(srcRoot)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /useFacilitatorConnectionStatus/.test(readFileSync(f, "utf-8")))
      .map((f) => path.basename(f))
      .sort();

    expect(importerBasenames).toEqual(["FacilitatorReconnectIndicator.tsx"]);
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

describe("ReauthRequiredTreatment.tsx non-disclosure invariants (reauth-required-client-prompt tasks.md task 3.4(b), mirroring task 1.9's pattern)", () => {
  const code = readSourceWithoutComments("../../components/ReauthRequiredTreatment.tsx");

  it("never references STALE_SIGNAL_CLOSE_CODE or REAUTH_GRACE_EXPIRED_CLOSE_CODE as symbols", () => {
    expect(code).not.toMatch(/STALE_SIGNAL_CLOSE_CODE/);
    expect(code).not.toMatch(/REAUTH_GRACE_EXPIRED_CLOSE_CODE/);
  });

  it("never reads .code or compares against a raw numeric close-code literal", () => {
    expect(code).not.toMatch(/\.code\b/);
    expect(code).not.toMatch(/===\s*4000\b|===\s*4001\b/);
  });

  it("takes exactly the two deliberate, narrow prop exceptions this change adds (returnTo, role) — no prop derived from cause, close code, or connection state (session-timeout-continuity design.md Decisions 3/4)", () => {
    const propsInterfaceMatch = code.match(/export\s+interface\s+ReauthRequiredTreatmentProps\s*{([^}]*)}/);
    expect(propsInterfaceMatch).not.toBeNull();
    const propsBody = propsInterfaceMatch![1]!;
    const propNames = [...propsBody.matchAll(/^\s*([a-zA-Z_]\w*)\??:/gm)].map((m) => m[1]);
    expect(new Set(propNames)).toEqual(new Set(["returnTo", "role"]));
    expect(code).not.toMatch(/\bcause\b/i);
    expect(code).not.toMatch(/\bcloseCode\b/i);
  });

  it("performs no console logging at all", () => {
    const consoleCalls = code.match(/console\.[a-zA-Z]+\([^]*?\)/g) ?? [];
    expect(consoleCalls.length).toBe(0);
  });
});

describe("No reveal-timing-aware special casing (spec.md, reauth-required-client-prompt tasks.md task 5.1, design.md Decision D6)", () => {
  const files = [
    "../connectionHealth.ts",
    "../../components/ConnectionStatusBanner.tsx",
    "../../components/FacilitatorReadinessGrid.tsx",
    "../../components/ReauthRequiredTreatment.tsx",
  ];

  it.each(files)("%s references no reveal state, topic status, or other session-moment signal", (relativePath) => {
    const code = readSourceWithoutComments(relativePath);
    expect(code).not.toMatch(/reveal/i);
    expect(code).not.toMatch(/topicStatus/i);
    expect(code).not.toMatch(/SessionTopicStatus/);
  });
});
