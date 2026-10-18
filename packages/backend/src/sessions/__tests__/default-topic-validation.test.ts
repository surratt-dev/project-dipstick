import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_LIMITS,
  DESCRIPTION_MAX,
  MAX_ACTIVE_DEFAULTS,
  MIN_ACTIVE_DEFAULTS,
  MaintenanceError,
  NAME_MAX,
  PROMPT_MAX,
  codePointLength,
  findDefaultRowViolation,
  isPlainText,
  nameKey,
  validateTextField,
  validateVoteType,
} from "../default-topic-validation.js";

// The constants test imports the writer module, which imports db.js and
// config.js; mock them so this unit file needs no environment or database.
vi.mock("../../db.js", () => ({ db: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../config.js", () => ({ config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test" } }));

// admin-default-topic-maintenance (#216) tasks.md 3.2: constants, boundary
// lengths (code points, with an astral character at the boundary) and every
// format rejection of design E4. The constant-equals-union test lives in
// default-topic-maintenance-constants.test.ts (it imports the writer module).

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof MaintenanceError ? err.code : "OTHER";
  }
}

describe("fixed limits (PO-ratified, D7)", () => {
  it("are 15 / 1 / 60 / 400 / 800", () => {
    expect([MAX_ACTIVE_DEFAULTS, MIN_ACTIVE_DEFAULTS, NAME_MAX, PROMPT_MAX, DESCRIPTION_MAX]).toEqual([15, 1, 60, 400, 800]);
    expect(DEFAULT_LIMITS).toEqual({ minActive: 1, maxActive: 15, nameMax: 60, promptMax: 400, descriptionMax: 800 });
  });
});

describe("length is counted in code points after trim", () => {
  const astral = "\u{1F600}"; // one code point, two UTF-16 units
  it("counts an astral character once", () => {
    expect(codePointLength(astral)).toBe(1);
    expect(astral.length).toBe(2);
  });

  it("a prompt of exactly 400 code points is accepted, 401 is DEFAULT_FIELD_TOO_LONG", () => {
    expect(validateTextField("prompt", "a".repeat(400))).toHaveLength(400);
    expect(code(() => validateTextField("prompt", "a".repeat(401)))).toBe("DEFAULT_FIELD_TOO_LONG");
  });

  it("399 ASCII plus one astral character is accepted; 400 ASCII plus one astral is too long", () => {
    expect(code(() => validateTextField("prompt", "a".repeat(399) + astral))).toBeNull();
    expect(code(() => validateTextField("prompt", "a".repeat(400) + astral))).toBe("DEFAULT_FIELD_TOO_LONG");
  });

  it("name boundary 60/61 and description boundary 800/801", () => {
    expect(code(() => validateTextField("name", "n".repeat(60)))).toBeNull();
    expect(code(() => validateTextField("name", "n".repeat(61)))).toBe("DEFAULT_FIELD_TOO_LONG");
    expect(code(() => validateTextField("firstSessionDescription", "d".repeat(800)))).toBeNull();
    expect(code(() => validateTextField("firstSessionDescription", "d".repeat(801)))).toBe("DEFAULT_FIELD_TOO_LONG");
  });

  it("the too-long error carries the field and max, never the value", () => {
    try {
      validateTextField("prompt", "secret-".repeat(100));
      expect.unreachable();
    } catch (err) {
      expect((err as MaintenanceError).detail).toEqual({ field: "prompt", max: 400 });
      expect(JSON.stringify((err as MaintenanceError).detail)).not.toContain("secret");
    }
  });

  it("length is measured after trim and the stored value is trimmed", () => {
    expect(validateTextField("name", "  Pairing  ")).toBe("Pairing");
    expect(code(() => validateTextField("name", "  " + "n".repeat(60) + "  "))).toBeNull();
  });
});

describe("required", () => {
  it.each([undefined, null, "", "   ", 5, {}, []])("%j is DEFAULT_FIELD_REQUIRED", (v) => {
    expect(code(() => validateTextField("name", v))).toBe("DEFAULT_FIELD_REQUIRED");
  });
  it("voteType: absent is required, unknown is invalid, the three are accepted", () => {
    expect(code(() => validateVoteType(undefined))).toBe("DEFAULT_FIELD_REQUIRED");
    expect(code(() => validateVoteType("thumbs"))).toBe("DEFAULT_VOTE_TYPE_INVALID");
    for (const v of ["finger", "roman", "modified_roman"]) expect(validateVoteType(v)).toBe(v);
  });
});

