import { db } from "../db.js";
import { config } from "../config.js";

export interface IdTokenClaims {
  sub: string;
  iss: string;
  name?: string | undefined;
  email?: string | undefined;
  // Role claim — read from the signed ID token only (never from userinfo).
  // The claim name is configurable via OIDC_ROLE_CLAIM (default: 'role').
  // This field carries whatever value the IdP placed under that claim name.
  // resolveOrCreateAccount validates it against an allowlist before mapping.
  [key: string]: unknown;
}

export interface ResolvedUser {
  id: string;
  oidcSubject: string;
  oidcIssuer: string;
  displayName: string;
  email: string;
  globalRole: string;
  isNewUser: boolean;
}

// ---------------------------------------------------------------------------
// Global role mapping (Decision 2, design.md — establish-manager-team-relationship)
//
// The OIDC_ROLE_CLAIM env var names the ID token claim that carries the role
// assignment (default: 'role'). The claim is read from the SIGNED ID token
// only — never from the userinfo endpoint. The claim value is validated
// against PERMITTED_GLOBAL_ROLES before mapping. Any value not on the allowlist
// is silently treated as absent (the user receives the default: 'engineer').
//
// The mapping is re-evaluated on EVERY authentication so that an IdP
// administrator's role change is reflected at the user's next sign-in.
// ---------------------------------------------------------------------------
const ROLE_CLAIM_NAME = config.OIDC_ROLE_CLAIM ?? "role";

// Allowlist of permitted role strings from the IdP claim.
// A claim value not on this list is treated as absent — logged as a warning,
// NOT written to the audit trail (claim values are attacker-controlled input
// and must never appear in audit records).
const PERMITTED_GLOBAL_ROLES = new Set([
  "engineer",
  "engineering_manager",
  "application_admin",
]);

const DEFAULT_GLOBAL_ROLE = "engineer";

/**
 * Maps the raw IdP role claim value to a permitted global_role string.
 *
 * Returns DEFAULT_GLOBAL_ROLE when:
 * - the claim is absent from the token
 * - the claim value is not on the allowlist
 *
 * Returns the mapped role when the claim value is on the allowlist.
 *
 * @param rawClaimValue - the raw value from the ID token claim (may be any type)
 * @param logger - optional logger for emitting warnings on rejected claim values
 */
function mapRoleClaimToGlobalRole(
  rawClaimValue: unknown,
  logger?: { warn: (msg: string, fields?: Record<string, unknown>) => void },
): string {
  if (rawClaimValue === undefined || rawClaimValue === null) {
    return DEFAULT_GLOBAL_ROLE;
  }

  const claimString = String(rawClaimValue);

  if (!PERMITTED_GLOBAL_ROLES.has(claimString)) {
    // Log a warning but do NOT include the raw claim value in any audit record.
    // The value is attacker-controlled and logging it to the audit trail could
    // be exploited to inject misleading content into compliance-relevant records.
    logger?.warn(
      "OIDC role claim value not on allowlist — treating as absent; user receives default role",
      { claimName: ROLE_CLAIM_NAME },
    );
    return DEFAULT_GLOBAL_ROLE;
  }

  return claimString;
}

export async function resolveOrCreateAccount(
  claims: IdTokenClaims,
  logger?: { warn: (msg: string, fields?: Record<string, unknown>) => void },
): Promise<ResolvedUser> {
  // Task 1 — column type verification: display_name and email are both
  // TEXT (unconstrained) in migration 2_create_tables.sql. Neither is
  // VARCHAR(n)-constrained, so no truncation logic is required before the
  // upsert even when the sub claim is used as the display_name fallback.
  const displayName = (claims.name as string | undefined) ?? (claims.email as string | undefined) ?? claims.sub;
  const email = (claims.email as string | undefined) ?? `${claims.sub}@unknown`;

  // Map the IdP role claim to a global_role value (Decision 2, establish-manager-team-relationship).
  // Read from the signed ID token only; re-evaluated on every authentication.
  const rawRoleClaim = claims[ROLE_CLAIM_NAME];
  const globalRole = mapRoleClaimToGlobalRole(rawRoleClaim, logger);

  // Determine whether this is a new user before the upsert.
  //
  // Task 10 — CONSTRAINT on isNewUser reliability under concurrent load:
  //   This SELECT executes before the upsert below. In a concurrent scenario
  //   where two authentication callbacks arrive simultaneously for the same
  //   sub/iss before any account exists, both reads will see zero rows and
  //   both will set isNewUser = true. The upsert (below) handles this
  //   correctly at the database level — exactly one account is created — but
  //   any downstream consumer of isNewUser may fire twice.
  //
  //   This is a HARD CONSTRAINT on future work: before any feature that
  //   consumes isNewUser is merged, this SELECT-before-upsert pattern MUST
  //   be replaced with a pattern that derives isNewUser from the upsert
  //   result (e.g., via xmax inspection or an INSERT-returning flag column),
  //   or the consuming feature MUST treat duplicate firings as idempotent.
  //
  //   The current only consumer of isNewUser is the auth.first_access_created
  //   audit event, which is safe to emit twice (the audit trail is the only
  //   side effect and a duplicate is detectable by correlation ID).
  const existing = await db.query(
    `SELECT id, oidc_subject, oidc_issuer, display_name, email FROM users
     WHERE oidc_subject = $1 AND oidc_issuer = $2`,
    [claims.sub, claims.iss],
  );

  const isNewUser = existing.rows.length === 0;

  // Upsert: insert or update profile data on conflict.
  //
  // Task 11 — Identity match key is (oidc_subject, oidc_issuer) only.
  // Email appears in the SET clause below (it is updated on each
  // authentication) but does NOT appear in the ON CONFLICT clause, any WHERE
  // condition, or any JOIN used for identity resolution. A returning user who
  // authenticates with the same sub/iss but a changed email address is matched
  // to their existing account and their stored email is updated — see
  // Capability 2 in proposal.md. Email must never be added to the WHERE or
  // ON CONFLICT clauses; that would break the sub/iss-only identity guarantee.
  //
  // global_role is included in the upsert and updated on every sign-in so that
  // IdP role changes (e.g., EM promoted/removed) are reflected at the user's
  // next authentication (Decision 2, establish-manager-team-relationship).
  const result = await db.query(
    `INSERT INTO users (oidc_subject, oidc_issuer, display_name, email, global_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (oidc_subject, oidc_issuer)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       global_role = EXCLUDED.global_role,
       updated_at = NOW()
     RETURNING id, oidc_subject, oidc_issuer, display_name, email, global_role`,
    [claims.sub, claims.iss, displayName, email, globalRole],
  );

  const row = result.rows[0] as {
    id: string;
    oidc_subject: string;
    oidc_issuer: string;
    display_name: string;
    email: string;
    global_role: string;
  };

  return {
    id: row.id,
    oidcSubject: row.oidc_subject,
    oidcIssuer: row.oidc_issuer,
    displayName: row.display_name,
    email: row.email,
    globalRole: row.global_role,
    isNewUser,
  };
}
