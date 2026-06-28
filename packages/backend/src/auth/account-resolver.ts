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
  const displayName = claims.name ?? claims.email ?? claims.sub;
  const email = claims.email ?? `${claims.sub}@unknown`;

  // Check if user exists first to determine if this is a new user
  const existing = await db.query(
    `SELECT id, oidc_subject, oidc_issuer, display_name, email FROM users
     WHERE oidc_subject = $1 AND oidc_issuer = $2`,
    [claims.sub, claims.iss],
  );

  const isNewUser = existing.rows.length === 0;

  // Upsert: insert or update profile data on conflict
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
