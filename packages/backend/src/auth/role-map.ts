// ---------------------------------------------------------------------------
// role-map — configurable OIDC role map (#243, configurable-oidc-role-map).
//
// Translates the values on the IdP's role claim (OIDC_ROLE_CLAIM) into the
// fixed internal global roles, using a per-deployment OIDC_ROLE_MAP.
//
// LEAF MODULE (design D1, R4): config.ts imports from this file, so this file
// must NOT import config.js, db.js, or anything that does — that would be a
// load-time cycle. Its only imports are type-only or Node built-ins.
//
// Security rules this module enforces (design D2–D7, security review S1–S8):
//   - Lookups on both sides are own-key only (Map/Set), so names inherited
//     from Object.prototype (constructor, __proto__, toString) can never
//     resolve as a claim value or be accepted as a target.
//   - `engineer` is the fixed fallback and is never a valid target.
//   - Error, warning and summary text never carries the raw OIDC_ROLE_MAP
//     value or a JSON.parse error message; keys and targets are interpolated
//     with JSON.stringify so they cannot split or forge a log line.
//   - Nothing here logs. Callers decide where text goes; claim values are
//     never returned in any text.
// ---------------------------------------------------------------------------

/** The Postgres `user_role` enum, as a TypeScript union (R1). */
export type GlobalRole =
  | "engineer"
  | "senior_engineer"
  | "facilitator"
  | "engineering_manager"
  | "application_admin";

/** Roles an OIDC_ROLE_MAP entry may target. `engineer` is the fixed fallback. */
export type MappableRole = Exclude<GlobalRole, "engineer">;

/**
 * Runtime copy of the GlobalRole labels. role-map.test.ts asserts these equal
 * the `user_role` labels in migrations/1_create_enums.sql — that test is the
 * only thing tying this union to the Postgres enum.
 */
export const GLOBAL_ROLES: readonly GlobalRole[] = Object.freeze([
  "engineer",
  "senior_engineer",
  "facilitator",
  "engineering_manager",
  "application_admin",
] as const);

// Fixed precedence (binding user decision on #243). A Record literal makes a
// missing or extra role a compile error; it is then copied into a Map so no
// lookup can ever reach Object.prototype (S4). A Map cannot be frozen:
// ReadonlyMap/ReadonlySet are compile-time guarantees only, so these
// constants are never handed out for callers to hold (see parseRoleMap).
const RANK_RECORD: Record<MappableRole, number> = {
  application_admin: 4,
  engineering_manager: 3,
  facilitator: 2,
  senior_engineer: 1,
};

export const RANK: ReadonlyMap<MappableRole, number> = new Map(
  Object.entries(RANK_RECORD) as [MappableRole, number][],
);

export const PERMITTED_TARGETS: ReadonlySet<MappableRole> = new Set(RANK.keys());

const FALLBACK_ROLE: GlobalRole = "engineer";

// Order used in messages and the summary line (design D1a example).
const SUMMARY_ORDER: readonly MappableRole[] = [
  "engineering_manager",
  "facilitator",
  "application_admin",
  "senior_engineer",
];

const PERMITTED_LIST_TEXT = [...PERMITTED_TARGETS].sort().join(", ");

/**
 * Identity default (design D6). Used only when OIDC_ROLE_MAP is unset,
 * NODE_ENV !== "production" and OIDC_ISSUER is a local/private address.
 * Built in code, not parsed, so the parser needs no exception for it.
 * parseRoleMap returns a copy of it, never this instance.
 * A claim of `engineer` is unmapped and falls through to the fallback.
 */
export const DEFAULT_ROLE_MAP: ReadonlyMap<string, MappableRole> = new Map<string, MappableRole>([
  ["application_admin", "application_admin"],
  ["engineering_manager", "engineering_manager"],
  ["facilitator", "facilitator"],
  ["senior_engineer", "senior_engineer"],
]);

