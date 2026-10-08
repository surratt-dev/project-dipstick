import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 5.4: the template id has ONE
// source of truth, DEFAULT_TOPICS_TEAM_ID (sessions/default-topics.ts). No new
// literal of it (canonical or 32-hex) may appear in the shared, backend or
// frontend source outside that file; migrations/ are outside the scanned
// trees and keep theirs. Code that needs the id imports the constant.
//
// PRE_EXISTING_TEST_FILES is the baseline at #214: test files that already
// spelled the literal out. It may shrink, never grow.
// ---------------------------------------------------------------------------

const PACKAGES = fileURLToPath(new URL("../../../../", import.meta.url));
const SCANNED_ROOTS = ["backend/src", "frontend/src", "shared/src"];
const ALLOWED = new Set(["backend/src/sessions/default-topics.ts"]);
const PRE_EXISTING_TEST_FILES = new Set([
  "backend/src/__tests__/default-topics-seed-integration.test.ts",
  "backend/src/routes/__tests__/default-topic-provisioning-integration.test.ts",
  "backend/src/routes/__tests__/facilitator-sessions.test.ts",
  "backend/src/routes/__tests__/room-open-integration.test.ts",
  "backend/src/routes/__tests__/topic-annotation-integration.test.ts",
  "backend/src/routes/__tests__/topics-integration.test.ts",
  "backend/src/routes/__tests__/topics.test.ts",
]);

const HEX = DEFAULT_TOPICS_TEAM_ID.replace(/-/g, "");
const LITERAL = new RegExp(`${DEFAULT_TOPICS_TEAM_ID}|(^|[^0-9a-f])${HEX}([^0-9a-f]|$)`, "i");

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("the template id is spelled out only in its constant (#214 5.4)", () => {
  it("no source file outside sessions/default-topics.ts (and the pre-#214 test baseline) contains the template UUID", async () => {
    const offenders: string[] = [];
    const baselineSeen = new Set<string>();
    for (const root of SCANNED_ROOTS) {
      for (const file of await sourceFiles(join(PACKAGES, root))) {
        const rel = relative(PACKAGES, file).split("\\").join("/");
        if (!LITERAL.test(await readFile(file, "utf8"))) continue;
        if (ALLOWED.has(rel)) continue;
        if (PRE_EXISTING_TEST_FILES.has(rel)) {
          baselineSeen.add(rel);
          continue;
        }
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    // The constant file itself is found, so the scan is looking in the right place.
    expect(LITERAL.test(await readFile(join(PACKAGES, "backend/src/sessions/default-topics.ts"), "utf8"))).toBe(true);
    expect(baselineSeen.size).toBeGreaterThan(0);
  });
});
