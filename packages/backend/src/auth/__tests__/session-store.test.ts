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
  config: { SESSION_SECRET: "test", REDIS_URL: "redis://test" },
}));

const mockRedisSet = vi.fn();
vi.mock("../../redis.js", () => ({
  redis: { set: (...args: unknown[]) => mockRedisSet(...args) },
}));

import { buildSessionData, getDecryptedTokens, conditionallyUpdateSession } from "../session-store.js";
import type { SessionData } from "../session-store.js";

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

describe("conditionallyUpdateSession (design.md Decision D3a)", () => {
  beforeEach(() => {
    mockRedisSet.mockReset();
  });

  const session: SessionData = {
    userId: "user-1",
    sessionCreatedAt: "2025-06-01T12:00:00Z",
    encryptedAccessToken: "encrypted(new-access)",
    tokenExpiresAt: 1700003600,
  };

  it("writes with SET ... XX and returns true when the key exists", async () => {
    mockRedisSet.mockResolvedValue("OK");

    const result = await conditionallyUpdateSession("sess-1", session);

    expect(result).toBe(true);
    expect(mockRedisSet).toHaveBeenCalledWith(
      "dipstick:session:sess-1",
      JSON.stringify(session),
      "EX",
      2 * 60 * 60,
      "XX",
    );
  });

  it("returns false and performs no logical write against a key that does not exist", async () => {
    // Redis's SET ... XX returns null (not "OK") when the key does not exist.
    mockRedisSet.mockResolvedValue(null);

    const result = await conditionallyUpdateSession("sess-nonexistent", session);

    expect(result).toBe(false);
  });
});
