import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from "fastify";
import { refreshToken as refreshOidcToken } from "./oidc-client.js";
import { encryptToken } from "./token-encryption.js";
import { getDecryptedTokens } from "./session-store.js";
import type { SessionData } from "./session-store.js";
import { emitAuditEvent } from "./audit-logger.js";

const PUBLIC_ROUTES = ["/health", "/auth/login", "/auth/callback", "/auth/logout", "/api/join/"];

// Exported for reuse by the WebSocket delivery-time authorization layer
// (websocket-delivery-time-authorization, design.md Decision D8): a
// WebSocket connection has no subsequent HTTP request for this hook to
// re-run against, so the connection registry and delivery-time check reuse
// this same constant to bound connection age instead of leaving it unbounded
// until the SEC-25/26 companion effort ships its own heartbeat.
export const ABSOLUTE_LIFETIME_MS = 90 * 60 * 1000; // 90 minutes

// Exported for reuse by websocket-connection-reauthorization (design.md
// Decision D3): the WS-side silent-refresh timer reuses these exact
// thresholds/budgets rather than inventing its own.
export const TOKEN_REFRESH_THRESHOLD_S = 5 * 60; // 5 minutes before expiry
export const REFRESH_RETRY_DELAY_MS = 5000;
export const REFRESH_MAX_RETRIES = 2;

function isPublicRoute(url: string): boolean {
  return PUBLIC_ROUTES.some((route) => url.startsWith(route));
}

export type RefreshResult =
  | { status: "refreshed"; session: SessionData }
  | { status: "revoked" }
  | { status: "transient_failure" }
  | { status: "no_refresh_token" };

// ---------------------------------------------------------------------------
// refreshSessionTokens — extracted from authMiddleware's onRequest hook
// (websocket-connection-reauthorization, design.md Decision D3) so the WS-side
// silent-refresh timer (connection-token-refresh.ts) can reuse the exact same
// retry/backoff/revocation-distinction logic the HTTP path already has,
// rather than a second implementation of it.
//
// Returns a NEW SessionData object on "refreshed" — does NOT mutate `session`
// in place. Callers are responsible for persisting the result: the HTTP
// caller (below) copies the returned fields back onto `request.session` so
// @fastify/session's save-on-mutation dirty-tracking persists them; the WS
// caller writes them back via session-store.ts's conditionallyUpdateSession.
//
// `sessionId` exists solely so this function can reproduce the
// `sessionId: request.session.sessionId` field the original inline code's
// audit emits included — SessionData itself carries no Fastify session id.
// `source` is attached to the emitted audit events so the two writers
// (HTTP vs. WS) are distinguishable in the audit trail.
// ---------------------------------------------------------------------------
export async function refreshSessionTokens(
  session: SessionData,
  sessionId: string,
  log: FastifyBaseLogger,
  source: "http" | "websocket",
): Promise<RefreshResult> {
  const tokens = getDecryptedTokens(session);
  if (!tokens.refreshToken) {
    return { status: "no_refresh_token" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  let retries = 0;

  while (retries <= REFRESH_MAX_RETRIES) {
    try {
      const newTokens = await refreshOidcToken(tokens.refreshToken);
      const expiresIn = newTokens.expires_in;
      const refreshed: SessionData = {
        ...session,
        encryptedAccessToken: encryptToken(newTokens.access_token),
        tokenExpiresAt: nowSeconds + (typeof expiresIn === "number" ? expiresIn : 3600),
      };
      if (newTokens.refresh_token) {
        refreshed.encryptedRefreshToken = encryptToken(newTokens.refresh_token);
      }

      emitAuditEvent(log, "auth.token_refresh_success", {
        userId: session.userId,
        sessionId,
        source,
      });

      return { status: "refreshed", session: refreshed };
    } catch (err: unknown) {
      const isRevocation =
        err instanceof Error &&
        (err.message.includes("invalid_grant") ||
          ("code" in err && (err as { code?: string }).code === "invalid_grant"));

      if (isRevocation) {
        emitAuditEvent(log, "auth.token_refresh_failure", {
          userId: session.userId,
          sessionId,
          source,
          failureType: "revoked",
          retryCount: retries,
        });
        return { status: "revoked" };
      }

      retries++;
      if (retries <= REFRESH_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
      }
    }
  }

  emitAuditEvent(log, "auth.token_refresh_failure", {
    userId: session.userId,
    sessionId,
    source,
    failureType: "transient",
    retryCount: retries,
  });
  return { status: "transient_failure" };
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
      const result = await refreshSessionTokens(session, request.session.sessionId, request.log, "http");

      switch (result.status) {
        case "refreshed": {
          // Required copy-back, not optional plumbing: refreshSessionTokens
          // returns a NEW object rather than mutating `session` in place, so
          // @fastify/session's save-on-mutation dirty-tracking only persists
          // this refresh if these fields are explicitly assigned onto
          // request.session itself (websocket-connection-reauthorization,
          // design.md Decision D3 / Engineer Finding 2).
          session.encryptedAccessToken = result.session.encryptedAccessToken;
          session.encryptedRefreshToken = result.session.encryptedRefreshToken;
          session.tokenExpiresAt = result.session.tokenExpiresAt;
          break;
        }
        case "revoked": {
          const userId = session.userId;
          const sessionId = request.session.sessionId;
          request.session.destroy();
          emitAuditEvent(request.log, "auth.session_invalidated", {
            userId,
            sessionId,
            reason: "token_revoked",
          });
          return reply.code(401).send({ error: { category: "session_expired", message: "Your session has been terminated. Please sign in again.", correlationId: crypto.randomUUID() } });
        }
        case "transient_failure": {
          const userId = session.userId;
          const sessionId = request.session.sessionId;
          request.session.destroy();
          emitAuditEvent(request.log, "auth.session_invalidated", {
            userId,
            sessionId,
            reason: "refresh_failure",
          });
          return reply.code(401).send({ error: { category: "provider_unavailable", message: "Unable to maintain your session. Please sign in again.", correlationId: crypto.randomUUID() } });
        }
        case "no_refresh_token":
          // Matches today's existing behavior: no refresh token present,
          // proceed on the existing (soon-to-expire) token without error.
          break;
      }
    }

    // Touch session to refresh sliding TTL (handled by connect-redis automatically on save)
    request.session.touch();
  });
}
