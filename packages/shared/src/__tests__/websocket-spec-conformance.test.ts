import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// WebSocket spec/code conformance check.
//
// openspec/specs/websocket-specification/spec.md exists because issue #24's
// original gate ("no real-time implementation until this document exists")
// didn't hold — five changes shipped the real-time layer piecemeal, and the
// spec was written after the fact to reconcile against it. That same drift
// can recur silently for any future change that adds, removes, or renames a
// WebSocket event without updating the spec's Event Registry.
//
// This test scans source text (not the TS type system) to compare two
// things that must always agree:
//   1. Every eventType literal in WsClientMessage (realtime.ts) — the actual,
//      compiler-enforced set of messages the app can send to a client.
//   2. Every row in spec.md's "## Event Registry" table — the documented set.
//
// It does not validate payload shapes, only event names and their
// Implemented/NOT IMPLEMENTED status. See spec.md's "## Event Registry"
// section for why this table, not the narrative catalog below it, is what
// gets parsed here.
// ---------------------------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

const realtimeTypesSource = readFileSync(
  path.join(repoRoot, "packages/shared/src/types/realtime.ts"),
  "utf-8",
);
const specSource = readFileSync(
  path.join(repoRoot, "openspec/specs/websocket-specification/spec.md"),
  "utf-8",
);

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function extractWsClientMessageEventTypes(source: string): string[] {
  const unionMatch = source.match(/export type WsClientMessage =([\s\S]*?);\n/);
  const unionBody = unionMatch?.[1];
  if (unionBody === undefined) {
    throw new Error(
      "Could not find `export type WsClientMessage = ...;` in realtime.ts — " +
        "has it been renamed or restructured? This test needs updating to match.",
    );
  }
  const eventTypes = [...unionBody.matchAll(/eventType:\s*"([a-z_]+)"/g)]
    .map((m) => m[1])
    .filter(isDefined);
  if (eventTypes.length === 0) {
    throw new Error("Found WsClientMessage but extracted zero eventType literals from it.");
  }
  return eventTypes;
}

interface RegistryRow {
  name: string;
  implemented: boolean;
  raw: string;
}

function extractEventRegistry(source: string): RegistryRow[] {
  const sectionMatch = source.match(/## Event Registry\n([\s\S]*?)\n---/);
  const sectionBody = sectionMatch?.[1];
  if (sectionBody === undefined) {
    throw new Error(
      "Could not find a `## Event Registry` section (terminated by a `---` line) in " +
        "spec.md — has it been renamed, removed, or restructured? This test needs " +
        "updating to match, or the section needs to be restored.",
    );
  }
  const tableRows = sectionBody
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .slice(2); // drop the header row and the |---|---| separator

  return tableRows
    .map((line) => {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      const eventCell = cells[0];
      const statusCell = cells[1];
      if (eventCell === undefined || statusCell === undefined) {
        throw new Error(`Event Registry row does not have two cells: "${line}"`);
      }
      const implemented = statusCell.startsWith("Implemented");
      // A cell may name one event (`vote_revealed`) or a pair
      // (`participant.joined` / `participant.left`) — extract every
      // backtick-quoted name in the cell.
      const names = [...eventCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(isDefined);
      if (names.length === 0) {
        throw new Error(`Event Registry row has no backtick-quoted event name: "${line}"`);
      }
      return names.map((name) => ({ name, implemented, raw: line }));
    })
    .flat();
}

describe("WebSocket event catalog matches the published spec (openspec/specs/websocket-specification)", () => {
  const codeEventTypes = new Set(extractWsClientMessageEventTypes(realtimeTypesSource));
  const registry = extractEventRegistry(specSource);

  // Only registry rows naming an actual snake_case eventType are checked
  // against code — dot-notation names (e.g. `participant.joined`) are
  // documentation labels for events that don't exist as an eventType at all.
  const isCodeStyleName = (name: string) => /^[a-z]+(_[a-z]+)+$/.test(name);

  it("has at least one Event Registry row for every eventType WsClientMessage can send", () => {
    const registeredNames = new Set(registry.map((r) => r.name));
    const missing = [...codeEventTypes].filter((name) => !registeredNames.has(name));
    expect(
      missing,
      `eventType(s) shipped in WsClientMessage but missing from spec.md's Event Registry: ${missing.join(", ")}. ` +
        "Add a row to openspec/specs/websocket-specification/spec.md's Event Registry table.",
    ).toEqual([]);
  });

  it("marks every eventType WsClientMessage can send as Implemented in the registry", () => {
    const notMarkedImplemented = registry.filter(
      (r) => isCodeStyleName(r.name) && codeEventTypes.has(r.name) && !r.implemented,
    );
    expect(
      notMarkedImplemented.map((r) => r.name),
      "Event(s) that exist in WsClientMessage but are marked NOT IMPLEMENTED in spec.md's " +
        "Event Registry — the registry is stale.",
    ).toEqual([]);
  });

  it("does not mark any code-style event name Implemented unless it is actually shipped", () => {
    const claimedButMissing = registry.filter(
      (r) => isCodeStyleName(r.name) && r.implemented && !codeEventTypes.has(r.name),
    );
    expect(
      claimedButMissing.map((r) => r.name),
      "Event(s) marked Implemented in spec.md's Event Registry but absent from WsClientMessage — " +
        "either the event was removed from code and the spec wasn't updated, or the name drifted.",
    ).toEqual([]);
  });

  it("flags a NOT IMPLEMENTED registry entry the moment its event ships (e.g. issue #94/#95 closing)", () => {
    const nowImplemented = registry.filter(
      (r) => isCodeStyleName(r.name) && !r.implemented && codeEventTypes.has(r.name),
    );
    expect(
      nowImplemented.map((r) => r.name),
      "Event(s) marked NOT IMPLEMENTED in spec.md's Event Registry but already present in " +
        "WsClientMessage — flip the registry row to Implemented and update its tracking issue.",
    ).toEqual([]);
  });
});
