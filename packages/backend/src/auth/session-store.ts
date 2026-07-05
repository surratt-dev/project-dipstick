import type { SessionStore } from "@fastify/session";
import type { Redis } from "ioredis";
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
