import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("connect-redis", () => ({
  RedisStore: vi.fn(),
}));

vi.mock("../token-encryption.js", () => ({
  encryptToken: vi.fn((val: string) => `encrypted(${val})`),
  decryptToken: vi.fn((val: string) => {
    const match = val.match(/^encrypted\((.+)\)$/);
    return match ? match[1] : val;
  }),
}));

vi.mock("../../config.js", () => ({
  config: { SESSION_SECRET: "test" },
}));

import { buildSessionData, getDecryptedTokens } from "../session-store.js";

describe("buildSessionData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should encrypt all provided tokens", () => {
    const result = buildSessionData("user-1", {
      accessToken: "access-123",
      refreshToken: "refresh-456",
      idToken: "id-789",
      expiresAt: 1700000000,
    });

    expect(result.userId).toBe("user-1");
    expect(result.encryptedAccessToken).toBe("encrypted(access-123)");
    expect(result.encryptedRefreshToken).toBe("encrypted(refresh-456)");
    expect(result.encryptedIdToken).toBe("encrypted(id-789)");
    expect(result.tokenExpiresAt).toBe(1700000000);
    expect(result.sessionCreatedAt).toBe("2025-06-01T12:00:00.000Z");
  });

  it("should omit optional tokens when not provided", () => {
    const result = buildSessionData("user-1", {
      accessToken: "access-123",
      expiresAt: 1700000000,
    });

    expect(result.encryptedAccessToken).toBe("encrypted(access-123)");
    expect(result.encryptedRefreshToken).toBeUndefined();
    expect(result.encryptedIdToken).toBeUndefined();
  });
});

describe("getDecryptedTokens", () => {
  it("should decrypt all tokens", () => {
    const result = getDecryptedTokens({
      userId: "user-1",
      sessionCreatedAt: "2025-06-01T12:00:00Z",
      encryptedAccessToken: "encrypted(access-123)",
      encryptedRefreshToken: "encrypted(refresh-456)",
      encryptedIdToken: "encrypted(id-789)",
      tokenExpiresAt: 1700000000,
    });

    expect(result.accessToken).toBe("access-123");
    expect(result.refreshToken).toBe("refresh-456");
    expect(result.idToken).toBe("id-789");
    expect(result.expiresAt).toBe(1700000000);
  });

  it("should return undefined for missing optional tokens", () => {
    const result = getDecryptedTokens({
      userId: "user-1",
      sessionCreatedAt: "2025-06-01T12:00:00Z",
      encryptedAccessToken: "encrypted(access-123)",
      tokenExpiresAt: 1700000000,
    });

    expect(result.accessToken).toBe("access-123");
    expect(result.refreshToken).toBeUndefined();
    expect(result.idToken).toBeUndefined();
  });
});