/**
 * Startup validation failure. Message only: never the raw value, a
 * JSON.parse message, or a `cause` (S3).
 */
export class RoleMapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleMapConfigError";
  }
}

export interface RoleMapEnv {
  nodeEnv: string;
  /** isPrivateAddress(OIDC_ISSUER), computed by loadConfig (keeps this a leaf). */
  issuerIsPrivate: boolean;
}

export interface ParsedRoleMap {
  map: ReadonlyMap<string, MappableRole>;
  source: "configured" | "default";
  warnings: string[];
  summary: string;
}

// JSON.stringify escapes C0 controls, quotes and backslashes but leaves
// invisible format characters (zero-width space, BOM, bidi marks), C1
// controls and the U+2028/U+2029 line separators as-is. Escape those too, so
// an operator sees exactly what is in a key and nothing can split or hide
// text in a log line (C2).
const INVISIBLE_FOR_DISPLAY = /[\p{Cf}\p{Cc}\u2028\u2029]/gu;
const q = (s: string): string =>
  JSON.stringify(s).replace(
    INVISIBLE_FOR_DISPLAY,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );

// Keys may not contain control characters or the zero-width/format characters
// that copy-paste from IdP consoles tends to introduce (implementation review
// N4). Such a key can never match a real claim value, so it would silently
// drop users (for a manager key, a silent fail-open of the no-manager rule).
// Deliberately narrow: other format characters (e.g. bidi marks) are left
// alone so legitimate right-to-left group names still work.
const FORBIDDEN_IN_KEY = /[\p{Cc}\u200B-\u200D\u2060\uFEFF]/u;

// ---------------------------------------------------------------------------
// Duplicate top-level key detection (design D3).
//
// JSON.parse silently keeps the last duplicate, so after a successful parse
// to a plain object we scan the raw text. Handles: escape sequences inside
// strings; key position (after `{` or `,` at depth 1) versus value position;
// escape-equivalent keys (each key token is decoded with JSON.parse before
// comparison). Fails closed: input it cannot tokenise throws.
// ---------------------------------------------------------------------------
function assertUniqueTopLevelKeys(raw: string): void {
  const cannotVerify = (): never => {
    throw new RoleMapConfigError("OIDC_ROLE_MAP: could not verify that keys are unique");
  };
  const seen = new Set<string>();
  let depth = 0;
  let prev = ""; // previous significant structural token
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j += raw[j] === "\\" ? 2 : 1;
      if (j >= raw.length) cannotVerify();
      if (depth === 1 && (prev === "{" || prev === ",")) {
        let key: unknown;
        try {
          key = JSON.parse(raw.slice(i, j + 1));
        } catch {
          cannotVerify();
        }
        if (typeof key !== "string") cannotVerify();
        if (seen.has(key as string)) {
          throw new RoleMapConfigError(
            `OIDC_ROLE_MAP: key ${q(key as string)} appears more than once; duplicate keys are not allowed`,
          );
        }
        seen.add(key as string);
      }
      prev = '"';
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) cannotVerify();
    }
    if ("{}[],:".includes(ch)) prev = ch;
    else if (!/\s/.test(ch)) prev = "v"; // number / literal character
    i++;
  }
  if (depth !== 0) cannotVerify();
}

