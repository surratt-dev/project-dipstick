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

describe("resolveOrCreateAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return isNewUser=true when user does not exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT (no existing user)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            oidc_subject: "sub-123",
            oidc_issuer: "https://idp.example.com",
            display_name: "Alice",
            email: "alice@example.com",
          },
        ],
      });

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
      .mockResolvedValueOnce({
        rows: [{ id: "user-1" }], // SELECT finds existing
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            oidc_subject: "sub-123",
            oidc_issuer: "https://idp.example.com",
            display_name: "Alice Updated",
            email: "alice@example.com",
          },
        ],
      });

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
        rows: [
          {
            id: "user-2",
            oidc_subject: "sub-456",
            oidc_issuer: "https://idp.example.com",
            display_name: "sub-456",
            email: "sub-456@unknown",
          },
        ],
      });

    const result = await resolveOrCreateAccount({
      sub: "sub-456",
      iss: "https://idp.example.com",
    });

    expect(result.displayName).toBe("sub-456");
    expect(result.email).toBe("sub-456@unknown");
    // Verify the upsert query got the right fallback values
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1]).toEqual(["sub-456", "https://idp.example.com", "sub-456", "sub-456@unknown"]);
  });

  it("should use email as displayName when name is missing but email exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-3",
            oidc_subject: "sub-789",
            oidc_issuer: "https://idp.example.com",
            display_name: "bob@example.com",
            email: "bob@example.com",
          },
        ],
      });

    await resolveOrCreateAccount({
      sub: "sub-789",
      iss: "https://idp.example.com",
      email: "bob@example.com",
    });

    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1][2]).toBe("bob@example.com"); // displayName param
  });

  // Task 19: Verify sub/iss-only identity matching — same email, different sub

  it("creates separate accounts for two identities with the same email but different sub values (AC-2)", async () => {
    // First identity: sub-A, email@same.com
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT — no existing user for sub-A
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-A",
            oidc_subject: "sub-A",
            oidc_issuer: "https://idp.example.com",
            display_name: "Alice",
            email: "shared@example.com",
          },
        ],
      });

    const resultA = await resolveOrCreateAccount({
      sub: "sub-A",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    // Second identity: sub-B, same email — must create a NEW account
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT — no existing user for sub-B
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-B",
            oidc_subject: "sub-B",
            oidc_issuer: "https://idp.example.com",
            display_name: "Alice",
            email: "shared@example.com",
          },
        ],
      });

    const resultB = await resolveOrCreateAccount({
      sub: "sub-B",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "shared@example.com",
    });

    // Two separate accounts — identity is sub/iss, not email
    expect(resultA.id).toBe("user-A");
    expect(resultB.id).toBe("user-B");
    expect(resultA.isNewUser).toBe(true);
    expect(resultB.isNewUser).toBe(true);

    // Confirm the SELECT queries used sub/iss — never email — as match keys
    const selectCallA = mockQuery.mock.calls[0];
    const selectCallB = mockQuery.mock.calls[2];
    expect(selectCallA[1]).toEqual(["sub-A", "https://idp.example.com"]);
    expect(selectCallB[1]).toEqual(["sub-B", "https://idp.example.com"]);
  });

  it("matches returning user by sub/iss and updates email when changed (AC-2)", async () => {
    // Returning user: same sub/iss, but email has changed at the IdP
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "user-1" }], // SELECT finds existing account by sub/iss
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            oidc_subject: "sub-123",
            oidc_issuer: "https://idp.example.com",
            display_name: "Alice",
            email: "new-email@example.com", // Updated email in upsert result
          },
        ],
      });

    const result = await resolveOrCreateAccount({
      sub: "sub-123",
      iss: "https://idp.example.com",
      name: "Alice",
      email: "new-email@example.com", // Changed from original alice@example.com
    });

    // Matched to existing account (not a new user)
    expect(result.id).toBe("user-1");
    expect(result.isNewUser).toBe(false);
    // Email is updated in the database via the upsert SET clause
    expect(result.email).toBe("new-email@example.com");

    // The upsert query uses sub/iss in ON CONFLICT — never email
    const upsertCall = mockQuery.mock.calls[1];
    expect(upsertCall[1][0]).toBe("sub-123"); // oidc_subject param
    expect(upsertCall[1][1]).toBe("https://idp.example.com"); // oidc_issuer param
    expect(upsertCall[1][3]).toBe("new-email@example.com"); // email in SET, not WHERE
  });

  // Task 20: Verify concurrent upsert behavior (simulated)

  it("handles simulated concurrent first access — both calls resolve to the correct user (simulated-concurrency test)", async () => {
    // NOTE: This is a simulated-concurrency test. It verifies the code path
    // but not timing-sensitive behavior. In the simulation, both callbacks
    // read an empty SELECT (simulating the race where neither callback has
    // completed its upsert when the other reads). The upsert mock then returns
    // the correct user record for each call, as the real ON CONFLICT DO UPDATE
    // would in a live database.
    //
    // A true concurrent test against a live database is the gold standard for
    // AC-3 — the mock test verifies the code path but not timing constraints.

    const userRow = {
      id: "user-concurrent",
      oidc_subject: "sub-concurrent",
      oidc_issuer: "https://idp.example.com",
      display_name: "Carol",
      email: "carol@example.com",
    };

    // Sequential interleaving: SELECT1 empty → UPSERT1 succeeds →
    //                           SELECT2 empty (race) → UPSERT2 succeeds (ON CONFLICT)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })          // SELECT — first callback, no existing user
      .mockResolvedValueOnce({ rows: [userRow] })   // UPSERT — first callback, creates account
      .mockResolvedValueOnce({ rows: [] })          // SELECT — second callback, also sees empty (race)
      .mockResolvedValueOnce({ rows: [userRow] });  // UPSERT — second callback, ON CONFLICT DO UPDATE

    const claims = {
      sub: "sub-concurrent",
      iss: "https://idp.example.com",
      name: "Carol",
      email: "carol@example.com",
    };

    const result1 = await resolveOrCreateAccount(claims);
    const result2 = await resolveOrCreateAccount(claims);

    // Both calls return the correct user — no error thrown
    expect(result1.id).toBe("user-concurrent");
    expect(result2.id).toBe("user-concurrent");

    // Both calls see isNewUser=true due to the documented race condition.
    // This is the known limitation: any consumer of isNewUser may fire twice
    // in a concurrent scenario. See the constraint comment in account-resolver.ts.
    expect(result1.isNewUser).toBe(true);
    expect(result2.isNewUser).toBe(true);

    // Exactly 4 db operations: 2 SELECT + 2 UPSERT
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
