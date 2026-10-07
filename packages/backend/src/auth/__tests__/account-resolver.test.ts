import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Must mock config before account-resolver imports db which imports config
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    SESSION_SECRET: "test-secret",
  },
}));

import { resolveOrCreateAccount, type IdTokenClaims } from "../account-resolver.js";
import { DEFAULT_ROLE_MAP, type MappableRole } from "../role-map.js";

// configurable-oidc-role-map (#243) task 3.2: resolveOrCreateAccount now
// takes an options object { logger, roleMap, client }. This wrapper keeps the
// identity-resolution tests below focused on what they test.
type ResolveOpts = Partial<Parameters<typeof resolveOrCreateAccount>[1]>;
function resolve(claims: IdTokenClaims, o: ResolveOpts = {}) {
  return resolveOrCreateAccount(claims, {
    logger: o.logger ?? { warn: vi.fn() },
    roleMap: o.roleMap ?? DEFAULT_ROLE_MAP,
    client: o.client,
  });
}

// ---------------------------------------------------------------------------
// Helper — builds a complete DB row for the upsert RETURNING clause.
// global_role defaults to 'engineer' to match the DB column default.
//
// store-idp-role-set (#245) task 5.1: the upsert reads roles::text[] and
// (SELECT roles::text[] FROM prior), which node-postgres returns as string
// arrays, so the mock does too. roles defaults to [global_role]; a returning
// row's previous_global_role defaults to 'engineer' and previous_roles to
// [previous_global_role] (null when previous_global_role is null).
// ---------------------------------------------------------------------------
function makeUserRow(overrides: Partial<{
  id: string;
  oidc_subject: string;
  oidc_issuer: string;
  display_name: string;
  email: string;
  global_role: string;
  is_new_user: boolean;
  roles: unknown;
  previous_global_role: string | null;
  previous_roles: unknown;
}> = {}) {
  const globalRole = overrides.global_role ?? "engineer";
  const isNewUser = overrides.is_new_user ?? true;
  const previousGlobalRole =
    "previous_global_role" in overrides ? overrides.previous_global_role! : isNewUser ? null : "engineer";
  return {
    id: "user-1",
    oidc_subject: "sub-123",
    oidc_issuer: "https://idp.example.com",
    display_name: "Alice",
    email: "alice@example.com",
    global_role: globalRole,
    is_new_user: isNewUser,
    roles: [globalRole],
    previous_global_role: previousGlobalRole,
    previous_roles: previousGlobalRole === null ? null : [previousGlobalRole],
    ...overrides,
  };
}

