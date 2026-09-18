import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// voteComposeUiWiresVoteDraft — the single source of truth for design.md
// Decision D5's grep-checkable fact (reauth-required-client-prompt tasks.md
// tasks 1.1 and 3.6): does any vote-compose UI component in the current
// codebase import and call voteDraft.ts's persist/restore hooks?
//
// Both the regression guard (1.1, expects `false` today) and the copy
// consistency check (3.6, conditions the vote-loss sentence on this same
// value) call this function so neither can independently drift from what
// "the current fact" actually is.
//
// Test files (including voteDraft.ts's own contract-level test) are
// excluded: task 1.1 is about a vote-compose UI component, not this
// module's own fixture-based tests.
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const TESTS_SEGMENT = `${path.sep}__tests__${path.sep}`;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export function voteComposeUiWiresVoteDraft(): boolean {
  const candidateFiles = collectSourceFiles(SRC_ROOT).filter(
    (file) => !file.includes(TESTS_SEGMENT) && path.basename(file) !== "voteDraft.ts",
  );

  for (const file of candidateFiles) {
    const contents = readFileSync(file, "utf-8");
    if (!/from\s+["'][^"']*voteDraft(?:\.js)?["']/.test(contents)) continue;
    if (/\b(persistDraft|restoreDraft)\b/.test(contents)) {
      return true;
    }
  }
  return false;
}