function validateEntries(obj: Record<string, unknown>): Map<string, MappableRole> {
  const map = new Map<string, MappableRole>();
  for (const [key, target] of Object.entries(obj)) {
    if (key.length === 0) {
      throw new RoleMapConfigError("OIDC_ROLE_MAP: map keys must be non-empty");
    }
    if (key.trim() !== key) {
      throw new RoleMapConfigError(`OIDC_ROLE_MAP: key ${q(key)} must not begin or end with whitespace`);
    }
    if (FORBIDDEN_IN_KEY.test(key)) {
      throw new RoleMapConfigError(
        `OIDC_ROLE_MAP: key ${q(key)} contains invisible or control characters (zero-width, BOM or control); retype it`,
      );
    }
    if (typeof target !== "string" || target.length === 0) {
      throw new RoleMapConfigError(`OIDC_ROLE_MAP: key ${q(key)} must target a non-empty role string`);
    }
    if (target === FALLBACK_ROLE) {
      throw new RoleMapConfigError(
        `OIDC_ROLE_MAP: key ${q(key)} targets "engineer", which is not permitted ` +
          "(engineer is the fixed default every unmapped user already receives, so it cannot be mapped)",
      );
    }
    if (!PERMITTED_TARGETS.has(target as MappableRole)) {
      throw new RoleMapConfigError(
        `OIDC_ROLE_MAP: key ${q(key)} targets ${q(target)}, which is not a permitted target ` +
          `(permitted: ${PERMITTED_LIST_TEXT})`,
      );
    }
    map.set(key, target as MappableRole);
  }
  return map;
}

