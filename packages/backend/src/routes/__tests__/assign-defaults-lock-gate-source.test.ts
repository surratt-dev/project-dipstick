import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) design.md D9 "Regression guard", tasks.md
// 3.1: a PERMANENT source test, not a change-time check. The assign-defaults
// carve-out is the one exception to the customization lock. This keeps it the
// only one: the four lock-gated writes (add, archive, restore, reorder) still
// call checkCustomizationLockGate, and assign-defaults does not -- nor does it
// read the lock state by any other route. A reviewer who "tidies" the new
// route by adding the gate (which would make it unusable for exactly the
// teams it exists for), or who drops the gate from a sibling, fails here.
//
// Source inspection only; no database. The route handlers are the
// `app.<method><...>("/api/...", async (request, reply) => {` blocks of
// routes/topics.ts, each running to the next such block.
// ---------------------------------------------------------------------------

const TOPICS_SOURCE = readFileSync(fileURLToPath(new URL("../topics.ts", import.meta.url)), "utf8");

interface RouteBlock {
  method: string;
  url: string;
  text: string;
}

/** Splits a route-plugin source into one block per registered route. */
function routeBlocks(source: string): RouteBlock[] {
  const starts = [...source.matchAll(/^ {2}app\.(get|post|put|patch|delete)<[\s\S]*?>\(\s*"([^"]+)"/gm)];
  return starts.map((match, i) => ({
    method: match[1]!.toUpperCase(),
    url: match[2]!,
    text: source.slice(match.index!, starts[i + 1]?.index ?? source.length),
  }));
}

const GATE_CALL = /\bcheckCustomizationLockGate\(/;
const LOCK_STATE_READS = /\b(hasCompletedFirstSession|getTopicLockState)\(/;

const BASE = "/api/v1/teams/:teamId/topics";
const GATED: ReadonlyArray<[string, string]> = [
  ["POST", BASE],
  ["DELETE", `${BASE}/:topicId`],
  ["POST", `${BASE}/:topicId/restore`],
  ["PUT", `${BASE}/order`],
];

describe("the customization lock has exactly one carve-out (#200 D9)", () => {
  const blocks = routeBlocks(TOPICS_SOURCE);
  const find = (method: string, url: string) => blocks.find((b) => b.method === method && b.url === url);

  it("finds every topic route in routes/topics.ts (the scan is not vacuous)", () => {
    expect(blocks.map((b) => `${b.method} ${b.url}`).sort()).toEqual(
      [
        `POST ${BASE}`,
        `POST ${BASE}/assign-defaults`,
        `DELETE ${BASE}/:topicId`,
        `POST ${BASE}/:topicId/restore`,
        `PUT ${BASE}/order`,
        `PUT ${BASE}/:topicId/annotation`,
      ].sort(),
    );
  });

  it.each(GATED)("%s %s still calls checkCustomizationLockGate", (method, url) => {
    const block = find(method, url);
    expect(block, `${method} ${url} not found`).toBeDefined();
    expect(block!.text).toMatch(GATE_CALL);
  });

  it("assign-defaults does not call checkCustomizationLockGate, and reads no lock state", () => {
    const block = find("POST", `${BASE}/assign-defaults`);
    expect(block).toBeDefined();
    // Strip comments first: the header comment legitimately names the gate.
    const code = block!.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(GATE_CALL);
    expect(code).not.toMatch(LOCK_STATE_READS);
  });

  it("the splitter attributes a gate call to the right route (self-test)", () => {
    const synthetic = [
      '  app.post<{ Params: { teamId: string } }>("/a", async () => {',
      "    await checkCustomizationLockGate();",
      "  });",
      '  app.post<{ Params: { teamId: string } }>("/b", async () => {',
      "    return 1;",
      "  });",
    ].join("\n");
    const [a, b] = routeBlocks(synthetic);
    expect(a!.text).toMatch(GATE_CALL);
    expect(b!.text).not.toMatch(GATE_CALL);
  });
});
