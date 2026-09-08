import type { FastifyInstance } from "fastify";
import { getAllowedOrigins } from "../config.js";

// ---------------------------------------------------------------------------
// CSWSH mitigation — explicit Origin validation on the WebSocket upgrade
// handshake.
//
// websocket-delivery-time-authorization: design.md Decision D9, tasks.md
// task 1.2a.
//
// A WebSocket upgrade handshake is not subject to the Same-Origin Policy's
// CORS preflight the way a fetch/XHR request is — @fastify/cors's origin
// allowlist (app.ts) does not extend to the WS upgrade path. A page on any
// origin can open `new WebSocket(...)` against this server from a victim's
// browser, and the browser still attaches the session cookie, because
// cookie attachment follows the cookie's own attributes, not CORS.
//
// The session cookie is already `sameSite: "strict"` (app.ts), which
// substantially mitigates this already — this hook is defense-in-depth, not
// a fix for an otherwise-open hole, per OWASP's WebSocket security guidance
// (SameSite enforcement for upgrade requests has historically been less
// consistent across browsers than for fetch/XHR).
//
// This hook MUST be registered on `app` BEFORE authMiddleware's onRequest
// hook (app.ts), so the Origin check runs before request.session is
// consulted — per Decision D9's explicit ordering requirement. It reuses
// the exact same allowlist @fastify/cors uses (config.ts's
// getAllowedOrigins()) — no new configuration surface.
//
// Scope: this hook only inspects requests carrying the WebSocket upgrade
// header. Ordinary HTTP requests are unaffected — they remain governed
// entirely by @fastify/cors, as before.
// ---------------------------------------------------------------------------

function isWebSocketUpgradeRequest(headers: Record<string, unknown>): boolean {
  const upgrade = headers["upgrade"];
  return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

export function registerOriginCheck(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isWebSocketUpgradeRequest(request.headers as Record<string, unknown>)) {
      return;
    }

    if (!isAllowedOrigin(request.headers.origin)) {
      request.log.warn(
        { origin: request.headers.origin, url: request.url },
        "websocket upgrade rejected: origin not in allowlist",
      );
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Origin not permitted.",
          correlationId: crypto.randomUUID(),
        },
      });
    }
  });
}
