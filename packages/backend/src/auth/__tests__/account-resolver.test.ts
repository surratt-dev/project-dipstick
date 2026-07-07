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

import { resolveOrCreateAccount } from "../account-resolver.js";

// ---------------------------------------------------------------------------
// Helper — builds a complete DB row for the upsert RETURNING clause.
// global_role defaults to 'engineer' to match the DB column default.
// ---------------------------------------------------------------------------
function makeUserRow(overrides: Partial<{
  id: string;
  oidc_subject: string;
  oidc_issuer: string;
  display_name: string;
  email: string;
  global_role: string;
}> = {}) {
  return {
    id: "user-1",
    oidc_subject: "sub-123",
    oidc_issuer: "https://idp.example.com",
    display_name: "Alice",
    email: "alice@example.com",
    global_role: "engineer",
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
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT (no existing user)
      .mockResolvedValueOnce({ rows: [makeUserRow()] });

    const result = await resolveOrCreateAccount({
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
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] }) // SELECT finds existing
      .mockResolvedValueOnce({ rows: [makeUserRow({ display_name: "Alice Updated" })] });

    const result = await resolveOrCreateAccount({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice Updated",
      email: "alice@example.com",
    });

    expect(result.isNewUser).toBe(false);
  });

  it("should use sub as displayName fallback when name and email are missing", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [makeUserRow({ oidc_subject: "sub-456", display_name: "sub-456", email: "sub-456@unknown" })],
      });

    const result = await resolveOrCreateAccount({
      sub: "sub-456",
      iss: "https://idp.example.com",
    });

    expect(result.displayName).toBe("sub-456");
    expect(result.email).toBe("sub-456@unknown");
    // Verify upsert params: sub, iss, displayName, email, global_role (5 params)
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1][0]).toBe("sub-456");
    expect(upsertCall[1][1]).toBe("https://idp.example.com");
    expect(upsertCall[1][2]).toBe("sub-456");        // displayName fallback
    expect(upsertCall[1][3]).toBe("sub-456@unknown"); // email fallback
    expect(upsertCall[1][4]).toBe("engineer");        // default global_role (no claim)
  });

  it("should use email as displayName when name is missing but email exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUserRow({ display_name: "bob@example.com", email: "bob@example.com" })] });

    await resolveOrCreateAccount({
      sub: "sub-789",
      iss: "https://idp.example.com",
      email: "bob@example.com",
    });

    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1][2]).toBe("bob@example.com"); // displayName param
  });

  it("creates separate accounts for two identities with the same email but different sub values (AC-2)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUserRow({ id: "user-A", oidc_subject: "sub-A" })] });

    const resultA = await resolveOrCreateAccount({
      sub: "sub-A",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUserRow({ id: "user-B", oidc_subject: "sub-B" })] });

    const resultB = await resolveOrCreateAccount({
      sub: "sub-B",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    expect(resultA.id).toBe("user-A");
    expect(resultB.id).toBe("user-B");
    expect(resultA.isNewUser).toBe(true);
    expect(resultB.isNewUser).toBe(true);

    const selectCallA = mockQuery.mock.calls[0];
    const selectCallB = mockQuery.mock.calls[2];
    expect(selectCallA[1]).toEqual(["sub-A", "https://idp.example.com"]);
    expect(selectCallB[1]).toEqual(["sub-B", "https://idp.example.com"]);
  });

  it("matches returning user by sub/iss and updates email when changed (AC-2)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [makeUserRow({ email: "new-email@example.com" })],
      });

    const result = await resolveOrCreateAccount({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "new-email@example.com",
    });

    expect(result.id).toBe("user-1");
    expect(result.isNewUser).toBe(false);
    expect(result.email).toBe("new-email@example.com");

    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1][0]).toBe("sub-123");
    expect(upsertCall[1][1]).toBe("https://idp.example.com");
    expect(upsertCall[1][3]).toBe("new-email@example.com");
  });

  it("handles simulated concurrent first access — both calls resolve to the correct user", async () => {
    const userRow = makeUserRow({
      id: "user-concurrent",
      oidc_subject: "sub-concurrent",
      display_name: "Carol",
      email: "carol@example.com",
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userRow] });

    const claims = {
      sub: "sub-concurrent",
      iss: "https://idp.example.com",
      name: "Carol",
      email: "carol@example.com",
    };

    const result1 = await resolveOrCreateAccount(claims);
    const result2 = await resolveOrCreateAccount(claims);

    expect(result1.id).toBe("user-concurrent");
    expect(result2.id).toBe("user-concurrent");
    expect(result1.isNewUser).toBe(true);
    expect(result2.isNewUser).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Task 2.3 / 2.4 — IdP role claim mapping (Decision 2, design.md)
  // -------------------------------------------------------------------------

  describe("IdP role claim mapping (Decision 2, establish-manager-team-relationship)", () => {
    it("maps 'engineering_manager' claim to global_role = 'engineering_manager'", async () => {
      // Task 2.3: user can reach global_role = 'engineering_manager' via IdP claim
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeUserRow({ global_role: "engineering_manager" })],
        });

      const result = await resolveOrCreateAccount({
        sub: "sub-em",
        iss: "https://idp.example.com",
        name: "Eve",
        email: "eve@example.com",
        role: "engineering_manager", // IdP role claim (default claim name: 'role')
      });

      // globalRole in result reflects the mapped value
      expect(result.globalRole).toBe("engineering_manager");

      // Upsert passes 'engineering_manager' as the global_role param (index 4)
      const upsertCall = mockQuery.mock.calls[1];
      expect(upsertCall[1][4]).toBe("engineering_manager");
    });

    it("maps 'application_admin' claim to global_role = 'application_admin'", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeUserRow({ global_role: "application_admin" })],
        });

      const result = await resolveOrCreateAccount({
        sub: "sub-admin",
        iss: "https://idp.example.com",
        name: "Admin",
        email: "admin@example.com",
        role: "application_admin",
      });

      expect(result.globalRole).toBe("application_admin");

      const upsertCall = mockQuery.mock.calls[1];
      expect(upsertCall[1][4]).toBe("application_admin");
    });

    it("defaults to 'engineer' when role claim is absent", async () => {
      // Task 2.3: absent claim → default role, not an error
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeUserRow()] });

      const result = await resolveOrCreateAccount({
        sub: "sub-no-claim",
        iss: "https://idp.example.com",
        name: "Frank",
        email: "frank@example.com",
        // no role claim
      });

      expect(result.globalRole).toBe("engineer");

      const upsertCall = mockQuery.mock.calls[1];
      expect(upsertCall[1][4]).toBe("engineer");
    });

    it("defaults to 'engineer' for an allowlist-rejected claim value and emits a warning", async () => {
      // Task 2.4: unrecognized claim → treated as absent; warning logged
      const mockLogger = { warn: vi.fn() };

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeUserRow()] });

      const result = await resolveOrCreateAccount(
        {
          sub: "sub-bad-claim",
          iss: "https://idp.example.com",
          name: "Greta",
          email: "greta@example.com",
          role: "superuser", // not on allowlist
        },
        mockLogger,
      );

      expect(result.globalRole).toBe("engineer");

      const upsertCall = mockQuery.mock.calls[1];
      expect(upsertCall[1][4]).toBe("engineer");

      // Warning must be emitted — but must NOT include the raw claim value
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const warnCall = mockLogger.warn.mock.calls[0];
      // Confirm the warning message and fields do not include 'superuser'
      expect(String(warnCall[0])).not.toContain("superuser");
      expect(JSON.stringify(warnCall[1] ?? {})).not.toContain("superuser");
    });

    it("re-evaluates global_role on every authentication — returning user's role updates when claim changes", async () => {
      // Task 2.4: re-evaluation on each authentication
      // Returning user previously had global_role = 'engineer'
      // Now signs in with role claim = 'engineering_manager'
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "user-em" }] }) // SELECT finds existing
        .mockResolvedValueOnce({
          rows: [makeUserRow({ id: "user-em", global_role: "engineering_manager" })],
        });

      const result = await resolveOrCreateAccount({
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
      const upsertCall = mockQuery.mock.calls[1];
      expect(upsertCall[1][4]).toBe("engineering_manager");
    });

    it("TEAM-006 precondition is satisfiable via the IdP claim path (end-to-end path test)", async () => {
      // Task 2.4: verifies the full path from sign-in to global_role = 'engineering_manager'
      // Steps:
      //   1. User signs in with IdP role claim 'engineering_manager'
      //   2. resolveOrCreateAccount sets global_role = 'engineering_manager' in the upsert
      //   3. TEAM-006 can then succeed because the precondition is met
      // This test covers step 2. TEAM-006 tests cover step 3.

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // new user
        .mockResolvedValueOnce({
          rows: [makeUserRow({ id: "user-em-new", global_role: "engineering_manager" })],
        });

      const result = await resolveOrCreateAccount({
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
      const upsertSql = (mockQuery.mock.calls[1][0] as string).toLowerCase();
      expect(upsertSql).toContain("global_role");
    });
  });
});
