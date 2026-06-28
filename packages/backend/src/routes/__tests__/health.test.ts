import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();
const mockRedisPing = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../redis.js", () => ({
  redis: { ping: () => mockRedisPing() },
}));
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import Fastify from "fastify";
import { healthRoutes } from "../health.js";

describe("health routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(healthRoutes);
    await app.ready();
    return app;
  }

  describe("GET /health/live", () => {
    it("should return 200 with status ok", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/live" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /health/ready", () => {
    it("should return 200 when both db and redis are healthy", async () => {
      mockDbQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
      mockRedisPing.mockResolvedValue("PONG");

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ postgres: "ok", redis: "ok" });
    });

    it("should return 503 when postgres is down", async () => {
      mockDbQuery.mockRejectedValue(new Error("connection refused"));
      mockRedisPing.mockResolvedValue("PONG");

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ postgres: "unavailable", redis: "ok" });
    });

    it("should return 503 when redis is down", async () => {
      mockDbQuery.mockResolvedValue({ rows: [] });
      mockRedisPing.mockRejectedValue(new Error("ECONNREFUSED"));

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ postgres: "ok", redis: "unavailable" });
    });

    it("should return 503 when both are down", async () => {
      mockDbQuery.mockRejectedValue(new Error("down"));
      mockRedisPing.mockRejectedValue(new Error("down"));

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ postgres: "unavailable", redis: "unavailable" });
    });
  });
});
