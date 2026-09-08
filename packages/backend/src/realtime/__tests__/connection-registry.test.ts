import { describe, it, expect, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test-secret-test-secret-test-secret",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
  PORT: 3000,
}));

import {
  ConnectionRegistry,
  isPastAbsoluteLifetime,
  safeSend,
  type RegisteredConnection,
} from "../connection-registry.js";

function fakeSocket(readyState: number, sendImpl?: (data: string) => void) {
  return {
    readyState,
    send: sendImpl ?? vi.fn(),
  } as unknown as RegisteredConnection["socket"];
}

function makeConn(overrides: Partial<RegisteredConnection> = {}): RegisteredConnection {
  return {
    socket: fakeSocket(1),
    userId: "user-1",
    sessionCreatedAt: Date.now(),
    ...overrides,
  };
}

describe("ConnectionRegistry", () => {
  it("registers and returns local candidates for a session scope", () => {
    const registry = new ConnectionRegistry();
    const conn = makeConn();

    registry.register("session", "session-1", conn);

    expect(registry.candidates("session", "session-1")).toEqual([conn]);
    expect(registry.candidates("session", "session-2")).toEqual([]);
  });

  it("keeps session and team scopes independent", () => {
    const registry = new ConnectionRegistry();
    const conn = makeConn();

    registry.register("session", "id-1", conn);

    expect(registry.candidates("team", "id-1")).toEqual([]);
  });

  it("supports multiple candidates for the same id", () => {
    const registry = new ConnectionRegistry();
    const connA = makeConn({ userId: "a" });
    const connB = makeConn({ userId: "b" });

    registry.register("session", "session-1", connA);
    registry.register("session", "session-1", connB);

    expect(registry.candidates("session", "session-1")).toHaveLength(2);
    expect(registry.size("session")).toBe(2);
  });

  it("deregisters a connection and cleans up the empty set", () => {
    const registry = new ConnectionRegistry();
    const conn = makeConn();
    registry.register("session", "session-1", conn);

    registry.deregister("session", "session-1", conn);

    expect(registry.candidates("session", "session-1")).toEqual([]);
  });

  it("deregistration is a no-op for an id that was never registered", () => {
    const registry = new ConnectionRegistry();
    const conn = makeConn();

    expect(() => registry.deregister("session", "nonexistent", conn)).not.toThrow();
  });

  it("clears a pending forceCloseTimer on deregistration", () => {
    vi.useFakeTimers();
    try {
      const registry = new ConnectionRegistry();
      const timer = setTimeout(() => {}, 1000);
      const conn = makeConn({ forceCloseTimer: timer });
      registry.register("session", "session-1", conn);

      const clearSpy = vi.spyOn(global, "clearTimeout");
      registry.deregister("session", "session-1", conn);

      expect(clearSpy).toHaveBeenCalledWith(timer);
      expect(conn.forceCloseTimer).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isPastAbsoluteLifetime", () => {
  it("returns false for a freshly created connection", () => {
    expect(isPastAbsoluteLifetime({ sessionCreatedAt: Date.now() })).toBe(false);
  });

  it("returns true once the connection is older than 90 minutes", () => {
    const ninetyOneMinutesAgo = Date.now() - 91 * 60 * 1000;
    expect(isPastAbsoluteLifetime({ sessionCreatedAt: ninetyOneMinutesAgo })).toBe(true);
  });

  it("returns false just under the 90-minute boundary", () => {
    const eightyNineMinutesAgo = Date.now() - 89 * 60 * 1000;
    expect(isPastAbsoluteLifetime({ sessionCreatedAt: eightyNineMinutesAgo })).toBe(false);
  });
});

describe("safeSend", () => {
  it("sends and returns true for an OPEN socket", () => {
    const registry = new ConnectionRegistry();
    const send = vi.fn();
    const conn = makeConn({ socket: fakeSocket(1, send) });
    registry.register("session", "session-1", conn);

    const result = safeSend(registry, "session", "session-1", conn, '{"hello":true}');

    expect(result).toBe(true);
    expect(send).toHaveBeenCalledWith('{"hello":true}');
    // Still registered — a successful send does not deregister.
    expect(registry.candidates("session", "session-1")).toEqual([conn]);
  });

  it("does not call .send() and deregisters when readyState is not OPEN", () => {
    const registry = new ConnectionRegistry();
    const send = vi.fn();
    const conn = makeConn({ socket: fakeSocket(3, send) }); // CLOSED
    registry.register("session", "session-1", conn);

    const result = safeSend(registry, "session", "session-1", conn, "data");

    expect(result).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(registry.candidates("session", "session-1")).toEqual([]);
  });

  it("deregisters when .send() throws synchronously (defensive path)", () => {
    const registry = new ConnectionRegistry();
    const send = vi.fn(() => {
      throw new Error("boom");
    });
    const conn = makeConn({ socket: fakeSocket(1, send) }); // OPEN, but send throws
    registry.register("session", "session-1", conn);

    const result = safeSend(registry, "session", "session-1", conn, "data");

    expect(result).toBe(false);
    expect(registry.candidates("session", "session-1")).toEqual([]);
  });
});
