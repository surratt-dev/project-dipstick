import { db } from "../db.js";

export interface IdTokenClaims {
  sub: string;
  iss: string;
  name?: string | undefined;
  email?: string | undefined;
}

export interface ResolvedUser {
  id: string;
  oidcSubject: string;
  oidcIssuer: string;
  displayName: string;
  email: string;
  isNewUser: boolean;
}

export async function resolveOrCreateAccount(
  claims: IdTokenClaims,
): Promise<ResolvedUser> {
  // Task 1 — column type verification: display_name and email are both
  // TEXT (unconstrained) in migration 2_create_tables.sql. Neither is
  // VARCHAR(n)-constrained, so no truncation logic is required before the
  // upsert even when the sub claim is used as the display_name fallback.
  const displayName = claims.name ?? claims.email ?? claims.sub;
  const email = claims.email ?? `${claims.sub}@unknown`;

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
  const result = await db.query(
    `INSERT INTO users (oidc_subject, oidc_issuer, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (oidc_subject, oidc_issuer)
     DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, updated_at = NOW()
     RETURNING id, oidc_subject, oidc_issuer, display_name, email`,
    [claims.sub, claims.iss, displayName, email],
  );

  const row = result.rows[0] as {
    id: string;
    oidc_subject: string;
    oidc_issuer: string;
    display_name: string;
    email: string;
  };

  return {
    id: row.id,
    oidcSubject: row.oidc_subject,
    oidcIssuer: row.oidc_issuer,
    displayName: row.display_name,
    email: row.email,
    isNewUser,
  };
}
