import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import type { MappableRole } from "../role-map.js";
import type { db as Db } from "../../db.js";
import type { resolveOrCreateAccount as ResolveOrCreateAccount } from "../account-resolver.js";
import type { shouldEmitRoleClaimMapped as ShouldEmitRoleClaimMapped } from "../../routes/auth.js";

// ---------------------------------------------------------------------------
// #235 acceptance criteria 1–3, against real Postgres: a role granted by the
// IdP claim (through OIDC_ROLE_MAP) is written by resolveOrCreateAccount's
// upsert, survives a second sign-in, and is replaced by `engineer` when the
// claim is removed, with that change visible to the role_claim_mapped
// firing condition. No test row writes users.global_role directly: every
// role comes from a sign-in.
//
// The audit_log INSERT itself happens in the /auth/callback handler and is
// covered by routes/__tests__/auth.test.ts; here the shared predicate
// (shouldEmitRoleClaimMapped) is asserted on the real resolver output.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "role-claim-persistence-integration.test.ts");

const ISSUER = "https://idp.role-claim-persistence.test";

// A translating map, as a real deployment would configure it.
const ROLE_MAP: ReadonlyMap<string, MappableRole> = new Map<string, MappableRole>([
  ["Retro-Facilitators", "facilitator"],
  ["Senior-Engineers", "senior_engineer"],
  ["Eng-Managers", "engineering_manager"],
]);

describe.skipIf(!infraUp)("role claim persistence through resolveOrCreateAccount (real Postgres, #235)", () => {
  // Dynamic imports in beforeAll: real-db.js must set the env before config.js loads.
  let db: typeof Db;
  let resolveOrCreateAccount: typeof ResolveOrCreateAccount;
  let shouldEmitRoleClaimMapped: typeof ShouldEmitRoleClaimMapped;
  let claimName: string;
  const subjects: string[] = [];
  const logger = { warn: () => undefined };

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
    ({ resolveOrCreateAccount } = await import("../account-resolver.js"));
    ({ shouldEmitRoleClaimMapped } = await import("../../routes/auth.js"));
    const { config } = await import("../../config.js");
    claimName = config.OIDC_ROLE_CLAIM ?? "role";
  });

  afterEach(async () => {
    if (subjects.length > 0) {
      await db.query(`DELETE FROM users WHERE oidc_issuer = $1 AND oidc_subject = ANY($2::text[])`, [
        ISSUER,
        subjects.splice(0),
      ]);
    }
  });

  function newSubject(): string {
    const sub = `role-claim-${randomUUID()}`;
    subjects.push(sub);
    return sub;
  }

  function signIn(sub: string, claim?: unknown) {
    const claims: Record<string, unknown> = { sub, iss: ISSUER, name: "Role Claim Test", email: `${sub}@example.test` };
    if (claim !== undefined) claims[claimName] = claim;
    return resolveOrCreateAccount(claims as { sub: string; iss: string }, { logger, roleMap: ROLE_MAP });
  }

  async function storedRole(sub: string): Promise<string> {
    const res = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE oidc_issuer = $1 AND oidc_subject = $2`,
      [ISSUER, sub],
    );
    return res.rows[0]!.global_role;
  }

  it.each([
    ["facilitator", ["Retro-Facilitators"]],
    ["senior_engineer", ["Senior-Engineers"]],
  ])("%s is granted by the claim and persists across a second sign-in", async (role, claim) => {
    const sub = newSubject();

    const first = await signIn(sub, claim);
    expect(first.isNewUser).toBe(true);
    expect(first.globalRole).toBe(role);
    expect(await storedRole(sub)).toBe(role);

    const second = await signIn(sub, claim);
    expect(second.isNewUser).toBe(false);
    expect(second.globalRole).toBe(role);
    expect(second.previousGlobalRole).toBe(role);
    expect(await storedRole(sub)).toBe(role);
  });

  it.each(["facilitator", "senior_engineer"] as const)(
    "%s becomes engineer when the claim is removed, and the change is recorded",
    async (role) => {
      const sub = newSubject();
      const claim = role === "facilitator" ? "Retro-Facilitators" : "Senior-Engineers";

      await signIn(sub, claim);
      const demoted = await signIn(sub);

      expect(demoted.globalRole).toBe("engineer");
      expect(demoted.previousGlobalRole).toBe(role);
      expect(await storedRole(sub)).toBe("engineer");
      expect(shouldEmitRoleClaimMapped(demoted)).toBe(true);
    },
  );

  it("an unmapped claim value on a facilitator's next sign-in also demotes to engineer", async () => {
    const sub = newSubject();

    await signIn(sub, "Retro-Facilitators");
    const demoted = await signIn(sub, ["Some-Other-Group"]);

    expect(demoted.globalRole).toBe("engineer");
    expect(demoted.previousGlobalRole).toBe("facilitator");
    expect(shouldEmitRoleClaimMapped(demoted)).toBe(true);
  });

  it("a returning engineer with no claim records no role change", async () => {
    const sub = newSubject();

    await signIn(sub);
    const again = await signIn(sub);

    expect(again.globalRole).toBe("engineer");
    expect(again.previousGlobalRole).toBe("engineer");
    expect(shouldEmitRoleClaimMapped(again)).toBe(false);
  });

  it("a user sent both the manager and facilitator groups is stored as engineering_manager (#238)", async () => {
    const sub = newSubject();

    const user = await signIn(sub, ["Retro-Facilitators", "Eng-Managers"]);

    expect(user.globalRole).toBe("engineering_manager");
    expect(await storedRole(sub)).toBe("engineering_manager");
  });
});
