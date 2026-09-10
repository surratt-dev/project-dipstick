import type { SessionStore } from "@fastify/session";
import type { Redis } from "ioredis";
import { redis } from "../redis.js";
import { encryptToken, decryptToken } from "./token-encryption.js";

const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const PREFIX = "dipstick:session:";

export function createRedisStore(redisClient: Redis): SessionStore {
  return {
    set(sessionId, session, callback) {
      redisClient
        .setex(PREFIX + sessionId, SESSION_TTL_SECONDS, JSON.stringify(session))
        .then(() => callback())
        .catch(callback);
    },
    get(sessionId, callback) {
      redisClient
        .get(PREFIX + sessionId)
        .then((data) => callback(null, data ? JSON.parse(data) : null))
        .catch((err) => callback(err, null));
    },
    destroy(sessionId, callback) {
      redisClient
        .del(PREFIX + sessionId)
        .then(() => callback())
        .catch(callback);
    },
  };
}

// ---------------------------------------------------------------------------
// conditionallyUpdateSession — websocket-connection-reauthorization (SEC-26),
// design.md Decision D3a.
//
// The generic set() above stays unconditional and untouched — the HTTP login
// path depends on set() succeeding even when the key does not yet exist
// (request.session.regenerate() always writes to a brand-new key). This
// function is used ONLY by the WS-side silent-refresh write-back
// (connection-token-refresh.ts): a single atomic `SET key value EX ttl XX`,
// which writes only if the key already exists.
//
// Closes a session-resurrection race: an unconditional write from a stale,
// in-flight WS-side refresh could recreate a session key an HTTP-side
// destroy() (DEL) had already removed moments earlier, silently undoing a
// revocation. SET ... XX is atomic — there is no window between "the key
// still exists" and "write" for a concurrent DEL to land in. A destroy()
// that runs first always wins, regardless of interleaving.
//
// Returns false, performing no write, when the key does not exist (the
// session was destroyed elsewhere between the caller's read and this
// write). Callers MUST treat a false return as equivalent to a revoked
// session — never retry, and never fall back to the unconditional set()
// above; doing so would reproduce the exact resurrection race this function
// exists to prevent.
// ---------------------------------------------------------------------------
export async function conditionallyUpdateSession(
  sessionId: string,
  session: SessionData,
): Promise<boolean> {
  const result = await redis.set(
    PREFIX + sessionId,
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SECONDS,
    "XX",
  );
  return result === "OK";
}

// ---------------------------------------------------------------------------
// getSessionDataById — websocket-connection-reauthorization (SEC-26),
// design.md Decision D3.
//
// Lets the WS-side silent-refresh monitor (connection-token-refresh.ts)
// re-fetch current SessionData by Fastify session id, independent of any
// live HTTP request object — the monitor runs from a per-connection timer,
// not a request handler. Reads via the same shared `redis` client and PREFIX
// createRedisStore's get() uses, so there is exactly one place that knows
// how a session id maps to its Redis key and how the stored value is
// serialized.
// ---------------------------------------------------------------------------
export async function getSessionDataById(sessionId: string): Promise<SessionData | null> {
  const data = await redis.get(PREFIX + sessionId);
  return data ? (JSON.parse(data) as SessionData) : null;
}

export interface SessionTokenData {
  accessToken: string;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  expiresAt: number; // Unix timestamp in seconds
}

export interface SessionData {
  userId: string;
  sessionCreatedAt: string; // ISO 8601
  encryptedAccessToken: string;
  encryptedRefreshToken?: string | undefined;
  encryptedIdToken?: string | undefined;
  tokenExpiresAt: number; // Unix timestamp in seconds
}

export function buildSessionData(
  userId: string,
  tokens: SessionTokenData,
): SessionData {
  const data: SessionData = {
    userId,
    sessionCreatedAt: new Date().toISOString(),
    encryptedAccessToken: encryptToken(tokens.accessToken),
    tokenExpiresAt: tokens.expiresAt,
  };

  if (tokens.refreshToken) {
    data.encryptedRefreshToken = encryptToken(tokens.refreshToken);
  }

  if (tokens.idToken) {
    data.encryptedIdToken = encryptToken(tokens.idToken);
  }

  return data;
}

export function getDecryptedTokens(session: SessionData): SessionTokenData {
  return {
    accessToken: decryptToken(session.encryptedAccessToken),
    refreshToken: session.encryptedRefreshToken
      ? decryptToken(session.encryptedRefreshToken)
      : undefined,
    idToken: session.encryptedIdToken
      ? decryptToken(session.encryptedIdToken)
      : undefined,
    expiresAt: session.tokenExpiresAt,
  };
}
