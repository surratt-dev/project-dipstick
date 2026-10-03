import { describe, it, expect } from "vitest";
import { dirname, relative, resolve, sep } from "node:path";
import { allBackendSources, BACKEND_SRC, importSpecifiers, isTestPath, type SourceFile } from "./helpers/backend-sources.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) — structural guards for the topic-write
// rate limiter. Source scans only; no Redis or Postgres needed.
// ---------------------------------------------------------------------------

/** Backend-src-relative path a relative import specifier resolves to (".js" -> ".ts"). */
function resolveSpecifier(file: SourceFile, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const abs = resolve(dirname(file.abs), spec.replace(/\.js$/, ".ts"));
  return relative(BACKEND_SRC, abs).split(sep).join("/");
}

function importsModule(file: SourceFile, target: string): boolean {
  return importSpecifiers(file.text).some((spec) => resolveSpecifier(file, spec) === target);
}

// ---------------------------------------------------------------------------
// Task 5.4a: every unit test that imports topics.ts mocks the limiter with
// the shared helper. Classification rule (tasks.md 5.4a):
//   - real-Redis: the file calls probeInfra() or requireInfraOrThrow();
//   - opted out: the file is headed with a `// limiter-under-test` comment
//     (it may mock redis.js and import the real limiter);
//   - otherwise it MUST mock ../topic-write-rate-limit.js with
//     ./helpers/topic-write-rate-limit-mock.js.
// ---------------------------------------------------------------------------
describe("unit tests importing topics.ts mock the topic-write limiter (#184 5.4a)", () => {
  const MOCK_LINE = /vi\.mock\(\s*["']\.\.\/topic-write-rate-limit\.js["']\s*,\s*\(\)\s*=>\s*import\(\s*["']\.\/helpers\/topic-write-rate-limit-mock\.js["']\s*\)\s*\)/;

  const testFiles = allBackendSources().filter((f) => isTestPath(f.rel) && f.rel.endsWith(".test.ts"));
  const importers = testFiles.filter((f) => importsModule(f, "routes/topics.ts"));

  function classify(f: SourceFile): "real-redis" | "limiter-under-test" | "unit" {
    if (/\bprobeInfra\(|\brequireInfraOrThrow\(/.test(f.text)) return "real-redis";
    if (/^\/\/ limiter-under-test\b/m.test(f.text.split("\n").slice(0, 5).join("\n"))) return "limiter-under-test";
    return "unit";
  }

  it("finds the known importers (the guard is not vacuous)", () => {
    const rels = importers.map((f) => f.rel);
    expect(rels).toContain("routes/__tests__/topics.test.ts");
    expect(rels).toContain("routes/__tests__/topic-annotation.test.ts");
    expect(rels).toContain("routes/__tests__/topic-add-flag-parity.test.ts");
  });

  it("every non-real-Redis, non-opted-out importer uses the shared limiter mock", () => {
    const missing = importers.filter((f) => classify(f) === "unit" && !MOCK_LINE.test(f.text)).map((f) => f.rel);
    expect(missing).toEqual([]);
  });
});
