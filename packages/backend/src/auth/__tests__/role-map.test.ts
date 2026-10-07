import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROLE_MAP,
  GLOBAL_ROLES,
  PERMITTED_TARGETS,
  RANK,
  RoleMapConfigError,
  isClaimOverage,
  mapValues,
  normalizeClaim,
  parseRoleArray,
  parseRoleMap,
  resolveRoleSet,
  type GlobalRole,
  type MappableRole,
} from "../role-map.js";

// configurable-oidc-role-map (#243). Pure-function tests for the leaf
// role-map module: parsing and startup validation (D1–D6) and claim
// resolution at sign-in (D7).

const DEV = { nodeEnv: "development", issuerIsPrivate: true } as const;
const PROD = { nodeEnv: "production", issuerIsPrivate: false } as const;

function parseError(raw: string | undefined, env: { nodeEnv: string; issuerIsPrivate: boolean } = DEV): RoleMapConfigError {
  try {
    parseRoleMap(raw, env);
  } catch (err) {
    expect(err).toBeInstanceOf(RoleMapConfigError);
    return err as RoleMapConfigError;
  }
  throw new Error("expected parseRoleMap to throw");
}

const PERMITTED_LIST = ["application_admin", "engineering_manager", "facilitator", "senior_engineer"];

// ---------------------------------------------------------------------------
// 1.1 Types and constants
// ---------------------------------------------------------------------------
describe("role-map constants (task 1.1)", () => {
  it("GLOBAL_ROLES equals the user_role enum labels in 1_create_enums.sql", () => {
    const sqlPath = fileURLToPath(new URL("../../../migrations/1_create_enums.sql", import.meta.url));
    const sql = readFileSync(sqlPath, "utf8");
    const match = /CREATE TYPE user_role AS ENUM \(([^)]*)\)/.exec(sql);
    expect(match).not.toBeNull();
    const labels = [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...labels].sort()).toEqual([...GLOBAL_ROLES].sort());
    expect(labels).toHaveLength(GLOBAL_ROLES.length);
  });

  // store-idp-role-set (#245) design D11: users_roles_consistent's rule 4
  // ("strictly descending in enum order") relies on the enum's declaration
  // order being the precedence order. The pg_enum.enumsortorder leg of this
  // check is in users-roles-schema-integration.test.ts (real Postgres).
  it("GLOBAL_ROLES order = ascending RANK order (engineer lowest) = 1_create_enums.sql declaration order", () => {
    const sqlPath = fileURLToPath(new URL("../../../migrations/1_create_enums.sql", import.meta.url));
    const sql = readFileSync(sqlPath, "utf8");
    const match = /CREATE TYPE user_role AS ENUM \(([^)]*)\)/.exec(sql);
    const declared = [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const byRank = [...RANK.entries()].sort(([, a], [, b]) => a - b).map(([role]) => role);

    expect([...GLOBAL_ROLES]).toEqual(["engineer", ...byRank]);
    expect([...GLOBAL_ROLES]).toEqual(declared);
  });

  it("PERMITTED_TARGETS is the four non-engineer roles and RANK orders them", () => {
    expect([...PERMITTED_TARGETS].sort()).toEqual(PERMITTED_LIST);
    expect(PERMITTED_TARGETS.has("engineer" as MappableRole)).toBe(false);
    expect(RANK.get("application_admin")).toBeGreaterThan(RANK.get("engineering_manager")!);
    expect(RANK.get("engineering_manager")).toBeGreaterThan(RANK.get("facilitator")!);
    expect(RANK.get("facilitator")).toBeGreaterThan(RANK.get("senior_engineer")!);
    expect(RANK.size).toBe(4);
  });

  it("DEFAULT_ROLE_MAP maps each permitted target to itself and nothing else", () => {
    expect([...DEFAULT_ROLE_MAP.entries()].sort()).toEqual(PERMITTED_LIST.map((r) => [r, r]));
    expect(DEFAULT_ROLE_MAP.has("engineer")).toBe(false);
  });

  it("RoleMapConfigError carries a message only (no cause)", () => {
    const err = parseError("{");
    expect(err.cause).toBeUndefined();
  });

  it("types reject engineer as a MappableRole (compile-time check)", () => {
    // @ts-expect-error engineer is not a MappableRole
    const bad: MappableRole = "engineer";
    const ok: GlobalRole = "engineer";
    expect([bad, ok]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 1.2 Parsing and shape validation
// ---------------------------------------------------------------------------
describe("parseRoleMap: shape validation (task 1.2)", () => {
  it.each([[""], ["  "], ["\n\t "]])("treats %j as unset (default map outside production with a local issuer)", (raw) => {
    const result = parseRoleMap(raw, DEV);
    expect(result.source).toBe("default");
    expect(result.map).toEqual(DEFAULT_ROLE_MAP);
  });

  it("treats undefined as unset", () => {
    expect(parseRoleMap(undefined, DEV).source).toBe("default");
  });

  it("rejects invalid JSON with the fixed message", () => {
    expect(parseError("{not json").message).toMatch(/^OIDC_ROLE_MAP is not valid JSON/);
  });

  it("invalid JSON message quotes no fragment (>= 4 chars) of a short input (S3)", () => {
    const raw = '{"Secret-Grp":admin}';
    expect(raw.length).toBeLessThan(30);
    const message = parseError(raw).message;
    for (let i = 0; i + 4 <= raw.length; i++) {
      expect(message).not.toContain(raw.slice(i, i + 4));
    }
  });

  it.each([["[]"], ['"x"'], ["1"], ["null"]])("rejects non-object %s", (raw) => {
    expect(parseError(raw).message).toBe("OIDC_ROLE_MAP must be a JSON object");
  });

  it.each([['{"A": null}'], ['{"A": 1}'], ['{"A": ""}']])("rejects non-string or empty target in %s naming key A", (raw) => {
    const message = parseError(raw).message;
    expect(message).toContain('key "A"');
    expect(message).toContain("non-empty role string");
  });

  it("rejects an empty key", () => {
    expect(parseError('{"":"facilitator"}').message).toContain("map keys must be non-empty");
  });

  it.each([[" Eng-Managers"], ["Eng-Managers "]])("rejects key %j with surrounding whitespace", (key) => {
    const message = parseError(JSON.stringify({ [key]: "engineering_manager" })).message;
    expect(message).toContain("must not begin or end with whitespace");
    expect(message).toContain(JSON.stringify(key));
  });

  it.each([
    ['{"Admins":"admin"}', "Admins"],
    ['{"A":"toString"}', "A"],
    ['{"A":"__proto__"}', "A"],
    ['{"A":"constructor"}', "A"],
  ])("rejects unknown target in %s naming the key and listing permitted targets (S4)", (raw, key) => {
    const message = parseError(raw).message;
    expect(message).toContain(`key ${JSON.stringify(key)}`);
    for (const target of PERMITTED_LIST) expect(message).toContain(target);
  });

  it("rejects engineer as a target with the fixed-default explanation", () => {
    const message = parseError('{"Eng-Managers":"engineer"}').message;
    expect(message).toContain('key "Eng-Managers"');
    expect(message).toContain('"engineer"');
    expect(message).toContain("not permitted");
    expect(message).toMatch(/fixed default/);
    expect(message).toMatch(/cannot be mapped/);
  });

  it("returns a fresh copy of the default map, so mutating it cannot change the shared default (impl review C1)", () => {
    const first = parseRoleMap(undefined, DEV).map;
    expect(first).not.toBe(DEFAULT_ROLE_MAP);
    (first as Map<string, MappableRole>).set("Everyone", "application_admin");
    expect(DEFAULT_ROLE_MAP.has("Everyone")).toBe(false);
    expect(parseRoleMap(undefined, DEV).map.has("Everyone")).toBe(false);
  });

  // Impl review N4: invisible or control characters inside a key (copy-paste
  // from IdP consoles) would make the key silently never match.
  it.each([
    ["zero-width space", "Eng" + String.fromCharCode(0x200b) + "-Managers"],
    ["word joiner", "Eng" + String.fromCharCode(0x2060) + "-Managers"],
    ["byte-order mark", "Eng-" + String.fromCharCode(0xfeff) + "Managers"],
    ["zero-width joiner", "Eng" + String.fromCharCode(0x200d) + "-Managers"],
    ["control character", "Eng" + String.fromCharCode(0x07) + "-Managers"],
  ])("rejects a key containing a %s, naming the key escaped", (_label, key) => {
    const message = parseError(JSON.stringify({ [key]: "engineering_manager" })).message;
    expect(message).toContain("invisible or control characters");
    // The key is shown with the invisible character escaped, never raw.
    expect(message).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(message).toMatch(/\\u[0-9a-f]{4}|\\[a-z]/i);
  });

  it("escapes a key containing a newline in the message (C2)", () => {
    const message = parseError(JSON.stringify({ "Bad\nKey": "nope" })).message;
    expect(message).not.toContain("\n");
    expect(message).toContain('"Bad\\nKey"');
  });

  it("accepts a valid map and returns the full result shape", () => {
    const result = parseRoleMap('{"Dipstick-Admins":"application_admin","Eng-Managers":"engineering_manager"}', DEV);
    expect(result.source).toBe("configured");
    expect(result.map.get("Dipstick-Admins")).toBe("application_admin");
    expect(result.map.get("Eng-Managers")).toBe("engineering_manager");
    expect(result.map.size).toBe(2);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.summary).toBe("string");
  });

  it("accepts an operator-written __proto__ key as an own key (D2)", () => {
    const result = parseRoleMap('{"__proto__":"facilitator"}', DEV);
    expect(result.map.get("__proto__")).toBe("facilitator");
    expect(result.map.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 1.3 Duplicate-key scanner (exactly three scanner tests + pipeline order)
// ---------------------------------------------------------------------------
describe("parseRoleMap: duplicate keys (task 1.3)", () => {
  it("(a) rejects a literal duplicate key", () => {
    const message = parseError('{"Eng-Managers":"engineering_manager","Eng-Managers":"senior_engineer"}').message;
    expect(message).toContain('"Eng-Managers"');
    expect(message).toMatch(/more than once/);
  });

  it("(b) rejects an escape-equivalent duplicate key (S6)", () => {
    // Second key spells "E" as the six-character JSON escape (backslash, u, 0045),
    // built by concatenation so the escape reaches JSON.parse undecoded.
    const escapedE = "\\" + "u0045";
    const raw = `{"Eng-Managers":"engineering_manager","${escapedE}ng-Managers":"senior_engineer"}`;
    expect(raw).toContain("\\");
    const message = parseError(raw).message;
    expect(message).toContain('"Eng-Managers"');
    expect(message).toMatch(/more than once/);
  });

  it("(c) does not false-positive on an escaped quote with duplicate-looking text inside a key", () => {
    const raw = String.raw`{"a\",\"a":"facilitator","a":"senior_engineer"}`;
    const result = parseRoleMap(raw, DEV);
    expect(result.map.size).toBe(2);
    expect(result.map.get('a","a')).toBe("facilitator");
    expect(result.map.get("a")).toBe("senior_engineer");
  });

  it("checks duplicates before targets (pipeline order)", () => {
    expect(parseError('{"A":"engineer","A":"facilitator"}').message).toMatch(/more than once/);
  });
});

// ---------------------------------------------------------------------------
// 1.4 Deployment rules and missing-target warnings
// ---------------------------------------------------------------------------
describe("parseRoleMap: deployment rules (task 1.4)", () => {
  it.each([[undefined], [""], ["  "]])("production with %j fails as required", (raw) => {
    expect(parseError(raw, PROD).message).toBe("OIDC_ROLE_MAP is required in production");
  });

  it("production {} fails on the manager guard", () => {
    expect(parseError("{}", PROD).message).toMatch(/at least one key must target "engineering_manager"/);
  });

  it("production map without a manager target fails on the manager guard", () => {
    const raw = '{"Dipstick-Admins":"application_admin","Retro-Facilitators":"facilitator"}';
    expect(parseError(raw, PROD).message).toMatch(/at least one key must target "engineering_manager"/);
  });

  it("production map without facilitator warns once", () => {
    const result = parseRoleMap('{"Eng-Managers":"engineering_manager","Dipstick-Admins":"application_admin"}', PROD);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/facilitator/);
    expect(result.warnings[0]).toMatch(/no user will be able to run a session/);
  });

  it("production map without admin warns once", () => {
    const result = parseRoleMap('{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitator"}', PROD);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no IdP value maps to application_admin/);
  });

  it("non-production facilitator-only map boots with exactly two warnings (manager, admin)", () => {
    const result = parseRoleMap('{"Retro-Facilitators":"facilitator"}', DEV);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.some((w) => /engineering_manager/.test(w) && /managers will be treated as engineers/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /application_admin/.test(w))).toBe(true);
  });

  it("non-production {} boots with three warnings and an empty map", () => {
    const result = parseRoleMap("{}", DEV);
    expect(result.warnings).toHaveLength(3);
    expect(result.map.size).toBe(0);
    expect(result.source).toBe("configured");
  });

  it.each([["development"], ["staging"], ["test"]])("NODE_ENV=%s unset with a local issuer uses the default with no warnings", (nodeEnv) => {
    const result = parseRoleMap(undefined, { nodeEnv, issuerIsPrivate: true });
    expect(result.source).toBe("default");
    expect(result.warnings).toEqual([]);
  });

  it.each([["staging"], ["prod"], ["development"], ["uat"]])("NODE_ENV=%s unset with a non-local issuer fails (S2)", (nodeEnv) => {
    expect(parseError(undefined, { nodeEnv, issuerIsPrivate: false }).message).toBe(
      "OIDC_ROLE_MAP is required when OIDC_ISSUER is not a local address",
    );
  });

  it("a configured map with a non-local issuer outside production is accepted", () => {
    const result = parseRoleMap('{"Eng-Managers":"engineering_manager"}', { nodeEnv: "staging", issuerIsPrivate: false });
    expect(result.source).toBe("configured");
  });
});

// ---------------------------------------------------------------------------
// 1.5 Summary line and no-echo rules
// ---------------------------------------------------------------------------
describe("parseRoleMap: summary and no-echo (task 1.5)", () => {
  it("summarises a configured map with counts for all four targets and no key names", () => {
    const result = parseRoleMap('{"EM-A":"engineering_manager","EM-B":"engineering_manager","Facil":"facilitator"}', DEV);
    expect(result.summary).toBe(
      "OIDC_ROLE_MAP: source=configured engineering_manager=2 facilitator=1 application_admin=0 senior_engineer=0",
    );
    for (const key of ["EM-A", "EM-B", "Facil"]) expect(result.summary).not.toContain(key);
  });

  it("summarises the default map as 1/1/1/1", () => {
    expect(parseRoleMap(undefined, DEV).summary).toBe(
      "OIDC_ROLE_MAP: source=default engineering_manager=1 facilitator=1 application_admin=1 senior_engineer=1",
    );
  });

  it("every warning starts with the OIDC_ROLE_MAP: prefix", () => {
    for (const w of parseRoleMap("{}", DEV).warnings) expect(w.startsWith("OIDC_ROLE_MAP:")).toBe(true);
  });

  it("the raw multi-entry value never appears in returned or thrown text", () => {
    const good = '{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitator"}';
    const result = parseRoleMap(good, DEV);
    for (const text of [result.summary, ...result.warnings]) expect(text).not.toContain(good);

    const bad = '{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitatr"}';
    expect(parseError(bad).message).not.toContain(bad);
    expect(parseError(bad).message).not.toContain("Eng-Managers");
  });
});

// ---------------------------------------------------------------------------
// 3.1 Claim resolution
// ---------------------------------------------------------------------------
describe("claim resolution (task 3.1)", () => {
  const MAP: ReadonlyMap<string, MappableRole> = new Map<string, MappableRole>([
    ["Dipstick-Admins", "application_admin"],
    ["Eng-Managers", "engineering_manager"],
    ["Retro-Facilitators", "facilitator"],
    ["Seniors", "senior_engineer"],
  ]);

  it("normalizeClaim keeps non-empty strings only", () => {
    expect(normalizeClaim("A")).toEqual(["A"]);
    expect(normalizeClaim(["A", 42, "", null, "B"])).toEqual(["A", "B"]);
    expect(normalizeClaim("")).toEqual([]);
    expect(normalizeClaim([])).toEqual([]);
    expect(normalizeClaim(7)).toEqual([]);
    expect(normalizeClaim({ a: "b" })).toEqual([]);
    expect(normalizeClaim(true)).toEqual([]);
    expect(normalizeClaim(undefined)).toEqual([]);
  });

  it("mapValues uses own-key lookup only", () => {
    expect(mapValues(["Eng-Managers", "constructor", "toString", "__proto__"], MAP)).toEqual(["engineering_manager"]);
  });

  it.each([
    ["string", "Eng-Managers", "engineering_manager", "mapped"],
    ["array", ["All-Staff", "Retro-Facilitators"], "facilitator", "mapped"],
    ["mixed array", ["Eng-Managers", 42], "engineering_manager", "mapped"],
    ["empty string", "", "engineer", "missing"],
    ["empty array", [], "engineer", "missing"],
    ["no surviving elements", ["", 42, null], "engineer", "missing"],
    ["number", 42, "engineer", "missing"],
    ["object", { groups: ["Eng-Managers"] }, "engineer", "missing"],
    ["undefined", undefined, "engineer", "missing"],
    ["unmapped", ["All-Staff", "Building-3"], "engineer", "unmapped"],
    ["partial match", ["Eng-Managers", "All-Staff"], "engineering_manager", "mapped"],
    ["case mismatch", "eng-managers", "engineer", "unmapped"],
    ["constructor", "constructor", "engineer", "unmapped"],
    ["__proto__", "__proto__", "engineer", "unmapped"],
    ["toString", "toString", "engineer", "unmapped"],
  ])("%s resolves correctly", (_label, claim, role, outcome) => {
    const result = resolveRoleSet(claim, MAP);
    expect(result.role).toBe(role);
    expect(result.outcome).toBe(outcome);
    expect(result.roles[0]).toBe(role);
  });

  it("an operator-written __proto__ key resolves", () => {
    const map = parseRoleMap('{"__proto__":"facilitator"}', DEV).map;
    expect(resolveRoleSet("__proto__", map).role).toBe("facilitator");
    expect(resolveRoleSet("__proto__", map).roles).toEqual(["facilitator"]);
  });

  // store-idp-role-set (#245) task 4.2: every precedence row asserts the
  // exact role set (order and length), highest precedence first (D1).
  it.each([
    [["Retro-Facilitators", "Eng-Managers", "Dipstick-Admins", "Eng-Managers"], "application_admin", ["application_admin", "engineering_manager", "facilitator"], ["engineering_manager", "facilitator"]],
    [["Dipstick-Admins", "Retro-Facilitators"], "application_admin", ["application_admin", "facilitator"], ["facilitator"]],
    [["Eng-Managers", "Retro-Facilitators"], "engineering_manager", ["engineering_manager", "facilitator"], ["facilitator"]],
    [["Dipstick-Admins", "Eng-Managers"], "application_admin", ["application_admin", "engineering_manager"], ["engineering_manager"]],
    [["Retro-Facilitators", "Eng-Managers", "Dipstick-Admins"], "application_admin", ["application_admin", "engineering_manager", "facilitator"], ["engineering_manager", "facilitator"]],
    [["Retro-Facilitators", "Seniors"], "facilitator", ["facilitator", "senior_engineer"], []],
    [["Seniors", "Dipstick-Admins"], "application_admin", ["application_admin", "senior_engineer"], []],
    [["Retro-Facilitators"], "facilitator", ["facilitator"], []],
    ["Retro-Facilitators", "facilitator", ["facilitator"], []],
    [["Seniors"], "senior_engineer", ["senior_engineer"], []],
  ])("precedence for %j → %s, roles %j, discarded %j", (claim, role, roles, discarded) => {
    const result = resolveRoleSet(claim, MAP);
    expect(result.role).toBe(role);
    expect(result.roles).toEqual(roles);
    expect(result.discardedRoles).toEqual(discarded);
  });

  it.each([
    ["missing claim", undefined, "missing"],
    ["nothing mapped", ["All-Staff"], "unmapped"],
    ["prototype names", ["toString", "__proto__", "constructor"], "unmapped"],
  ])("%s → roles [engineer] (outcome %s)", (_label, claim, outcome) => {
    const result = resolveRoleSet(claim, MAP);
    expect(result.roles).toEqual(["engineer"]);
    expect(result.role).toBe("engineer");
    expect(result.outcome).toBe(outcome);
  });

  it("no mapping yields engineer from mapValues", () => {
    // Every permitted target, plus engineer-looking keys: engineer never appears.
    const everything = parseRoleMap(
      '{"a":"application_admin","b":"engineering_manager","c":"facilitator","d":"senior_engineer"}',
      DEV,
    ).map;
    expect(mapValues(["a", "b", "c", "d", "engineer"], everything)).not.toContain("engineer");
    expect(mapValues(["engineer"], DEFAULT_ROLE_MAP)).toEqual([]);
    expect(resolveRoleSet(["a", "b", "c", "d"], everything).roles).not.toContain("engineer");
  });

  it("the [engineer] fallback is a fresh array per call", () => {
    const first = resolveRoleSet(undefined, MAP);
    const second = resolveRoleSet(undefined, MAP);
    const third = resolveRoleSet(["All-Staff"], MAP);
    expect(first.roles).not.toBe(second.roles);
    expect(first.roles).not.toBe(third.roles);
  });

  it("default map preserves today's roles and grants facilitator/senior_engineer", () => {
    for (const r of ["engineering_manager", "application_admin", "facilitator", "senior_engineer"]) {
      expect(resolveRoleSet(r, DEFAULT_ROLE_MAP).role).toBe(r);
    }
    expect(resolveRoleSet("engineer", DEFAULT_ROLE_MAP)).toMatchObject({ role: "engineer", outcome: "unmapped" });
  });

  it("isClaimOverage detects an own _claim_names entry only", () => {
    expect(isClaimOverage({ _claim_names: { groups: "src1" } }, "groups")).toBe(true);
    expect(isClaimOverage({ _claim_names: { groups: "src1" } }, "role")).toBe(false);
    expect(isClaimOverage({ _claim_names: {} }, "toString")).toBe(false);
    expect(isClaimOverage({}, "groups")).toBe(false);
    expect(isClaimOverage({ _claim_names: "groups" }, "groups")).toBe(false);
    expect(isClaimOverage({ _claim_names: ["groups"] }, "0")).toBe(false);
    expect(isClaimOverage({ _claim_names: null }, "groups")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// store-idp-role-set (#245) task 4.2: parseRoleArray (design D5)
// ---------------------------------------------------------------------------
describe("parseRoleArray", () => {
  it("accepts a valid role array and returns a frozen copy", () => {
    const input = ["engineering_manager", "facilitator"];
    const parsed = parseRoleArray(input);
    expect(parsed).toEqual(["engineering_manager", "facilitator"]);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ["the raw enum-array string", "{a,b}"],
    ["an empty array", []],
    ["a prototype name", ["toString"]],
    ["a null element", ["engineer", null]],
    ["a non-array", { 0: "engineer", length: 1 }],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(() => parseRoleArray(value)).toThrow();
  });
});
