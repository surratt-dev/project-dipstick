import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import type { MappableRole } from "../role-map.js";
import type { db as Db } from "../../db.js";
import type { resolveOrCreateAccount as ResolveOrCreateAccount, ResolvedUser } from "../account-resolver.js";
import type { withAuditTransaction as WithAuditTransaction } from "../audit-write-transaction.js";
import type {
  insertSignInAuditRow as InsertSignInAuditRow,
  shouldEmitRoleClaimMapped as ShouldEmitRoleClaimMapped,
} from "../../routes/auth.js";

// ---------------------------------------------------------------------------
// store-idp-role-set (#245) task 6.5, against real Postgres: the two sign-in
// audit rows written by routes/auth.ts's insertSignInAuditRow inside
// withAuditTransaction, for a user resolved by a real resolveOrCreateAccount
// call, carry the role set in actor_roles (TEXT[]) and metadata (JSON), in
// the same order. Also runs the conflict-finding query documented in
// docs/deployment.md ("Group hygiene checklist"); the docs copy it verbatim
// from CONFLICT_QUERY below.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "sign-in-audit-role-set-integration.test.ts");

const ISSUER = "https://idp.sign-in-audit-role-set.test";

const ROLE_MAP: ReadonlyMap<string, MappableRole> = new Map<string, MappableRole>([
  ["Retro-Facilitators", "facilitator"],
  ["Eng-Managers", "engineering_manager"],
]);

// Copied verbatim into docs/deployment.md (task 7.1).
const CONFLICT_QUERY = `SELECT timestamp, actor_user_id, operation, metadata->'roles' AS roles
FROM audit_log
WHERE operation IN ('auth.first_access_created', 'auth.role_claim_mapped')
  AND metadata->'roles' @> '["engineering_manager", "facilitator"]'::jsonb
ORDER BY timestamp DESC;`;

describe.skipIf(!infraUp)("sign-in audit rows carry the role set (real Postgres, store-idp-role-set 6.5)", () => {
  let db: typeof Db;
  let resolveOrCreateAccount: typeof ResolveOrCreateAccount;
  let withAuditTransaction: typeof WithAuditTransaction;
  let insertSignInAuditRow: typeof InsertSignInAuditRow;
  let shouldEmitRoleClaimMapped: typeof ShouldEmitRoleClaimMapped;
  let claimName: string;
  const subjects: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
    ({ resolveOrCreateAccount } = await import("../account-resolver.js"));
    ({ withAuditTransaction } = await import("../audit-write-transaction.js"));
    ({ insertSignInAuditRow, shouldEmitRoleClaimMapped } = await import("../../routes/auth.js"));
    const { config } = await import("../../config.js");
    claimName = config.OIDC_ROLE_CLAIM ?? "role";
  });

  afterAll(async () => {
    if (subjects.length === 0) return;
    const ids = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE oidc_issuer = $1 AND oidc_subject = ANY($2::text[])`,
      [ISSUER, subjects],
    );
    const userIds = ids.rows.map((r) => r.id);
    await db.query(`DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  });

  /** The /auth/callback transactional group, as routes/auth.ts runs it. */
  async function signIn(sub: string, claim: unknown): Promise<ResolvedUser> {
    const claims = { sub, iss: ISSUER, name: "Audit Role Set", email: `${sub}@example.test`, [claimName]: claim };
    return withAuditTransaction(
      (client) => resolveOrCreateAccount(claims, { logger: { warn: () => undefined }, roleMap: ROLE_MAP, client }),
      async (client, user) => {
        if (user.isNewUser) {
          await insertSignInAuditRow(client, {
            user,
            operation: "auth.first_access_created",
            ip: "127.0.0.1",
            metadata: {
              oidcSubject: user.oidcSubject,
              oidcIssuer: user.oidcIssuer,
              globalRole: user.globalRole,
              roles: user.roles,
              correlationId: "it-6.5",
            },
          });
        } else if (shouldEmitRoleClaimMapped(user)) {
          await insertSignInAuditRow(client, {
            user,
            operation: "auth.role_claim_mapped",
            ip: "127.0.0.1",
            metadata: {
              oidcSubject: user.oidcSubject,
              globalRole: user.globalRole,
              roles: user.roles,
              previousRole: user.previousGlobalRole,
              previousRoles: user.previousRoles,
              correlationId: "it-6.5",
            },
          });
        }
      },
    );
  }

  it("actor_roles, metadata.roles and metadata.previousRoles read back in order; the conflict query finds exactly these rows", async () => {
    const sub = `audit-role-set-${randomUUID()}`;
    subjects.push(sub);

    const first = await signIn(sub, ["Retro-Facilitators"]);
    const second = await signIn(sub, ["Eng-Managers", "Retro-Facilitators"]);
    const third = await signIn(sub, ["Retro-Facilitators", "Eng-Managers"]);
    expect(first.isNewUser).toBe(true);
    expect(second.roles).toEqual(["engineering_manager", "facilitator"]);
    expect(third.previousRoles).toEqual(["engineering_manager", "facilitator"]);

    const rows = await db.query<{
      operation: string;
      actor_global_role: string;
      actor_roles: unknown;
      roles: unknown;
      previous_roles: unknown;
      has_previous_roles: boolean;
    }>(
      `SELECT operation, actor_global_role, actor_roles, metadata->'roles' AS roles,
              metadata->'previousRoles' AS previous_roles, metadata ? 'previousRoles' AS has_previous_roles
         FROM audit_log WHERE actor_user_id = $1 ORDER BY timestamp, id`,
      [first.id],
    );
    // timestamp is NOW() (transaction start), distinct per sign-in transaction.
    expect(rows.rows).toEqual([
      {
        operation: "auth.first_access_created",
        actor_global_role: "facilitator",
        actor_roles: ["facilitator"],
        roles: ["facilitator"],
        previous_roles: null,
        has_previous_roles: false,
      },
      {
        operation: "auth.role_claim_mapped",
        actor_global_role: "engineering_manager",
        actor_roles: ["engineering_manager", "facilitator"],
        roles: ["engineering_manager", "facilitator"],
        previous_roles: ["facilitator"],
        has_previous_roles: true,
      },
      {
        operation: "auth.role_claim_mapped",
        actor_global_role: "engineering_manager",
        actor_roles: ["engineering_manager", "facilitator"],
        roles: ["engineering_manager", "facilitator"],
        previous_roles: ["engineering_manager", "facilitator"],
        has_previous_roles: true,
      },
    ]);
    for (const row of rows.rows) expect(Array.isArray(row.actor_roles)).toBe(true);

    // The documented query, unmodified, restricted to this test's user.
    const conflicts = await db.query<{ actor_user_id: string; operation: string; roles: unknown }>(
      `SELECT * FROM (${CONFLICT_QUERY.replace(/;\s*$/, "")}) AS documented WHERE documented.actor_user_id = $1`,
      [first.id],
    );
    expect(conflicts.rows.map((r) => [r.operation, r.roles])).toEqual([
      ["auth.role_claim_mapped", ["engineering_manager", "facilitator"]],
      ["auth.role_claim_mapped", ["engineering_manager", "facilitator"]],
    ]);
  });
});
