import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214), specs/default-topic-provisioning "The guard
// reads no configuration": no configuration value, environment variable or
// flag can change the template decision. Source inspection of the guard
// module (tasks.md 2.1) and of the module holding the eligible-teams query
// (tasks.md 3.1).
// ---------------------------------------------------------------------------

function source(relativeToSrc: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../../${relativeToSrc}`, import.meta.url)), "utf8");
}

/** Every module specifier the file imports, statically or dynamically. */
function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

const INSPECTED = [
  // tasks.md 2.1: the guard module.
  "teams/template-team-guard.ts",
  // tasks.md 3.1: the module holding GET /api/v1/teams/eligible-for-session's
  // query (and the draft and session sub-route guards).
  "routes/facilitator-sessions.ts",
] as const;

describe("the template decision reads no configuration (#214)", () => {
  it.each(INSPECTED)("%s imports no configuration module and reads no process.env", async (file) => {
    const text = await source(file);
    const specifiers = importSpecifiers(text);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)config(\.js)?$/);
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(/dotenv|feature-?flag/i);
    }
    expect(text).not.toMatch(/process\s*\.\s*env|process\s*\[\s*["']env["']\s*\]/);
  });
});
