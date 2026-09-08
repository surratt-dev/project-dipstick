import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// CSWSH mitigation tests — design.md Decision D9, tasks.md task 1.2a.
//
// Verifies: (1) isAllowedOrigin's pure allowlist logic, and (2)
// registerOriginCheck's onRequest hook actually rejects a WebSocket upgrade
// request whose Origin header isn't in the allowlist, actually allows one
// that is, and leaves ordinary (non-upgrade) HTTP requests completely
// unaffected — the hook must not become a general-purpose Origin check for
// every route, only for WS upgrade requests.
// ---------------------------------------------------------------------------

const mockGetAllowedOrigins = vi.fn();

vi.mock("../../config.js", () => ({
  getAllowedOrigins: () => mockGetAllowedOrigins(),
}));

import Fastify from "fastify";
import { isAllowedOrigin, registerOriginCheck } from "../origin-check.js";

const ALLOWED = ["http://localhost:5173", "https://app.example.com"];

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllowedOrigins.mockReturnValue(ALLOWED);
  });

  it("returns true for an origin in the allowlist", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });

  it("returns false for an origin not in the allowlist", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });

  it("returns false for an undefined origin", () => {
    expect(isAllowedOrigin(undefined)).toBe(false);
  });

  it("returns false for an empty-string origin", () => {
    expect(isAllowedOrigin("")).toBe(false);
  });
});

describe("registerOriginCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllowedOrigins.mockReturnValue(ALLOWED);
  });

  function buildApp() {
    const app = Fastify();
    registerOriginCheck(app);
    app.get("/ws/sessions/:sessionId", async () => ({ ok: true }));
    app.get("/api/v1/teams/:teamId", async () => ({ ok: true }));
    return app;
  }

  it("rejects a WebSocket upgrade request whose Origin is not in the allowlist", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/ws/sessions/s1",
      headers: {
        upgrade: "websocket",
        origin: "https://evil.example.com",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { category: "forbidden" } });
  });

  it("allows a WebSocket upgrade request whose Origin IS in the allowlist to reach the route", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/ws/sessions/s1",
      headers: {
        upgrade: "websocket",
        origin: "http://localhost:5173",
      },
    });

    // No @fastify/websocket plugin is registered in this isolated test, so
    // the route resolves as an ordinary HTTP handler — the point here is
    // only that the Origin check did NOT reject it (no 403).
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects a WebSocket upgrade request with no Origin header at all", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/ws/sessions/s1",
      headers: { upgrade: "websocket" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("does NOT apply the Origin check to an ordinary (non-upgrade) HTTP request, even from a disallowed origin", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/t1",
      headers: { origin: "https://evil.example.com" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("treats the Upgrade header case-insensitively", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/ws/sessions/s1",
      headers: {
        upgrade: "WebSocket",
        origin: "https://evil.example.com",
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
