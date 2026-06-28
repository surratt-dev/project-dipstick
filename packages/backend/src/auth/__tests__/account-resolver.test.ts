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
});
