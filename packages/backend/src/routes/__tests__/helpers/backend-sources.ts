import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Source-scanning helpers for the structural tests added by
// harden-topic-write-endpoints (#184): the "Team not found." grep guard
// (task 2.6), the limiter-mock guard (task 5.4a) and the limiter import graph
// (task 5.7). Not a *.test.ts file, so vitest never collects it.
// ---------------------------------------------------------------------------

/** Absolute path of packages/backend/src. */
export const BACKEND_SRC = fileURLToPath(new URL("../../../", import.meta.url));

export interface SourceFile {
  /** Path relative to packages/backend/src, always with forward slashes. */
  rel: string;
  abs: string;
  text: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(abs);
    }
  }
}

export function isTestPath(rel: string): boolean {
  return rel.includes("__tests__/") || rel.endsWith(".test.ts");
}

/** Every .ts file under packages/backend/src. */
export function allBackendSources(): SourceFile[] {
  const files: string[] = [];
  walk(BACKEND_SRC, files);
  return files.map((abs) => ({
    abs,
    rel: relative(BACKEND_SRC, abs).split(sep).join("/"),
    text: readFileSync(abs, "utf8"),
  }));
}

/** Non-test backend sources (production code). */
export function productionSources(): SourceFile[] {
  return allBackendSources().filter((f) => !isTestPath(f.rel));
}

/**
 * Module specifiers this file imports or re-exports statically, plus
 * vi.mock()/import() string literals. Good enough for an allow-list over a
 * codebase that only uses relative ESM specifiers.
 */
export function importSpecifiers(text: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bvi\.(?:mock|doMock)\(\s*["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) specs.push(m[1]!);
  }
  return specs;
}