function summarise(map: ReadonlyMap<string, MappableRole>, source: "configured" | "default"): string {
  const counts = new Map<MappableRole, number>(SUMMARY_ORDER.map((r) => [r, 0]));
  for (const target of map.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
  return `OIDC_ROLE_MAP: source=${source} ${SUMMARY_ORDER.map((r) => `${r}=${counts.get(r)}`).join(" ")}`;
}

/**
 * Parses and validates OIDC_ROLE_MAP (design D1, D4–D6). Throws
 * RoleMapConfigError on the first failure, in this order: JSON parse, object
 * shape, duplicate keys, per-entry rules, deployment guards.
 */
export function parseRoleMap(raw: string | undefined, env: RoleMapEnv): ParsedRoleMap {
  const isProduction = env.nodeEnv === "production";
  const isUnset = raw === undefined || raw.trim() === "";

  if (isUnset) {
    if (isProduction) throw new RoleMapConfigError("OIDC_ROLE_MAP is required in production");
    if (!env.issuerIsPrivate) {
      throw new RoleMapConfigError("OIDC_ROLE_MAP is required when OIDC_ISSUER is not a local address");
    }
    // A fresh copy: ReadonlyMap is compile-time only, and handing out the
    // shared constant would let a stray `.set()` anywhere change
    // authorization for the whole process (implementation review C1).
    const map = new Map(DEFAULT_ROLE_MAP);
    return { map, source: "default", warnings: [], summary: summarise(map, "default") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fixed message: never err.message (Node quotes input fragments) or cause (S3).
    throw new RoleMapConfigError("OIDC_ROLE_MAP is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RoleMapConfigError("OIDC_ROLE_MAP must be a JSON object");
  }

  assertUniqueTopLevelKeys(raw);
  const map = validateEntries(parsed as Record<string, unknown>);

  const targeted = new Set(map.values());
  if (isProduction && !targeted.has("engineering_manager")) {
    throw new RoleMapConfigError(
      'OIDC_ROLE_MAP: at least one key must target "engineering_manager" in production',
    );
  }

  const warnings: string[] = [];
  if (!targeted.has("engineering_manager")) {
    warnings.push("OIDC_ROLE_MAP: no IdP value maps to engineering_manager; managers will be treated as engineers");
  }
  if (!targeted.has("facilitator")) {
    warnings.push("OIDC_ROLE_MAP: no IdP value maps to facilitator; no user will be able to run a session");
  }
  if (!targeted.has("application_admin")) {
    warnings.push("OIDC_ROLE_MAP: no IdP value maps to application_admin; no user will be an application admin");
  }

  return { map, source: "configured", warnings, summary: summarise(map, "configured") };
}

// ---------------------------------------------------------------------------
// Resolution at sign-in (design D7).
// ---------------------------------------------------------------------------

/** Non-empty string → [s]; array → its non-empty string elements; else []. */
export function normalizeClaim(claim: unknown): string[] {
  if (typeof claim === "string") return claim.length > 0 ? [claim] : [];
  if (Array.isArray(claim)) {
    return claim.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

/** Own-key lookup of each value; unmapped values are dropped. */
export function mapValues(values: readonly string[], map: ReadonlyMap<string, MappableRole>): MappableRole[] {
  const mapped: MappableRole[] = [];
  for (const v of values) {
    const role = map.get(v);
    if (role !== undefined) mapped.push(role);
  }
  return mapped;
}

export type DiscardableRole = "engineering_manager" | "facilitator";

export interface RoleResolution {
  role: GlobalRole;
  /** Outranked roles that gate something; drives a log line only, never audit (D8). */
  discardedRoles: ReadonlyArray<DiscardableRole>;
  outcome: "missing" | "unmapped" | "mapped";
}

/**
 * store-idp-role-set (#245) design D1/D4: the full mapped role set, de-
 * duplicated and sorted highest precedence first, so `role` (= roles[0]) is
 * the effective global_role. `{engineer}` when nothing maps.
 */
export interface RoleSetResolution extends RoleResolution {
  roles: readonly GlobalRole[];
}

const DISCARDABLE: readonly DiscardableRole[] = ["engineering_manager", "facilitator"];

/** Descending precedence. Never a bare or string .sort(): see resolveRoleSet. */
const byPrecedenceDesc = (a: MappableRole, b: MappableRole): number => RANK.get(b)! - RANK.get(a)!;

export function resolveRoleSet(claim: unknown, map: ReadonlyMap<string, MappableRole>): RoleSetResolution {
  const values = normalizeClaim(claim);
  // A freshly built array per call, so no caller can share (or mutate) another's set.
  if (values.length === 0) return { roles: [FALLBACK_ROLE], role: FALLBACK_ROLE, discardedRoles: [], outcome: "missing" };
  const mapped = mapValues(values, map);
  if (mapped.length === 0) return { roles: [FALLBACK_ROLE], role: FALLBACK_ROLE, discardedRoles: [], outcome: "unmapped" };

  // mapValues never yields `engineer` (it is not a permitted target, and
  // PERMITTED_TARGETS = RANK's keys), so every RANK.get below is defined.
  // The explicit comparator is load-bearing (security S-a): today the four
  // mappable labels' alphabetical order happens to equal descending
  // precedence, so a comparator-less sort would pass every test and break
  // silently when a label is added.
  const roles: MappableRole[] = [...new Set(mapped)].sort(byPrecedenceDesc);
  const role = roles[0]!;
  const discardedRoles = DISCARDABLE.filter((r) => roles.includes(r) && RANK.get(role)! > RANK.get(r)!);
  return { roles, role, discardedRoles, outcome: "mapped" };
}

/**
 * store-idp-role-set (#245) design D5: validates a role array read back from
 * Postgres (`roles::text[]`, which node-postgres parses into a JS array; a raw
 * `user_role[]` would arrive as the string "{a,b}"). It must be a non-empty
 * array whose every element is a GLOBAL_ROLES label; anything else throws,
 * which fails the sign-in closed. Returns a frozen copy.
 */
export function parseRoleArray(value: unknown): readonly GlobalRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("role array is not a non-empty array");
  }
  for (const element of value) {
    if (typeof element !== "string" || !(GLOBAL_ROLES as readonly string[]).includes(element)) {
      throw new Error("role array contains a value that is not a global role");
    }
  }
  return Object.freeze([...(value as GlobalRole[])]);
}

/**
 * True when the token signals that `claimName` was omitted for overage
 * (Entra: `_claim_names.groups`), checked as an own property of a plain
 * object so inherited names never match (S8).
 */
export function isClaimOverage(claims: Record<string, unknown>, claimName: string): boolean {
  const names = claims["_claim_names"];
  if (typeof names !== "object" || names === null || Array.isArray(names)) return false;
  return Object.prototype.hasOwnProperty.call(names, claimName);
}
