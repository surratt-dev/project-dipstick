import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { redis } from "../redis.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health/live", async (_req, reply) => {
    return reply.send({ status: "ok" });
  });

  app.get("/health/ready", async (_req, reply) => {
    const status = { postgres: "ok", redis: "ok" };

    try {
      await db.query("SELECT 1");
    } catch {
      status.postgres = "unavailable";
    }

    try {
      await redis.ping();
    } catch {
      status.redis = "unavailable";
    }

    const healthy = status.postgres === "ok" && status.redis === "ok";
    return reply.code(healthy ? 200 : 503).send(status);
  });
}
