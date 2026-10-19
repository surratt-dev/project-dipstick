import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findActiveNameConflict } from "@dipstick/shared";
import { DEFAULT_TOPICS_TEAM_ID } from "../default-topics.js";

// #299 D8: copyCanonicalDefaults bulk-INSERTs with no name check, so a
// duplicate name in the canonical baseline would seed legacy duplicates in
// every new team. The baseline is migration 11 (it deletes and re-inserts the
// template team's default set); a later migration that changes the set must
// update this reader.
const TEMPLATE = DEFAULT_TOPICS_TEAM_ID;

function baselineNames(): string[] {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../migrations/11_default_topics_correction.sql", import.meta.url)),
    "utf8",
  );
  const up = sql.split("-- Down Migration")[0] ?? sql;
  const names: string[] = [];
  const re = new RegExp(`'${TEMPLATE}',\\s*\\n\\s*'((?:[^']|'')*)'`, "g");
  for (let m = re.exec(up); m; m = re.exec(up)) names.push((m[1] ?? "").replace(/''/g, "'"));
  return names;
}

describe("canonical default topic set (#299 D8)", () => {
  it("has the twelve baseline topics and no internal duplicate names", () => {
    const names = baselineNames();
    expect(names).toHaveLength(12);
    const seen: Array<{ id: string; name: string; displayOrder: number }> = [];
    names.forEach((name, i) => {
      expect(findActiveNameConflict(seen, name), `duplicate baseline name: ${name}`).toBeNull();
      seen.push({ id: String(i), name, displayOrder: i + 1 });
    });
  });
});
