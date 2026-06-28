import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { refreshToken as refreshOidcToken } from "./oidc-client.js";
import { encryptToken } from "./token-encryption.js";
import { getDecryptedTokens } from "./session-store.js";
import type { SessionData } from "./session-store.js";
import { emitAuditEvent } from "./audit-logger.js";

const PUBLIC_ROUTES = ["/health", "/auth/login", "/auth/callback", "/auth/logout", "/api/join/"];

const ABSOLUTE_LIFETIME_MS = 90 * 60 * 1000; // 90 minutes
const TOKEN_REFRESH_THRESHOLD_S = 5 * 60; // 5 minutes before expiry
const REFRESH_RETRY_DELAY_MS = 5000;
const REFRESH_MAX_RETRIES = 2;

function isPublicRoute(url: string): boolean {
  return PUBLIC_ROUTES.some((route) => url.startsWith(route));
}

export async function authMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    const session = request.session as unknown as SessionData & { cookie?: unknown; destroy: (cb?: (err?: Error) => void) => void };

    if (!session?.userId) {
      return reply.code(401).send({ error: { category: "session_expired", message: "Please sign in to continue.", correlationId: crypto.randomUUID() } });
    }

    // Check absolute lifetime
    const sessionCreated = new Date(session.sessionCreatedAt).getTime();
    if (Date.now() - sessionCreated > ABSOLUTE_LIFETIME_MS) {
      const userId = session.userId;
      const sessionId = request.session.sessionId;
      request.session.destroy();
      emitAuditEvent(request.log, "auth.session_invalidated", {
        userId,
        sessionId,
        reason: "absolute_timeout",
      });
      return reply.code(401).send({ error: { category: "session_expired", message: "Your session has expired. Please sign in again.", correlationId: crypto.randomUUID() } });
    }

    // Check if token needs refresh
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (session.tokenExpiresAt - nowSeconds < TOKEN_REFRESH_THRESHOLD_S) {
      const tokens = getDecryptedTokens(session);
      if (tokens.refreshToken) {
        let refreshed = false;
        let retries = 0;

        while (!refreshed && retries <= REFRESH_MAX_RETRIES) {
          try {
            const newTokens = await refreshOidcToken(tokens.refreshToken);
            session.encryptedAccessToken = encryptToken(newTokens.access_token);
            if (newTokens.refresh_token) {
              session.encryptedRefreshToken = encryptToken(newTokens.refresh_token);
            }
            const expiresIn = newTokens.expires_in;
            session.tokenExpiresAt = nowSeconds + (typeof expiresIn === "number" ? expiresIn : 3600);
            refreshed = true;

            emitAuditEvent(request.log, "auth.token_refresh_success", {
              userId: session.userId,
              sessionId: request.session.sessionId,
            });
          } catch (err: unknown) {
            const isRevocation =
              err instanceof Error &&
              (err.message.includes("invalid_grant") ||
                ("code" in err && (err as { code?: string }).code === "invalid_grant"));

            if (isRevocation) {
              const userId = session.userId;
              const sessionId = request.session.sessionId;
              request.session.destroy();
              emitAuditEvent(request.log, "auth.token_refresh_failure", {
                userId,
                sessionId,
                failureType: "revoked",
                retryCount: retries,
              });
              emitAuditEvent(request.log, "auth.session_invalidated", {
                userId,
                sessionId,
                reason: "token_revoked",
              });
              return reply.code(401).send({ error: { category: "session_expired", message: "Your session has been terminated. Please sign in again.", correlationId: crypto.randomUUID() } });
            }

            retries++;
            if (retries <= REFRESH_MAX_RETRIES) {
              await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
            }
          }
        }

        if (!refreshed) {
          const userId = session.userId;
          const sessionId = request.session.sessionId;
          request.session.destroy();
          emitAuditEvent(request.log, "auth.token_refresh_failure", {
            userId,
            sessionId,
            failureType: "transient",
            retryCount: retries,
          });
          emitAuditEvent(request.log, "auth.session_invalidated", {
            userId,
            sessionId,
            reason: "refresh_failure",
          });
          return reply.code(401).send({ error: { category: "provider_unavailable", message: "Unable to maintain your session. Please sign in again.", correlationId: crypto.randomUUID() } });
        }
      }
    }

    // Touch session to refresh sliding TTL (handled by connect-redis automatically on save)
    request.session.touch();
  });
}
