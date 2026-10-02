// ---------------------------------------------------------------------------
// Canonical UUID shape — the one definition every route-boundary id check
// uses (session-topics-snapshot-at-creation implementation review M1/MF1).
//
// The standard 8-4-4-4-12 hex-and-hyphen form, either case: the shape every
// teams.id / sessions.id / topics.id column produces via gen_random_uuid().
//
// Postgres accepts other spellings as `uuid` input (no hyphens, braces,
// other hyphen groupings) and canonicalises them. A route that authorizes
// on one spelling and then queries with another can therefore see two
// different answers for the same team. Routes reject anything that is not
// canonical HERE, before any query, so the string that is authorized is the
// same string that is used. Authorization helpers never rewrite their input.
//
// Not a Fastify route plugin: a shared helper for the plugins in this
// directory.
// ---------------------------------------------------------------------------

/** Unanchored source, for composing into larger patterns (auth.ts returnTo allow-list). */
export const UUID_PATTERN_SOURCE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const CANONICAL_UUID = new RegExp(`^${UUID_PATTERN_SOURCE}$`);

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}
