import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { randomBytes } from "node:crypto";
import * as oidcClient from "openid-client";
import { redis } from "../redis.js";
import { config, isPrivateAddress, getAppOrigin } from "../config.js";
import { db } from "../db.js";
import {
  getAuthorizationUrl,
  handleCallback,
  getEndSessionUrl,
} from "../auth/oidc-client.js";
import { resolveOrCreateAccount } from "../auth/account-resolver.js";
import type { ResolvedUser } from "../auth/account-resolver.js";
import { buildSessionData, getDecryptedTokens } from "../auth/session-store.js";
import type { SessionData } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { mapAuthError } from "../auth/error-handler.js";
import { MissingClaimError } from "../auth/errors.js";
import { sanitizeOidcError } from "../auth/oidc-error-sanitizer.js";
import { writeSessionInvalidatedAuditRow } from "../auth/session-invalidation-audit.js";
import { writeFailOpenAuditRow } from "../auth/fail-open-audit-write.js";
import { withAuditTransaction } from "../auth/audit-write-transaction.js";
import { resolveActorGlobalRole } from "../realtime/connection-reauthorization.js";
import type { AuthSession, DevLoginOption, DevLoginOptionsResponse } from "@dipstick/shared";

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_PREFIX = "dipstick:auth:state:";

// Persona login (local-dev-only sign-in shortcut, see
// openspec/changes/persona-login/design.md). This is the closed set of
// account ids the simulated OIDC provider seeds (docker/oidc/server.js) —
// the same set /auth/login validates loginHint against (D12) and the same
// set the local stub's interaction handler (D10) looks up against.
const SEEDED_ACCOUNT_IDS = [
  "participant-001",
  "facilitator-001",
  "manager-001",
  "admin-001",
] as const;

// `seeded` is the single source of truth for whether an account carries a
// real application role (D5) — the frontend renders the unseeded-role
// caveat whenever seeded is false, rather than hardcoding this list itself.
const DEV_LOGIN_OPTIONS: DevLoginOption[] = [
  { accountId: "participant-001", roleLabel: "Participant", seeded: true },
  { accountId: "facilitator-001", roleLabel: "Facilitator", seeded: false },
  { accountId: "manager-001", roleLabel: "Engineering Manager", seeded: true },
  { accountId: "admin-001", roleLabel: "Application Admin", seeded: true },
];