describe("resolveOrCreateAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Existing behavior — identity resolution
  // -------------------------------------------------------------------------

  it("should return isNewUser=true when user does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: true })] });

    const result = await resolve({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "alice@example.com",
    });

    expect(result.isNewUser).toBe(true);
    expect(result.id).toBe("user-1");
    expect(result.displayName).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
  });

  it("should return isNewUser=false when user exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeUserRow({ display_name: "Alice Updated", is_new_user: false })],
    });

    const result = await resolve({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice Updated",
      email: "alice@example.com",
    });

    expect(result.isNewUser).toBe(false);
  });

  it("should use sub as displayName fallback when name and email are missing", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeUserRow({
          oidc_subject: "sub-456",
          display_name: "sub-456",
          email: "sub-456@unknown",
          is_new_user: true,
        }),
      ],
    });

    const result = await resolve({
      sub: "sub-456",
      iss: "https://idp.example.com",
    });

    expect(result.displayName).toBe("sub-456");
    expect(result.email).toBe("sub-456@unknown");
    // Verify upsert params: sub, iss, displayName, email, global_role (5 params)
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const upsertCall = mockQuery.mock.calls[0];
    expect(upsertCall[1][0]).toBe("sub-456");
    expect(upsertCall[1][1]).toBe("https://idp.example.com");
    expect(upsertCall[1][2]).toBe("sub-456");        // displayName fallback
    expect(upsertCall[1][3]).toBe("sub-456@unknown"); // email fallback
    expect(upsertCall[1][4]).toBe("engineer");        // default global_role (no claim)
  });

  it("should use email as displayName when name is missing but email exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeUserRow({ display_name: "bob@example.com", email: "bob@example.com", is_new_user: true })],
    });

    await resolve({
      sub: "sub-789",
      iss: "https://idp.example.com",
      email: "bob@example.com",
    });

    const upsertCall = mockQuery.mock.calls[0];
    expect(upsertCall[1][2]).toBe("bob@example.com"); // displayName param
  });

  it("creates separate accounts for two identities with the same email but different sub values (AC-2)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeUserRow({ id: "user-A", oidc_subject: "sub-A", is_new_user: true })],
    });

    const resultA = await resolve({
      sub: "sub-A",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [makeUserRow({ id: "user-B", oidc_subject: "sub-B", is_new_user: true })],
    });

    const resultB = await resolve({
      sub: "sub-B",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    expect(resultA.id).toBe("user-A");
    expect(resultB.id).toBe("user-B");
    expect(resultA.isNewUser).toBe(true);
    expect(resultB.isNewUser).toBe(true);

    const upsertCallA = mockQuery.mock.calls[0];
    const upsertCallB = mockQuery.mock.calls[1];
    expect(upsertCallA[1].slice(0, 2)).toEqual(["sub-A", "https://idp.example.com"]);
    expect(upsertCallB[1].slice(0, 2)).toEqual(["sub-B", "https://idp.example.com"]);
  });

  it("matches returning user by sub/iss and updates email when changed (AC-2)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeUserRow({ email: "new-email@example.com", is_new_user: false })],
    });

    const result = await resolve({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "new-email@example.com",
    });

    expect(result.id).toBe("user-1");
    expect(result.isNewUser).toBe(false);
    expect(result.email).toBe("new-email@example.com");

    const upsertCall = mockQuery.mock.calls[0];
    expect(upsertCall[1][0]).toBe("sub-123");
    expect(upsertCall[1][1]).toBe("https://idp.example.com");
    expect(upsertCall[1][3]).toBe("new-email@example.com");
  });

  it("handles simulated concurrent first access — isNewUser is derived independently per call", async () => {
    // Simulates what the real DB does when two callbacks race for one new
    // identity: exactly one INSERT succeeds (xmax = 0), the other performs an
    // update (xmax != 0). Each call's isNewUser must track its own mocked
    // is_new_user value — proving derivation from the DB result, not a
    // reduced call count.
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          makeUserRow({
            id: "user-concurrent",
            oidc_subject: "sub-concurrent",
            display_name: "Carol",
            email: "carol@example.com",
            is_new_user: true,
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          makeUserRow({
            id: "user-concurrent",
            oidc_subject: "sub-concurrent",
            display_name: "Carol",
            email: "carol@example.com",
            is_new_user: false,
          }),
        ],
      });

    const claims = {
      sub: "sub-concurrent",
      iss: "https://idp.example.com",
      name: "Carol",
      email: "carol@example.com",
    };

    const result1 = await resolve(claims);
    const result2 = await resolve(claims);

    expect(result1.id).toBe("user-concurrent");
    expect(result2.id).toBe("user-concurrent");
    expect(result1.isNewUser).toBe(true);
    expect(result2.isNewUser).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Task 2.3 / 2.4 — IdP role claim mapping (Decision 2, design.md)
  // -------------------------------------------------------------------------

  describe("IdP role claim mapping (Decision 2, establish-manager-team-relationship)", () => {
    it("maps 'engineering_manager' claim to global_role = 'engineering_manager'", async () => {
      // Task 2.3: user can reach global_role = 'engineering_manager' via IdP claim
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ global_role: "engineering_manager", is_new_user: true })],
      });

      const result = await resolve({
        sub: "sub-em",
        iss: "https://idp.example.com",
        name: "Eve",
        email: "eve@example.com",
        role: "engineering_manager", // IdP role claim (default claim name: 'role')
      });

      // globalRole in result reflects the mapped value
      expect(result.globalRole).toBe("engineering_manager");

      // Upsert passes 'engineering_manager' as the global_role param (index 4)
      const upsertCall = mockQuery.mock.calls[0];
      expect(upsertCall[1][4]).toBe("engineering_manager");
    });

    it("maps 'application_admin' claim to global_role = 'application_admin'", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ global_role: "application_admin", is_new_user: true })],
      });

      const result = await resolve({
        sub: "sub-admin",
        iss: "https://idp.example.com",
        name: "Admin",
        email: "admin@example.com",
        role: "application_admin",
      });

      expect(result.globalRole).toBe("application_admin");

      const upsertCall = mockQuery.mock.calls[0];
      expect(upsertCall[1][4]).toBe("application_admin");
    });

    it("defaults to 'engineer' when role claim is absent", async () => {
      // Task 2.3: absent claim → default role, not an error
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: true })] });

      const result = await resolve({
        sub: "sub-no-claim",
        iss: "https://idp.example.com",
        name: "Frank",
        email: "frank@example.com",
        // no role claim
      });

      expect(result.globalRole).toBe("engineer");

      const upsertCall = mockQuery.mock.calls[0];
      expect(upsertCall[1][4]).toBe("engineer");
    });

    it("defaults to 'engineer' for an allowlist-rejected claim value and emits a warning", async () => {
      // Task 2.4: unrecognized claim → treated as absent; warning logged
      const mockLogger = { warn: vi.fn() };

      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: true })] });

      const result = await resolve(
        {
          sub: "sub-bad-claim",
          iss: "https://idp.example.com",
          name: "Greta",
          email: "greta@example.com",
          role: "superuser", // not a map key
        },
        { logger: mockLogger },
      );

      expect(result.globalRole).toBe("engineer");

      const upsertCall = mockQuery.mock.calls[0];
      expect(upsertCall[1][4]).toBe("engineer");

      // Warning must be emitted — but must NOT include the raw claim value.
      // pino argument order (R2): fields object first, message second.
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const warnCall = mockLogger.warn.mock.calls[0]!;
      expect(warnCall[0]).toEqual({ claimName: "role" });
      expect(typeof warnCall[1]).toBe("string");
      expect(JSON.stringify(warnCall)).not.toContain("superuser");
    });

    it("re-evaluates global_role on every authentication — returning user's role updates when claim changes", async () => {
      // Task 2.4: re-evaluation on each authentication
      // Returning user previously had global_role = 'engineer'
      // Now signs in with role claim = 'engineering_manager'
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ id: "user-em", global_role: "engineering_manager", is_new_user: false })],
      });

      const result = await resolve({
        sub: "sub-em-returning",
        iss: "https://idp.example.com",
        name: "Hana",
        email: "hana@example.com",
        role: "engineering_manager",
      });

      expect(result.isNewUser).toBe(false);
      expect(result.globalRole).toBe("engineering_manager");

      // The upsert includes global_role in the SET clause — confirmed by
      // checking the 5th parameter passed to the upsert
      const upsertCall = mockQuery.mock.calls[0];
      expect(upsertCall[1][4]).toBe("engineering_manager");
    });

    it("TEAM-006 precondition is satisfiable via the IdP claim path (end-to-end path test)", async () => {
      // Task 2.4: verifies the full path from sign-in to global_role = 'engineering_manager'
      // Steps:
      //   1. User signs in with IdP role claim 'engineering_manager'
      //   2. resolveOrCreateAccount sets global_role = 'engineering_manager' in the upsert
      //   3. TEAM-006 can then succeed because the precondition is met
      // This test covers step 2. TEAM-006 tests cover step 3.

      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ id: "user-em-new", global_role: "engineering_manager", is_new_user: true })],
      });

      const result = await resolve({
        sub: "sub-em-new",
        iss: "https://idp.example.com",
        name: "Ivan",
        email: "ivan@example.com",
        role: "engineering_manager",
      });

      // After this call, the database has global_role = 'engineering_manager'
      // for this user — the TEAM-006 precondition check will find it satisfied.
      expect(result.globalRole).toBe("engineering_manager");
      expect(result.isNewUser).toBe(true);

      // Confirm the upsert SQL includes global_role in both INSERT and SET
      const upsertSql = (mockQuery.mock.calls[0][0] as string).toLowerCase();
      expect(upsertSql).toContain("global_role");
    });
  });

  // ---------------------------------------------------------------------------
  // auth-events-audit-log-coverage, design.md Decision D4/D7
  // ---------------------------------------------------------------------------
  describe("previousGlobalRole / optional client parameter", () => {
    it("previousGlobalRole is null for a brand-new user", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: true, previous_global_role: null })],
      });

      const result = await resolve({
        sub: "sub-new",
        iss: "https://idp.example.com",
      });

      expect(result.isNewUser).toBe(true);
      expect(result.previousGlobalRole).toBeNull();
    });

    it("previousGlobalRole carries the pre-UPSERT value for a returning user", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeUserRow({
            is_new_user: false,
            global_role: "engineering_manager",
            previous_global_role: "engineer",
          }),
        ],
      });

      const result = await resolve({
        sub: "sub-123",
        iss: "https://idp.example.com",
        role: "engineering_manager",
      });

      expect(result.isNewUser).toBe(false);
      expect(result.globalRole).toBe("engineering_manager");
      expect(result.previousGlobalRole).toBe("engineer");
    });

    it("the UPSERT statement captures the prior global_role via a CTE", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: false, previous_global_role: "engineer" })],
      });

      await resolve({ sub: "sub-123", iss: "https://idp.example.com" });

      const upsertSql = (mockQuery.mock.calls[0][0] as string).toLowerCase();
      expect(upsertSql).toContain("with prior as");
      expect(upsertSql).toContain("previous_global_role");
    });

    it("runs the UPSERT on the provided client instead of the pool when one is passed", async () => {
      const mockClientQuery = vi.fn().mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: true, previous_global_role: null })],
      });
      const mockClient = { query: mockClientQuery } as never;

      await resolve({ sub: "sub-123", iss: "https://idp.example.com" }, { client: mockClient });

      expect(mockClientQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
  // -------------------------------------------------------------------------
  // configurable-oidc-role-map (#243) task 3.2: map injection
  // -------------------------------------------------------------------------
  describe("role map injection (task 3.2)", () => {
    it.each([
      ["engineering_manager", "engineering_manager"],
      ["application_admin", "application_admin"],
      ["facilitator", "facilitator"],
      ["senior_engineer", "senior_engineer"],
      ["engineer", "engineer"],
    ])("default map: role claim %s resolves to %s", async (claim, expected) => {
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ global_role: expected })] });
      await resolve({ sub: "s", iss: "i", role: claim });
      expect(mockQuery.mock.calls[0]![1][4]).toBe(expected);
    });

    it("uses the injected custom map (array claim, precedence)", async () => {
      const roleMap = new Map<string, MappableRole>([
        ["Retro-Facilitators", "facilitator"],
        ["Seniors", "senior_engineer"],
      ]);
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ global_role: "facilitator" })] });
      await resolve({ sub: "s", iss: "i", role: ["Seniors", "Retro-Facilitators"] }, { roleMap });
      expect(mockQuery.mock.calls[0]![1][4]).toBe("facilitator");
    });

    it("an internal role string is unmapped under a custom map that does not list it", async () => {
      const roleMap = new Map<string, MappableRole>([["Eng-Managers", "engineering_manager"]]);
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow()] });
      await resolve({ sub: "s", iss: "i", role: "application_admin" }, { roleMap });
      expect(mockQuery.mock.calls[0]![1][4]).toBe("engineer");
    });

    it("throws when roleMap is missing (no silent fallback to the default map)", async () => {
      await expect(
        resolveOrCreateAccount(
          { sub: "s", iss: "i", role: "application_admin" },
          { logger: { warn: vi.fn() } } as unknown as Parameters<typeof resolveOrCreateAccount>[1],
        ),
      ).rejects.toThrow(/roleMap/);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
  // -------------------------------------------------------------------------
  // configurable-oidc-role-map (#243) task 3.3: sign-in logging (D7, R2, S1,
  // S8). Every assertion checks pino argument order: calls[i][0] is the
  // fields object, calls[i][1] the message string. No line carries a claim
  // value or a map key.
  // -------------------------------------------------------------------------
  describe("sign-in logging (task 3.3)", () => {
    const MAP = new Map<string, MappableRole>([
      ["Dipstick-Admins", "application_admin"],
      ["Eng-Managers", "engineering_manager"],
      ["Retro-Facilitators", "facilitator"],
    ]);
    const VALUES = ["Dipstick-Admins", "Eng-Managers", "Retro-Facilitators", "All-Staff"];

    async function signIn(claims: Partial<IdTokenClaims>, opts: { isNewUser?: boolean; globalRole?: string } = {}) {
      const logger = { warn: vi.fn() };
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: opts.isNewUser ?? false, global_role: opts.globalRole ?? "engineer" })],
      });
      await resolve({ sub: "s", iss: "i", ...claims } as IdTokenClaims, { logger, roleMap: MAP });
      for (const call of logger.warn.mock.calls) {
        expect(typeof call[0]).toBe("object");
        expect(typeof call[1]).toBe("string");
        for (const v of VALUES) expect(JSON.stringify(call)).not.toContain(v);
      }
      return logger.warn.mock.calls;
    }

    it("missing claim with an own _claim_names entry warns once with reason claim_overage (S8)", async () => {
      const calls = await signIn({ _claim_names: { role: "src1" } });
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toEqual({ claimName: "role", reason: "claim_overage" });
    });

    it("wholly unmapped claim warns once with the claim name only", async () => {
      const calls = await signIn({ role: ["All-Staff"] });
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toEqual({ claimName: "role" });
    });

    it.each([
      ["[admin, facilitator] returning", ["Dipstick-Admins", "Retro-Facilitators"], "application_admin", ["facilitator"], false],
      ["[admin, facilitator] first sign-in", ["Dipstick-Admins", "Retro-Facilitators"], "application_admin", ["facilitator"], true],
      ["[engineering_manager, facilitator] returning", ["Eng-Managers", "Retro-Facilitators"], "engineering_manager", ["facilitator"], false],
      ["[admin, engineering_manager] returning (S1)", ["Dipstick-Admins", "Eng-Managers"], "application_admin", ["engineering_manager"], false],
      ["[admin, engineering_manager, facilitator]", VALUES.slice(0, 3), "application_admin", ["engineering_manager", "facilitator"], false],
    ])("%s logs exactly one precedence-discard line", async (_label, claim, resolvedRole, discardedRoles, isNewUser) => {
      const calls = await signIn({ role: claim }, { isNewUser, globalRole: resolvedRole });
      // store-idp-role-set (#245) task 5.4: fields and scope unchanged.
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toEqual({ claimName: "role", resolvedRole, discardedRoles });
      // ... while the outranked roles are kept in the written set.
      const written = (mockQuery.mock.calls[0]![1] as unknown[])[5] as string[];
      expect(written).toEqual([resolvedRole, ...discardedRoles]);
    });

    it.each([
      ["facilitator only", ["Retro-Facilitators"], ["facilitator"]],
      ["facilitator + senior", ["Retro-Facilitators", "Seniors"], ["facilitator", "senior_engineer"]],
      ["admin + senior", ["Seniors", "Dipstick-Admins"], ["application_admin", "senior_engineer"]],
    ])("%s logs no discard line, and roles still holds every mapped role", async (_label, claim, roles) => {
      const logger = { warn: vi.fn() };
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: false, global_role: roles[0]! })] });
      await resolve({ sub: "s", iss: "i", role: claim } as IdTokenClaims, {
        logger,
        roleMap: new Map([...MAP, ["Seniors", "senior_engineer" as MappableRole]]),
      });
      expect(logger.warn).not.toHaveBeenCalled();
      expect((mockQuery.mock.calls[0]![1] as unknown[])[5]).toEqual(roles);
    });

    it.each([
      ["a missing claim", {}],
      ["a partial match", { role: ["Eng-Managers", "All-Staff"] }],
      ["an array with no non-empty strings", { role: ["", 42, null] }],
      ["a facilitator-only claim", { role: ["Retro-Facilitators"] }],
      ["_claim_names for a different claim", { _claim_names: { groups: "src1" } }],
    ])("%s logs nothing", async (_label, claims) => {
      expect(await signIn(claims as Partial<IdTokenClaims>)).toHaveLength(0);
    });
  });
  // -------------------------------------------------------------------------
  // store-idp-role-set (#245) task 5.1, design D4/D5
  // -------------------------------------------------------------------------
  describe("role set (store-idp-role-set D4/D5)", () => {
    const MAP = new Map<string, MappableRole>([
      ["Dipstick-Admins", "application_admin"],
      ["Eng-Managers", "engineering_manager"],
      ["Retro-Facilitators", "facilitator"],
    ]);

    it("writes the full set as $6::user_role[] with global_role = roles[0], and reads both sets as text[]", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeUserRow({
            is_new_user: false,
            global_role: "engineering_manager",
            roles: ["engineering_manager", "facilitator"],
            previous_global_role: "facilitator",
            previous_roles: ["facilitator"],
          }),
        ],
      });

      const result = await resolve(
        { sub: "sub-123", iss: "https://idp.example.com", role: ["Retro-Facilitators", "Eng-Managers"] },
        { roleMap: MAP },
      );

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("$6::user_role[]");
      expect(sql).toContain("roles = EXCLUDED.roles");
      expect(sql).toContain("SELECT global_role, roles FROM users");
      expect(sql).toContain("roles::text[] AS roles");
      expect(sql).toContain("(SELECT roles::text[] FROM prior) AS previous_roles");
      expect(params[4]).toBe("engineering_manager");
      expect(params[5]).toEqual(["engineering_manager", "facilitator"]);

      expect(result.roles).toEqual(["engineering_manager", "facilitator"]);
      expect(result.previousRoles).toEqual(["facilitator"]);
      expect(Object.isFrozen(result.roles)).toBe(true);
      expect(Object.isFrozen(result.previousRoles)).toBe(true);
    });

    it("a first sign-in has previousRoles null", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: true })] });
      const result = await resolve({ sub: "s", iss: "i" });
      expect(result.roles).toEqual(["engineer"]);
      expect(result.previousRoles).toBeNull();
      expect(result.previousGlobalRole).toBeNull();
    });

    it("the concurrent-first-sign-in race passes both previous values through as null", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: false, previous_global_role: null, previous_roles: null })],
      });
      const result = await resolve({ sub: "s", iss: "i" });
      expect(result.isNewUser).toBe(false);
      expect(result.previousGlobalRole).toBeNull();
      expect(result.previousRoles).toBeNull();
    });

    it("throws (integrity error) when a prior row has global_role but no roles", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: false, previous_global_role: "facilitator", previous_roles: null })],
      });
      await expect(resolve({ sub: "s", iss: "i" })).rejects.toThrow(/integrity|no roles/);
    });

    it.each([
      ["the raw enum-array string", "{engineer}"],
      ["an empty array", []],
      ["an unknown element", ["toString"]],
    ])("fails the sign-in closed when the stored roles is %s", async (_label, roles) => {
      mockQuery.mockResolvedValueOnce({ rows: [makeUserRow({ is_new_user: true, roles })] });
      await expect(resolve({ sub: "s", iss: "i" })).rejects.toThrow();
    });

    it("fails the sign-in closed when previous_roles is malformed", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_new_user: false, previous_global_role: "engineer", previous_roles: "{engineer}" })],
      });
      await expect(resolve({ sub: "s", iss: "i" })).rejects.toThrow();
    });
  });
});
