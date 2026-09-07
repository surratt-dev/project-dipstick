import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { joinLinkRoutes } from "./routes/join-links.js";
import { teamRoutes } from "./routes/teams.js";
import { sessionRoutes } from "./routes/sessions.js";
import { emViewRoutes } from "./routes/em-views.js";
import { contentRoutes } from "./routes/content.js";
import { facilitatorSessionRoutes } from "./routes/facilitator-sessions.js";
import { config } from "./config.js";
import { redis } from "./redis.js";
import { createRedisStore } from "./auth/session-store.js";
import { authMiddleware } from "./auth/middleware.js";

const isProduction = config.NODE_ENV === "production";

export async function buildApp() {
  const app = Fastify({
    // trustProxy: 1 causes request.ip to resolve from X-Forwarded-For (the real
    // client IP) rather than the raw socket's remoteAddress (the proxy IP in
    // production deployments behind a load balancer or Kubernetes ingress).
    // The value 1 means a single-layer proxy hop is trusted, which matches this
    // application's deployment topology. Without this, every sourceIp field in
    // every audit event carries the proxy IP instead of the client IP.
    trustProxy: 1,
    logger: {
      serializers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req(request: any) {
          const url = typeof request.url === "string" ? request.url : "";
          return {
            method: request.method,
            url: url
              .replace(/\/api\/join\/[^/?#]+/, "/api/join/[REDACTED]")
              .replace(/(\/auth\/login\?.*joinToken=)[^&]+/, "$1[REDACTED]"),
            hostname: request.hostname,
            remoteAddress: request.remoteAddress,
          };
        },
      },
    },
  });

  await app.register(sensible);

  // CORS
  await app.register(cors, {
    origin: isProduction
      ? [config.APP_ORIGIN ?? ""]
      : ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // Deferred to a separate change
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    noSniff: true,
  });

  // Cookie plugin (required before session)
  await app.register(cookie);

  // Session with Redis store
  const redisStore = createRedisStore(redis);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    store: redisStore,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: "/",
    },
    saveUninitialized: false,
    rolling: true,
  });

  // Auth middleware
  await authMiddleware(app);

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(joinLinkRoutes);
  await app.register(teamRoutes);
  await app.register(sessionRoutes);
  await app.register(emViewRoutes);
  await app.register(contentRoutes);
  await app.register(facilitatorSessionRoutes);

  return app;
}