describe("plain-text rule (design E4)", () => {
  it.each([
    "Is our deploy rate < 5 a day?",
    "Dev & Ops",
    "R&D time",
    "a <3 b",
    "x<5",
    "ends with <",
    "Unicode: café — and \u{1F600}",
  ])("accepts %j", (text) => {
    expect(code(() => validateTextField("prompt", text))).toBeNull();
  });

  it.each([
    ["an HTML tag", "x <b> y"],
    ["a closing tag", "a </p>"],
    ["a comment", "<!-- c -->"],
    ["a named entity", "&amp;"],
    ["a decimal entity", "&#169;"],
    ["a hex entity", "&#xA9;"],
    ["a hex entity with a control code point", "&#x1F;"],
    ["https", "see https://example.com"],
    ["http, any case", "HTTP://example.com"],
    ["www", "visit www.example.com"],
    ["a markdown link", "[x](y)"],
    ["a bidi override", "abc‮def"],
    ["a zero-width space", "ab​cd"],
    ["a byte order mark", "ab﻿cd"],
    ["U+0000", "ab\u0000cd"],
    ["a tab", "ab\tcd"],
    ["a newline in a prompt", "ab\ncd"],
    ["a carriage return", "ab\rcd"],
    ["a line separator", "ab cd"],
    ["a lone high surrogate", "ab\uD800cd"],
    ["a lone low surrogate", "ab\uDC00cd"],
  ])("rejects %s with PROMPT_FORMAT_INVALID", (_label, text) => {
    expect(code(() => validateTextField("prompt", text))).toBe("PROMPT_FORMAT_INVALID");
    expect(code(() => validateTextField("name", text))).toBe("PROMPT_FORMAT_INVALID");
  });

  it("a description allows \\n and no other control character", () => {
    expect(isPlainText("firstSessionDescription", "line one\nline two")).toBe(true);
    expect(isPlainText("firstSessionDescription", "line one\r\nline two")).toBe(false);
    expect(isPlainText("firstSessionDescription", "a\tb")).toBe(false);
    expect(isPlainText("firstSessionDescription", "a​b")).toBe(false);
    expect(isPlainText("name", "line one\nline two")).toBe(false);
  });

  it("U+2028 and U+2029 are rejected in every field, the description included", () => {
    for (const ch of ["\u2028", "\u2029"]) {
      expect(isPlainText("firstSessionDescription", `a${ch}b`)).toBe(false);
      expect(isPlainText("name", `a${ch}b`)).toBe(false);
      expect(isPlainText("prompt", `a${ch}b`)).toBe(false);
    }
  });

  it("the rejection never carries the offending text", () => {
    try {
      validateTextField("prompt", "<script>alert(1)</script>");
      expect.unreachable();
    } catch (err) {
      expect(JSON.stringify((err as MaintenanceError).detail)).not.toContain("script");
    }
  });
});

describe("nameKey", () => {
  it("is trim + lowercase, no normalization", () => {
    expect(nameKey("  PaIrInG ")).toBe("pairing");
    expect(nameKey("é")).not.toBe(nameKey("é")); // NFC vs NFD differ, recorded
  });
});

describe("findDefaultRowViolation", () => {
  const ok = { name: "A", prompt: "p", vote_type: "finger", first_session_description: "d" };
  it("accepts a valid row and names the first bad field otherwise", () => {
    expect(findDefaultRowViolation(ok)).toBeNull();
    expect(findDefaultRowViolation({ ...ok, prompt: " " })).toEqual({ code: "DEFAULT_FIELD_REQUIRED", field: "prompt" });
    expect(findDefaultRowViolation({ ...ok, first_session_description: null })).toEqual({
      code: "DEFAULT_FIELD_REQUIRED",
      field: "firstSessionDescription",
    });
    expect(findDefaultRowViolation({ ...ok, vote_type: "x" })).toEqual({ code: "DEFAULT_VOTE_TYPE_INVALID", field: "voteType" });
  });
});

describe("the audit constant cannot drift from the AuditEventName union", () => {
  it("MAINTENANCE_AUDIT_OPERATIONS is exactly the five topic.default_* maintenance members", async () => {
    const { MAINTENANCE_AUDIT_OPERATIONS } = await import("../default-topic-maintenance.js");
    const source = readFileSync(fileURLToPath(new URL("../../auth/audit-logger.ts", import.meta.url)), "utf8");
    const members = [...source.matchAll(/^\s*\|\s*"(topic\.default_[a-z_]+)"/gm)].map((m) => m[1]);
    const maintenance = members.filter((m) => m !== "topic.default_maintenance_denied");
    expect([...MAINTENANCE_AUDIT_OPERATIONS].sort()).toEqual([...maintenance].sort());
    expect(MAINTENANCE_AUDIT_OPERATIONS).toHaveLength(5);
    // The denial operation is deliberately not a maintenance operation.
    expect(MAINTENANCE_AUDIT_OPERATIONS as readonly string[]).not.toContain("topic.default_maintenance_denied");
    // A LIKE 'topic.default_%' would also match these existing names (why LIKE is forbidden).
    for (const m of ["topic.defaults_assigned", "topic.defaults_assign_denied", "topic.defaults_assign_failed"]) {
      expect(MAINTENANCE_AUDIT_OPERATIONS as readonly string[]).not.toContain(m);
    }
  });
});
