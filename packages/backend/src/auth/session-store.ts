import { RedisStore } from "connect-redis";
import type { Redis } from "ioredis";
import { encryptToken, decryptToken } from "./token-encryption.js";

const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours

export function createRedisStore(redisClient: Redis): RedisStore {
  return new RedisStore({
    client: redisClient,
    prefix: "dipstick:session:",
    ttl: SESSION_TTL_SECONDS,
  });
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
