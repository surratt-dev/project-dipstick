import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { randomBytes } from "node:crypto";
import * as oidcClient from "openid-client";
import { redis } from "../redis.js";
import { config } from "../config.js";
import { db } from "../db.js";
import {
  getAuthorizationUrl,
  handleCallback,
  getEndSessionUrl,
} from "../auth/oidc-client.js";
import { resolveOrCreateAccount } from "../auth/account-resolver.js";
import { buildSessionData, getDecryptedTokens } from "../auth/session-store.js";
import type { SessionData } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { mapAuthError } from "../auth/error-handler.js";
import { MissingClaimError } from "../auth/errors.js";
import type { AuthSession } from "@dipstick/shared";

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_PREFIX = "dipstick:auth:state:";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /auth/login
  app.get<{
    Querystring: { joinToken?: string };
  }>("/login", async (request, reply) => {
    const state = randomBytes(32).toString("base64url");
    const nonce = oidcClient.randomNonce();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();

    // Store state, nonce, code verifier, and pending join token in Redis
    const stateData: Record<string, string> = {
      nonce,
      codeVerifier,
      createdAt: new Date().toISOString(),
    };

    const joinToken = request.query.joinToken;
    if (joinToken) {
      stateData["pendingJoinToken"] = joinToken;
    }

    await redis.setex(
      `${STATE_PREFIX}${state}`,
      STATE_TTL_SECONDS,
      JSON.stringify(stateData),
    );

    emitAuditEvent(request.log, "auth.authorization_initiated", {
      sourceIp: request.ip,
      hasJoinContext: Boolean(joinToken),
      stateNonce: state.substring(0, 8) + "...",
    });

    const { url } = await getAuthorizationUrl(state, nonce, codeVerifier);
    return reply.redirect(url.toString());
  });

  // GET /auth/callback
  app.get("/callback", async (request, reply) => {
    const correlationId = crypto.randomUUID();

    try {
      const callbackUrl = new URL(
        `${request.protocol}://${request.hostname}${request.url}`,
      );
      const stateParam = callbackUrl.searchParams.get("state");

      if (!stateParam) {
        emitAuditEvent(request.log, "auth.failure", {
          sourceIp: request.ip,
          failureCategory: "invalid_request",
          correlationId,
        });
        return reply.redirect(
          `/auth/error?category=invalid_request&message=${encodeURIComponent("The sign-in request could not be verified. Please try signing in again from the beginning.")}&correlationId=${correlationId}`,
        );
      }

      // Retrieve and delete state from Redis (single-use)
      const stateKey = `${STATE_PREFIX}${stateParam}`;
      const stateDataRaw = await redis.get(stateKey);
      await redis.del(stateKey);

      if (!stateDataRaw) {
        emitAuditEvent(request.log, "auth.failure", {
          sourceIp: request.ip,
          failureCategory: "invalid_request",
          correlationId,
        });
        return reply.redirect(
          `/auth/error?category=invalid_request&message=${encodeURIComponent("The sign-in request has expired or is invalid. Please try signing in again.")}&correlationId=${correlationId}`,
        );
      }

      const stateData = JSON.parse(stateDataRaw) as {
        nonce: string;
        codeVerifier: string;
        pendingJoinToken?: string;
        createdAt: string;
      };

      emitAuditEvent(request.log, "auth.callback_received", {
        sourceIp: request.ip,
        stateNonce: stateParam.substring(0, 8) + "...",
        success: true,
      });

      // Exchange code for tokens with nonce and PKCE verification
      const tokens = await handleCallback(
        callbackUrl,
        stateData.nonce,
        stateParam,
        stateData.codeVerifier,
      );

      // Task 4: Validate required claims before account resolution.
      //
      // An absent or empty sub/iss would cause resolveOrCreateAccount to upsert
      // a record keyed on ("", "") — a genuine identity confusion risk where any
      // future empty-claim authentication resolves to that phantom account.
      // Reject the authentication here, before any database write, and without
      // logging any claim values (only the claim name is safe to log).
      const claims = tokens.claims();
      if (!claims) {
        throw new MissingClaimError("sub");
      }
      if (!claims.sub) {
        throw new MissingClaimError("sub");
      }
      if (!claims.iss) {
        throw new MissingClaimError("iss");
      }

      // Resolve or create user account
      const user = await resolveOrCreateAccount({
        sub: claims.sub,
        iss: claims.iss,
        name: claims.name as string | undefined,
        email: claims.email as string | undefined,
      });

      // Task 7: Emit first_access_created with sourceIp and correlationId,
      // matching the complete event shape used by every other security-relevant
      // audit event in the system.
      if (user.isNewUser) {
        emitAuditEvent(request.log, "auth.first_access_created", {
          userId: user.id,
          oidcSubject: user.oidcSubject,
          oidcIssuer: user.oidcIssuer,
          sourceIp: request.ip,
          correlationId,
        });
      }

      // Task 3: Session fixation prevention via regenerate() alone.
      //
      // The previous implementation called session.destroy() (in an
      // always-resolve callback) followed by session.regenerate(). This was
      // redundant and unsafe: a Redis error inside destroy() is silently
      // swallowed by the always-resolve callback, leaving the old session live
      // in the store while a new one is created. regenerate() alone atomically
      // invalidates the old session ID and creates a fresh one — no error
      // swallowing, no double operation.
      await request.session.regenerate();

      // Populate session with user data and encrypted tokens
      const expiresIn = tokens.expires_in;
      const sessionData = buildSessionData(user.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresAt:
          Math.floor(Date.now() / 1000) +
          (typeof expiresIn === "number" ? expiresIn : 3600),
      });

      // Copy session data fields onto the session object
      const sess = request.session as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(sessionData)) {
        sess[key] = value;
      }

      emitAuditEvent(request.log, "auth.session_created", {
        userId: user.id,
        sessionId: request.session.sessionId,
      });

      emitAuditEvent(request.log, "auth.success", {
        userId: user.id,
        oidcSubject: user.oidcSubject,
        oidcIssuer: user.oidcIssuer,
        isFirstAccess: user.isNewUser,
      });

      // Handle pending join token
      let redirectUrl: string | null = null;
      if (stateData.pendingJoinToken) {
        const joinResult = await executeJoinFlow(
          user.id,
          stateData.pendingJoinToken,
          request.log,
        );
        if (joinResult.redirectUrl) {
          redirectUrl = joinResult.redirectUrl;
        }
      }

      // Task 5: Server-side redirect based on live team membership data.
      //
      // If the join flow already produced a specific redirect (to a team page
      // or an active session), use it. Otherwise query the user's current team
      // memberships and route to /no-team (no memberships) or /team/:teamId
      // (has at least one). This replaces the former default redirect to "/",
      // ensuring the routing decision is made server-side against live data.
      if (!redirectUrl) {
        const membershipsResult = await db.query(
          `SELECT team_id FROM team_memberships
           WHERE user_id = $1 AND removed_at IS NULL
           LIMIT 1`,
          [user.id],
        );
        if ((membershipsResult.rows as { team_id: string }[]).length > 0) {
          const firstTeam = membershipsResult.rows[0] as { team_id: string };
          redirectUrl = `/team/${firstTeam.team_id}`;
        } else {
          redirectUrl = "/no-team";
        }
      }

      await request.session.save();
      return reply.redirect(redirectUrl);
    } catch (err: unknown) {
      const authError = mapAuthError(err);

      request.log.error({
        err,
        correlationId,
        sourceIp: request.ip,
        event: "auth.callback_error",
      });

      const auditFields: Record<string, unknown> = {
        sourceIp: request.ip,
        failureCategory: authError.category,
        correlationId,
      };

      // Include the specific missing claim name in the audit event so operators
      // can identify which claim was absent without any PII appearing in the log.
      if (err instanceof MissingClaimError) {
        auditFields.missingClaim = err.claim;
      }

      emitAuditEvent(request.log, "auth.failure", auditFields);

      return reply.redirect(
        `/auth/error?category=${authError.category}&message=${encodeURIComponent(authError.message)}&correlationId=${correlationId}`,
      );
    }
  });

  // POST /auth/logout
  app.post<{
    Querystring: { confirmed?: string };
  }>("/logout", async (request, reply) => {
    const session = request.session as unknown as SessionData & {
      destroy: (cb?: (err?: Error) => void) => void;
      sessionId: string;
    };

    if (!session?.userId) {
      return reply.code(401).send({
        error: {
          category: "session_expired",
          message: "No active session.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const userId = session.userId;
    const confirmed = request.query.confirmed === "true";

    // Check for active session participation
    if (!confirmed) {
      const activeResult = await db.query(
        `SELECT s.id FROM sessions s
         JOIN session_participants sp ON s.id = sp.session_id
         WHERE sp.user_id = $1 AND s.status = 'active'`,
        [userId],
      );

      if (activeResult.rows.length > 0) {
        return reply.send({
          confirmRequired: true,
          activeSessions: activeResult.rows.map(
            (r: { id: string }) => r.id,
          ),
        });
      }
    }

    // Get ID token for IdP logout before destroying session
    let idToken: string | undefined;
    try {
      const tokens = getDecryptedTokens(session);
      idToken = tokens.idToken;
    } catch {
      // If we can't decrypt, proceed without IdP logout
    }

    const sessionId = request.session.sessionId;

    // Destroy session
    await new Promise<void>((resolve) => {
      request.session.destroy(() => resolve());
    });

    emitAuditEvent(request.log, "auth.session_invalidated", {
      userId,
      sessionId,
      reason: "explicit_logout",
    });

    // Attempt IdP logout
    if (idToken) {
      const appOrigin =
        config.APP_ORIGIN ??
        (config.NODE_ENV === "production"
          ? ""
          : "http://localhost:5173");
      const endSessionUrl = await getEndSessionUrl(idToken, appOrigin);

      if (endSessionUrl) {
        return reply.send({ redirectUrl: endSessionUrl.toString() });
      } else {
        request.log.warn(
          "IdP does not support end_session_endpoint; user's IdP session remains active",
        );
      }
    }

    return reply.send({ redirectUrl: "/" });
  });

  // GET /auth/session
  app.get("/session", async (request, reply) => {
    const session = request.session as unknown as SessionData;

    if (!session?.userId) {
      return reply.code(401).send({
        error: {
          category: "session_expired",
          message: "Please sign in to continue.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Fetch user data and team memberships
    const userResult = await db.query(
      `SELECT id, display_name, email FROM users WHERE id = $1`,
      [session.userId],
    );

    if (userResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "session_expired",
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const user = userResult.rows[0] as {
      id: string;
      display_name: string;
      email: string;
    };

    const membershipsResult = await db.query(
      `SELECT tm.team_id, t.name AS team_name, tm.role
       FROM team_memberships tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = $1 AND tm.removed_at IS NULL`,
      [session.userId],
    );

    const absoluteLifetimeMs = 90 * 60 * 1000;
    const sessionCreatedMs = new Date(session.sessionCreatedAt).getTime();
    const expiresAt = new Date(
      sessionCreatedMs + absoluteLifetimeMs,
    ).toISOString();

    const authSession: AuthSession = {
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
      },
      teamMemberships: (
        membershipsResult.rows as Array<{
          team_id: string;
          team_name: string;
          role: string;
        }>
      ).map((row) => ({
        teamId: row.team_id,
        teamName: row.team_name,
        role: row.role as "participant" | "engineering_manager",
      })),
      sessionCreatedAt: session.sessionCreatedAt,
      expiresAt,
    };

    return reply.send(authSession);
  });
}

// Helper for executing join flow during callback
async function executeJoinFlow(
  userId: string,
  token: string,
  logger: FastifyBaseLogger,
): Promise<{ redirectUrl: string | null }> {
  // Validate join link
  const linkResult = await db.query(
    `SELECT id, team_id, expires_at, revoked_at FROM join_links WHERE token = $1`,
    [token],
  );

  if (linkResult.rows.length === 0) {
    emitAuditEvent(logger, "join.link_rejected", {
      sourceIp: "callback",
      linkId: null,
      reason: "not_found",
    });
    return { redirectUrl: null };
  }

  const link = linkResult.rows[0] as {
    id: string;
    team_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  };

  if (link.revoked_at || new Date(link.expires_at) < new Date()) {
    emitAuditEvent(logger, "join.link_rejected", {
      sourceIp: "callback",
      linkId: link.id,
      reason: link.revoked_at ? "revoked" : "expired",
    });
    return { redirectUrl: null };
  }

  // Add user to team (idempotent)
  await db.query(
    `INSERT INTO team_memberships (user_id, team_id, role)
     VALUES ($1, $2, 'participant')
     ON CONFLICT (user_id, team_id) DO NOTHING`,
    [userId, link.team_id],
  );

  emitAuditEvent(logger, "join.link_redeemed", {
    userId,
    teamId: link.team_id,
    linkId: link.id,
  });

  // Check for active session
  const sessionResult = await db.query(
    `SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1`,
    [link.team_id],
  );

  if (sessionResult.rows.length > 0) {
    const activeSession = sessionResult.rows[0] as { id: string };
    return { redirectUrl: `/session/${activeSession.id}` };
  }

  return { redirectUrl: `/team/${link.team_id}` };
}
