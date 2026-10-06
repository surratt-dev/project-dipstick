import type { PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { config } from "../config.js";
import { isClaimOverage, resolveGlobalRole, type GlobalRole, type MappableRole } from "./role-map.js";

export interface IdTokenClaims {
  sub: string;
  iss: string;
  name?: string | undefined;
  email?: string | undefined;
  // Role claim — read from the signed ID token only (never from userinfo).
  // The claim name is configurable via OIDC_ROLE_CLAIM (default: 'role').
  // This field carries whatever value the IdP placed under that claim name
  // (a string or an array of strings, e.g. `groups`). resolveOrCreateAccount
  // translates it to an internal role through the deployment's role map
  // (OIDC_ROLE_MAP, role-map.ts); it is never stored or logged as-is. It is
  // read only at interactive sign-in: token refresh does not re-resolve it.
  [key: string]: unknown;
}

export interface ResolvedUser {
  id: string;
  oidcSubject: string;
  oidcIssuer: string;
  displayName: string;
  email: string;
  globalRole: GlobalRole;
  isNewUser: boolean;
  /**
   * auth-events-audit-log-coverage, design.md Decision D4: the account's
   * global_role value on record immediately before this authentication's
   * UPSERT applied, captured in the same statement as the UPSERT. `null`
   * when `isNewUser` is true -- there is no prior row.
   */
  previousGlobalRole: GlobalRole | null;
}

// ---------------------------------------------------------------------------
// Global role mapping (configurable-oidc-role-map, #243, design D7)
//
// The OIDC_ROLE_CLAIM env var names the ID token claim that carries the role
// assignment (default: 'role'). The claim is read from the SIGNED ID token
// only — never from the userinfo endpoint. Its values are translated to an
// internal role through the deployment's role map (OIDC_ROLE_MAP, parsed and
// validated at startup by role-map.ts), with fixed precedence and a fixed
// 'engineer' fallback for anything unmapped.
//
// The mapping runs at every INTERACTIVE sign-in (the OIDC callback), so an
// IdP-side change reaches the user at their next sign-in. Token refresh
// (refreshSessionTokens) does NOT call this function and does not re-resolve
// the role; the 90-minute absolute session lifetime bounds that delay.
//
// Claim values are attacker-influenced and are never logged or audited:
// log lines carry only the claim NAME and internal role names.
// ---------------------------------------------------------------------------
const ROLE_CLAIM_NAME = config.OIDC_ROLE_CLAIM ?? "role";

export interface ResolveAccountOptions {
  /** A correlationId-bound child logger (routes/auth.ts). pino order: (fields, msg). */
  logger: Pick<FastifyBaseLogger, "warn">;
  /** The deployment's role map (config.roleMap). Required: no default fallback. */
  roleMap: ReadonlyMap<string, MappableRole>;
  client?: PoolClient | undefined;
}

export async function resolveOrCreateAccount(
  claims: IdTokenClaims,
  options: ResolveAccountOptions,
): Promise<ResolvedUser> {
  const { logger, roleMap, client } = options;
  // R4: a missing map must never fall back to DEFAULT_ROLE_MAP — that would
  // be exactly the fail-open path the role map exists to close.
  if (!(roleMap instanceof Map)) {
    throw new Error("resolveOrCreateAccount: roleMap is required");
  }

  // Task 1 — column type verification: display_name and email are both
  // TEXT (unconstrained) in migration 2_create_tables.sql. Neither is
  // VARCHAR(n)-constrained, so no truncation logic is required before the
  // upsert even when the sub claim is used as the display_name fallback.
  const displayName = (claims.name as string | undefined) ?? (claims.email as string | undefined) ?? claims.sub;
  const email = (claims.email as string | undefined) ?? `${claims.sub}@unknown`;

  // Map the IdP role claim to a global_role value (design D7). Read from the
  // signed ID token only; re-evaluated at every interactive sign-in.
  const resolution = resolveGlobalRole(claims[ROLE_CLAIM_NAME], roleMap);
  const globalRole = resolution.role;
  // Sign-in logging (D7). pino order: fields object first, message second.
  // Only the claim NAME and internal role names are ever logged — never a
  // claim value or a map key. Partial matches log nothing.
  if (resolution.outcome === "missing") {
    // S8: Entra omits `groups` for users in too many groups and signals it
    // with `_claim_names.groups`; without this a manager would silently
    // drop to engineer.
    if (isClaimOverage(claims, ROLE_CLAIM_NAME)) {
      logger.warn(
        { claimName: ROLE_CLAIM_NAME, reason: "claim_overage" },
        "OIDC role claim omitted by the IdP (claim overage); user receives the default role",
      );
    }
  } else if (resolution.outcome === "unmapped") {
    logger.warn(
      { claimName: ROLE_CLAIM_NAME },
      "OIDC role claim present but no value is in OIDC_ROLE_MAP; user receives the default role",
    );
  }
  if (resolution.discardedRoles.length > 0) {
    // S1: fires on every such sign-in (new and returning), no de-duplication.
    // Logged, not audited (D8): the durable record belongs to #241.
    logger.warn(
      { claimName: ROLE_CLAIM_NAME, resolvedRole: globalRole, discardedRoles: resolution.discardedRoles },
      "OIDC role claim mapped to several roles; lower-precedence roles were discarded",
    );
  }

  // Upsert with xmax idempotency: isNewUser is derived from (xmax = 0) on the
  // upsert's own RETURNING clause rather than a prior SELECT, so it is
  // computed within the same statement that performs the write and is
  // race-free (mirrors teams.ts TEAM-006).
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
  // auth-events-audit-log-coverage, design.md Decision D4: the `prior` CTE
  // captures the pre-update global_role value in the same statement, before
  // the UPDATE applies -- no extra round trip, since it's computed in the
  // same statement already running. `previous_global_role` is NULL for a
  // brand-new user (no prior row to have selected).
  const queryExecutor = client ?? db;
  const result = await queryExecutor.query(
    `WITH prior AS (
       SELECT global_role FROM users WHERE oidc_subject = $1 AND oidc_issuer = $2
     )
     INSERT INTO users (oidc_subject, oidc_issuer, display_name, email, global_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (oidc_subject, oidc_issuer)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       global_role = EXCLUDED.global_role,
       updated_at = NOW()
     RETURNING id, oidc_subject, oidc_issuer, display_name, email, global_role,
               (xmax = 0) AS is_new_user,
               (SELECT global_role FROM prior) AS previous_global_role`,
    [claims.sub, claims.iss, displayName, email, globalRole],
  );

  const row = result.rows[0] as {
    id: string;
    oidc_subject: string;
    oidc_issuer: string;
    display_name: string;
    email: string;
    global_role: GlobalRole;
    is_new_user: boolean;
    previous_global_role: GlobalRole | null;
  };

  return {
    id: row.id,
    oidcSubject: row.oidc_subject,
    oidcIssuer: row.oidc_issuer,
    displayName: row.display_name,
    email: row.email,
    globalRole: row.global_role,
    isNewUser: row.is_new_user,
    previousGlobalRole: row.is_new_user ? null : row.previous_global_role,
  };
}