function isSeededAccountId(value: string): value is (typeof SEEDED_ACCOUNT_IDS)[number] {
  return (SEEDED_ACCOUNT_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// reauth-return-to: design.md Decision 3. `returnTo` carries the page the
// user was on back through the OIDC state round-trip, the same pattern
// join-link already established for `pendingJoinToken` (below). The value
// is an internal path only — never a full URL — validated against an
// explicit allow-list of known internal route shapes before it is ever
// stored or redirected to.
//
// `:id` is pinned to this application's UUID format (the standard 8-4-4-4-12
// hex-and-hyphen shape every sessions.id/teams.id column already uses via
// gen_random_uuid()), not a loose "anything up to the next /, ?, or
// end-of-string" class (per Tomás Ferreira's design review). A trailing
// `?`-prefixed query string is tolerated — the client captures
// `pathname + search`, so dropping a returnTo value just because it happens
// to carry a query string would needlessly discard a valid destination.
// ---------------------------------------------------------------------------
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const RETURN_TO_ALLOW_LIST: RegExp[] = [
  new RegExp(`^/session/${UUID_PATTERN}(?:\\?.*)?$`),
  new RegExp(`^/team/${UUID_PATTERN}(?:\\?.*)?$`),
  new RegExp(`^/team/${UUID_PATTERN}/session/${UUID_PATTERN}(?:\\?.*)?$`),
  // http-session-expiry-reauth-parity design.md Decision 3: the first
  // literal, non-UUID-anchored shape in this list — deliberate and narrow
  // (a fixed string, not a wildcard), not license to add other loose
  // literal paths without the same scrutiny.
  new RegExp(`^/sessions/new(?:\\?.*)?$`),
];

/**
 * Character-rejection checks, run BEFORE the allow-list pattern match, on
 * the raw decoded value (design.md Decision 3's intended runtime order).
 * A scheme/authority component, a protocol-relative prefix, a raw CR or LF
 * (header-injection into the eventual `Location` response header), or a
 * backslash (normalized to `/` by some URL-parsing contexts) is rejected
 * outright, independent of whether the rest of the value would otherwise
 * match an allow-listed shape (CRLF/backslash checks per Tomás Ferreira's
 * design review).
 */
function rejectReturnToCharacters(value: string): string | null {
  if (/[\r\n]/.test(value)) return "contains a raw CR or LF character";
  if (value.includes("\\")) return "contains a backslash";
  if (value.includes("://")) return "contains a scheme/authority component (://)";
  if (value.startsWith("//")) return "protocol-relative (leading //)";
  return null;
}

/**
 * Validates a supplied `returnTo` value. On rejection (either the character
 * checks above or no allow-list match), returns null and emits a
 * debug-level structured log noting the value and rejection reason — a
 * discard-trace log, not an audit-tier event (per Tomás Ferreira's design
 * review) — so repeated allow-list probing is visible to anyone who goes
 * looking, without surfacing an error to the caller.
 */
export function validateReturnTo(value: string, log: FastifyBaseLogger): string | null {
  const rejectionReason = rejectReturnToCharacters(value);
  if (rejectionReason) {
    log.debug({ returnTo: value, reason: rejectionReason }, "returnTo rejected: disallowed characters");
    return null;
  }
  if (!RETURN_TO_ALLOW_LIST.some((pattern) => pattern.test(value))) {
    log.debug(
      { returnTo: value, reason: "does not match an allow-listed path shape" },
      "returnTo rejected: no allow-list match",
    );
    return null;
  }
  return value;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /auth/dev-login-options
  //
  // Double-gated, independently-evaluated (design.md D2): NODE_ENV !==
  // "production" AND isPrivateAddress(OIDC_ISSUER). On any gate failure,
  // return 404 with no body and perform no Redis or database access — this
  // must stay the very first thing the handler does.
  app.get("/dev-login-options", async (_request, reply) => {
    if (config.NODE_ENV === "production" || !isPrivateAddress(config.OIDC_ISSUER)) {
      return reply.code(404).send();
    }

    const response: DevLoginOptionsResponse = { options: DEV_LOGIN_OPTIONS };
    return reply.send(response);
  });

  // GET /auth/login
  app.get<{
    Querystring: { joinToken?: string; loginHint?: string; returnTo?: string };
  }>("/login", async (request, reply) => {
    const loginHint = request.query.loginHint;

    // D12: validate loginHint against the closed set of seeded account ids
    // before it is ever forwarded as the OIDC login_hint parameter.
    if (loginHint !== undefined && !isSeededAccountId(loginHint)) {
      return reply.code(400).send({
        error: {
          category: "invalid_request" as const,
          message: `Invalid loginHint value: '${loginHint}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

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

    const returnTo = request.query.returnTo;
    if (returnTo !== undefined) {
      const validatedReturnTo = validateReturnTo(returnTo, request.log);
      if (validatedReturnTo !== null) {
        stateData["returnTo"] = validatedReturnTo;
      }
    }

    await redis.setex(
      `${STATE_PREFIX}${state}`,
      STATE_TTL_SECONDS,
      JSON.stringify(stateData),
    );

    emitAuditEvent(request.log, "auth.authorization_initiated", {
      sourceIp: request.ip,
      hasJoinContext: Boolean(joinToken),
      hasLoginHint: Boolean(loginHint),
      stateNonce: state.substring(0, 8) + "...",
    });

    const { url } = await getAuthorizationUrl(state, nonce, codeVerifier, loginHint);
    return reply.redirect(url.toString());
  });

  // GET /auth/callback
  app.get("/callback", async (request, reply) => {
    const correlationId = crypto.randomUUID();
    // This handler always runs on the backend's own origin (OIDC_REDIRECT_URI
    // points directly at it, bypassing the frontend dev server in local dev),
    // so every redirect below must be absolute against the frontend's origin
    // -- a relative target would resolve against this backend instead and
    // 404/401 there rather than reaching the SPA.
    const appOrigin = getAppOrigin();

    try {
      // Use request.host (not request.hostname) since hostname drops the port, which breaks redirect_uri matching against the value registered at authorization.
      const callbackUrl = new URL(
        `${request.protocol}://${request.host}${request.url}`,
      );
      const stateParam = callbackUrl.searchParams.get("state");

      if (!stateParam) {
        emitAuditEvent(request.log, "auth.failure", {
          sourceIp: request.ip,
          failureCategory: "invalid_request",
          correlationId,
        });
        return reply.redirect(
          `${appOrigin}/auth/error?category=invalid_request&message=${encodeURIComponent("The sign-in request could not be verified. Please try signing in again from the beginning.")}&correlationId=${correlationId}`,
        );
      }

      // Retrieve and delete state from Redis atomically (single-use).
      // redis.getdel performs both operations in a single atomic command,
      // eliminating the non-atomic window between a separate redis.get and
      // redis.del where a concurrent second callback for the same OIDC state
      // key could read the token before the first request deletes it.
      const stateKey = `${STATE_PREFIX}${stateParam}`;
      const stateDataRaw = await redis.getdel(stateKey);

      if (!stateDataRaw) {
        emitAuditEvent(request.log, "auth.failure", {
          sourceIp: request.ip,
          failureCategory: "invalid_request",
          correlationId,
        });
        return reply.redirect(
          `${appOrigin}/auth/error?category=invalid_request&message=${encodeURIComponent("The sign-in request has expired or is invalid. Please try signing in again.")}&correlationId=${correlationId}`,
        );
      }

      const stateData = JSON.parse(stateDataRaw) as {
        nonce: string;
        codeVerifier: string;
        pendingJoinToken?: string;
        returnTo?: string;
        createdAt: string;
      };

      emitAuditEvent(request.log, "auth.callback_received", {
        sourceIp: request.ip,
        stateNonce: stateParam.substring(0, 8) + "...",
        success: true,
        correlationId,
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
        throw new MissingClaimError("id_token");
      }
      if (!claims.sub) {
        throw new MissingClaimError("sub");
      }
      if (!claims.iss) {
        throw new MissingClaimError("iss");
      }

      // Resolve or create user account.
      // Pass the full claims object so resolveOrCreateAccount can read the
      // configured role claim (OIDC_ROLE_CLAIM) for global_role mapping.
      // Pass the logger so it can emit warnings on rejected claim values
      // (rejected claim values must not appear in audit records).
      //
      // auth-events-audit-log-coverage, design.md Decision D2/D3/D7: this
      // resolution and its accompanying auth.first_access_created /
      // auth.role_claim_mapped audit_log row (when the firing condition is
      // met) run in one Postgres transaction via withAuditTransaction. A
      // failed audit INSERT or a failed db.connect() rolls back the UPSERT
      // too and rethrows as AuditWriteError, which the catch block below
      // classifies as internal_error (Decision D7) rather than
      // authentication_failed's default text.
      const resolvedClaims = {
        sub: claims.sub,
        iss: claims.iss,
        name: claims.name as string | undefined,
        email: claims.email as string | undefined,
        ...Object.fromEntries(
          Object.entries(claims).filter(
            ([k]) => !["sub", "iss", "name", "email"].includes(k),
          ),
        ),
      };

      const user: ResolvedUser = await withAuditTransaction(
        (client) => resolveOrCreateAccount(resolvedClaims, request.log, client),
        async (client, resolvedUser) => {
          if (resolvedUser.isNewUser) {
            await client.query(
              `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
               VALUES ($1, $2, $3, 'auth.first_access_created', NULL, $4)`,
              [
                resolvedUser.id,
                resolvedUser.globalRole,
                request.ip,
                JSON.stringify({
                  oidcSubject: resolvedUser.oidcSubject,
                  oidcIssuer: resolvedUser.oidcIssuer,
                  globalRole: resolvedUser.globalRole,
                  correlationId,
                }),
              ],
            );
          } else if (resolvedUser.globalRole !== "engineer") {
            await client.query(
              `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
               VALUES ($1, $2, $3, 'auth.role_claim_mapped', NULL, $4)`,
              [
                resolvedUser.id,
                resolvedUser.globalRole,
                request.ip,
                JSON.stringify({
                  oidcSubject: resolvedUser.oidcSubject,
                  globalRole: resolvedUser.globalRole,
                  previousRole: resolvedUser.previousGlobalRole,
                  correlationId,
                }),
              ],
            );
          }
          // else: neither firing condition is met — no audit_log row, matching
          // the existing structured-log gating exactly.
        },
      );

      // Task 7 / Engineer review Finding 3: these structured-log emissions
      // must fire only after withAuditTransaction above has already committed
      // successfully — not at their former source position immediately after
      // resolveOrCreateAccount returned. Moving them here (post-commit) is
      // deliberate: leaving them at the old position would let a rolled-back
      // transaction still produce a structured log claiming the event
      // happened, for a write that was just undone.
      if (user.isNewUser) {
        emitAuditEvent(request.log, "auth.first_access_created", {
          userId: user.id,
          oidcSubject: user.oidcSubject,
          oidcIssuer: user.oidcIssuer,
          globalRole: user.globalRole,
          sourceIp: request.ip,
          correlationId,
        });
      } else if (user.globalRole !== "engineer") {
        // Emit role_claim_mapped for returning users who have a non-default
        // global_role from the IdP claim (Decision 2). This covers both the
        // case where the role was already set and the case where it changed.
        // We emit on every sign-in when the role is non-default so that the
        // audit trail captures the ongoing claim-to-role mapping for EMs and
        // admins — not only the first time the claim is applied.
        emitAuditEvent(request.log, "auth.role_claim_mapped", {
          userId: user.id,
          oidcSubject: user.oidcSubject,
          globalRole: user.globalRole,
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
        sourceIp: request.ip,
        correlationId,
      });

      // auth-events-audit-log-coverage, design.md Decision D2 (fail-open
      // group): no Postgres write occurs anywhere else in this call path, so
      // this uses the bounded-timeout fail-open write path rather than a
      // transaction. actorGlobalRole comes directly from user.globalRole —
      // already resolved above — skipping a resolveActorGlobalRole SELECT
      // entirely for this event.
      await writeFailOpenAuditRow({
        operation: "auth.session_created",
        userId: user.id,
        actorGlobalRole: user.globalRole,
        actorIp: request.ip,
        teamId: null,
        metadata: { authSessionId: request.session.sessionId, correlationId },
        log: request.log,
        failureAuditFields: {
          userId: user.id,
          authSessionId: request.session.sessionId,
          operation: "auth.session_created",
        },
      });

      emitAuditEvent(request.log, "auth.success", {
        userId: user.id,
        oidcSubject: user.oidcSubject,
        oidcIssuer: user.oidcIssuer,
        isFirstAccess: user.isNewUser,
        sourceIp: request.ip,
        correlationId,
      });

      await writeFailOpenAuditRow({
        operation: "auth.success",
        userId: user.id,
        actorGlobalRole: user.globalRole,
        actorIp: request.ip,
        teamId: null,
        metadata: {
          oidcSubject: user.oidcSubject,
          oidcIssuer: user.oidcIssuer,
          isFirstAccess: user.isNewUser,
          correlationId,
        },
        log: request.log,
        failureAuditFields: { userId: user.id, operation: "auth.success" },
      });

      // Handle pending join token.
      // executeJoinFlow always returns a non-null redirectUrl — it owns both
      // success redirect URLs (/team/:teamId, /session/:sessionId) and failure
      // redirect URLs (/join-error?joinError=...). The callback handler
      // redirects unconditionally; the user is never routed to /no-team when a
      // pendingJoinToken was present.
      //
      // reauth-return-to (design.md Decision 3): a stored `returnTo` value is
      // only consulted when no pendingJoinToken redirect took precedence — a
      // join-link flow is definitionally a different, higher-priority path
      // (a user who wasn't a team member yet), so the two never meaningfully
      // overlap, but the precedence is stated explicitly here regardless.
      let redirectUrl: string | null = null;
      if (stateData.pendingJoinToken) {
        const joinResult = await executeJoinFlow(
          user.id,
          stateData.pendingJoinToken,
          request.log,
          request.ip,
          user.globalRole,
        );
        redirectUrl = joinResult.redirectUrl;
      } else if (stateData.returnTo) {
        redirectUrl = stateData.returnTo;
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
      return reply.redirect(`${appOrigin}${redirectUrl}`);
    } catch (err: unknown) {
      const authError = mapAuthError(err);

      request.log.error({
        err: sanitizeOidcError(err, request.log),
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
        `${appOrigin}/auth/error?category=${authError.category}&message=${encodeURIComponent(authError.message)}&correlationId=${correlationId}`,
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

    await writeSessionInvalidatedAuditRow(userId, sessionId, "explicit_logout", request);
    emitAuditEvent(request.log, "auth.session_invalidated", {
      userId,
      sessionId,
      reason: "explicit_logout",
      sourceIp: request.ip,
    });

    // Attempt IdP logout
    if (idToken) {
      try {
        const endSessionUrl = await getEndSessionUrl(idToken, getAppOrigin());

        if (endSessionUrl) {
          return reply.send({ redirectUrl: endSessionUrl.toString() });
        } else {
          request.log.warn(
            "IdP does not support end_session_endpoint; user's IdP session remains active",
          );
        }
      } catch (err: unknown) {
        request.log.error({
          err: sanitizeOidcError(err, request.log),
          userId,
          sessionId,
          event: "auth.idp_logout_error",
        });
        emitAuditEvent(request.log, "auth.idp_logout_failed", {
          userId,
          sessionId,
          // Decision D6: sourceIp, already in scope, matching the sibling
          // auth.session_invalidated emission a few lines above.
          sourceIp: request.ip,
        });

        // auth-events-audit-log-coverage, design.md Decision D2 (fail-open
        // group): the local session carries no globalRole field (unlike
        // auth.success/session_created, which already have it in scope), so
        // this resolves it via the shared resolveActorGlobalRole lookup,
        // matching auth.session_invalidated's existing need in this same
        // handler.
        const actorGlobalRole = await resolveActorGlobalRole(userId);
        await writeFailOpenAuditRow({
          operation: "auth.idp_logout_failed",
          userId,
          actorGlobalRole,
          actorIp: request.ip,
          teamId: null,
          metadata: { authSessionId: sessionId },
          log: request.log,
          failureAuditFields: { userId, authSessionId: sessionId, operation: "auth.idp_logout_failed" },
        });

        return reply.send({ redirectUrl: "/" });
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
      `SELECT id, display_name, email, global_role FROM users WHERE id = $1`,
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
      global_role: string;
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
      // session-creation-existing-team design.md Decision D4: computed live
      // from users.global_role on every call, never cached in the Redis
      // session blob (session.* here is the Redis-backed SessionData, which
      // deliberately never carries global_role).
      canFacilitateSessions: user.global_role === "facilitator",
    };

    return reply.send(authSession);
  });
}

// Helper for executing join flow during callback.
//
// The sourceIp parameter must be the real requester IP from request.ip at the
// call site. It is a required parameter (not optional) so omitting it at a
// future call site is a type error — callers cannot silently drop it and
// produce audit events without a real IP.
//
// actorGlobalRole (auth-events-audit-log-coverage, design.md Decision D5):
// required, threaded from the caller's already-resolved user.globalRole
// (GET /auth/callback, resolved moments earlier for auth.success's
// emission) — a parameter pass, not a lookup. executeJoinFlow itself does
// not know the joining user's global_role otherwise.
//
// Return type is Promise<{ redirectUrl: string }> (never null). The function
// owns all redirect URL construction — both success destinations and failure
// destinations — so the callback handler can redirect unconditionally to
// joinResult.redirectUrl without inspecting an error discriminant.
async function executeJoinFlow(
  userId: string,
  token: string,
  logger: FastifyBaseLogger,
  sourceIp: string,
  actorGlobalRole: string,
): Promise<{ redirectUrl: string }> {
  // Validate join link
  const linkResult = await db.query(
    `SELECT id, team_id, expires_at, revoked_at FROM join_links WHERE token = $1`,
    [token],
  );

  if (linkResult.rows.length === 0) {
    emitAuditEvent(logger, "join.link_rejected", {
      userId,
      sourceIp,
      linkId: null,
      reason: "not_found",
    });
    return { redirectUrl: "/join-error?joinError=invalid" };
  }

  const link = linkResult.rows[0] as {
    id: string;
    team_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  };

  if (link.revoked_at || new Date(link.expires_at) < new Date()) {
    emitAuditEvent(logger, "join.link_rejected", {
      userId,
      sourceIp,
      linkId: link.id,
      reason: link.revoked_at ? "revoked" : "expired",
    });
    return { redirectUrl: "/join-error?joinError=expired" };
  }

  // Add user to team (idempotent), and — when a new row is actually
  // inserted — the join.link_redeemed audit_log row, in the same
  // transaction (auth-events-audit-log-coverage, design.md Decision D2/D5).
  //
  // "participant" is the membership_role enum value corresponding to what the
  // use case calls "Engineer." The membership_role enum is distinct from the
  // global user_role enum on the users table. Do NOT change this value to
  // 'engineer' — that value does not exist in membership_role and would cause
  // a database constraint error.
  //
  // RETURNING id lets us distinguish a new insertion (rows.length > 0) from a
  // conflict-suppressed no-op (rows.length === 0, user was already a member).
  // The distinction drives the outcome signal appended to the redirect URL and
  // gates the join.link_redeemed audit event.
  const insertResult = await withAuditTransaction(
    (client) =>
      client.query(
        `INSERT INTO team_memberships (user_id, team_id, role)
         VALUES ($1, $2, 'participant')
         ON CONFLICT (user_id, team_id) DO NOTHING
         RETURNING id`,
        [userId, link.team_id],
      ),
    async (client, membershipResult) => {
      if (membershipResult.rows.length === 0) {
        // Idempotent re-join — ON CONFLICT suppressed the insert. No audit
        // row, matching the existing structured-log gating exactly.
        return;
      }
      await client.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, 'join.link_redeemed', $4, $5)`,
        [userId, actorGlobalRole, sourceIp, link.team_id, JSON.stringify({ linkId: link.id })],
      );
    },
  );

  // Engineer review Finding 3: this structured-log emission fires only after
  // withAuditTransaction above has already committed successfully, and only
  // when a new row was actually inserted — not at the former source position
  // immediately after the INSERT resolved.
  if (insertResult.rows.length > 0) {
    emitAuditEvent(logger, "join.link_redeemed", {
      userId,
      teamId: link.team_id,
      linkId: link.id,
      sourceIp,
    });
  }

  // Check for active session
  const sessionResult = await db.query(
    `SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1`,
    [link.team_id],
  );

  // Append outcome signal so the frontend can surface the correct notification.
  // ?newMember=true  — first-time join (new row inserted)
  // ?alreadyMember=true — idempotent re-join (conflict suppressed, no new row)
  const outcomeSuffix =
    insertResult.rows.length > 0 ? "?newMember=true" : "?alreadyMember=true";

  if (sessionResult.rows.length > 0) {
    const activeSession = sessionResult.rows[0] as { id: string };
    return { redirectUrl: `/session/${activeSession.id}${outcomeSuffix}` };
  }

  return { redirectUrl: `/team/${link.team_id}${outcomeSuffix}` };
}
