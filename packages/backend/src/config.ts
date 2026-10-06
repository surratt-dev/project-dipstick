import { parseRoleMap, RoleMapConfigError, type MappableRole, type ParsedRoleMap } from "./auth/role-map.js";

const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "NODE_ENV",
] as const;

const optional = [
  "TOKEN_ENCRYPTION_KEY",
  "APP_ORIGIN",
  "OIDC_ROLE_CLAIM",
  "APPLICATION_ADMIN_CONTACT_EMAIL",
] as const;

type ConfigKey = (typeof required)[number];
type OptionalConfigKey = (typeof optional)[number];
type FullConfig = Record<ConfigKey, string> & Partial<Record<OptionalConfigKey, string>>;

// configurable-oidc-role-map (#243), design D1a. The parsed map is carried on
// the config; the raw OIDC_ROLE_MAP string never is, so logging `config`
// cannot print the map (R5).
export type AppConfig = FullConfig & {
  roleMap: ReadonlyMap<string, MappableRole>;
  roleMapSource: "configured" | "default";
};

// Exported for reuse by the persona-login dev gate (routes/auth.ts,
// GET /auth/dev-login-options) in addition to the production-boot guard
// below. Known scope: IPv4 literals in the three RFC 1918 ranges plus the
// literal strings localhost/127.0.0.1/0.0.0.0 only — no IPv6 (::1,
// fc00::/7, fe80::/10 all fall through to false), no DNS resolution of a
// hostname that resolves to a private address, no decimal/octal/hex-
// obfuscated IPv4 literal handling. Fails closed (returns false) for
// anything outside that coverage, which is the safe direction for both
// call sites (see design.md D2, persona-login).
export function isPrivateAddress(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    const hostname = url.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    ) {
      return true;
    }
    // RFC 1918 private addresses
    const parts = hostname.split(".");
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const first = parseInt(parts[0]!, 10);
      const second = parseInt(parts[1]!, 10);
      if (first === 10) return true;
      if (first === 172 && second >= 16 && second <= 31) return true;
      if (first === 192 && second === 168) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Exported with an injectable env so tests can call it directly (R6). The
// module-level `config` below is still computed exactly once per process, so
// a change to OIDC_ROLE_MAP takes effect only after a restart.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing: string[] = [];

  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const cfg = Object.fromEntries(
    required.map((key) => [key, env[key] as string])
  ) as Record<ConfigKey, string>;

  // Add optional config
  const fullConfig: FullConfig = { ...cfg };
  for (const key of optional) {
    if (env[key]) {
      fullConfig[key] = env[key];
    }
  }

  // Production guards
  if (fullConfig.NODE_ENV === "production" && !fullConfig.APP_ORIGIN) {
    console.error("FATAL: APP_ORIGIN is required in production mode for CORS configuration.");
    process.exit(1);
  }

  if (fullConfig.NODE_ENV === "production" && fullConfig.SESSION_SECRET.length < 32) {
    console.error("FATAL: SESSION_SECRET must be at least 32 characters in production mode.");
    process.exit(1);
  }

  if (fullConfig.NODE_ENV === "production" && isPrivateAddress(fullConfig.OIDC_ISSUER)) {
    console.error(
      "FATAL: OIDC_ISSUER points to a local/private address in production mode. The simulated OIDC provider must not be used in production.",
    );
    process.exit(1);
  }

  // OIDC_ROLE_MAP (configurable-oidc-role-map, D1a). Deliberately NOT in the
  // `optional` list: it is read directly so the raw JSON never lands on
  // `config`, and so empty/whitespace-only counts as unset and the issuer
  // gate applies (D6). Runs after the production guards above. Output is
  // plain console text with a fixed `OIDC_ROLE_MAP:` prefix (pino does not
  // exist yet at this point).
  let roleMapResult: ParsedRoleMap;
  try {
    roleMapResult = parseRoleMap(env["OIDC_ROLE_MAP"], {
      nodeEnv: fullConfig.NODE_ENV,
      issuerIsPrivate: isPrivateAddress(fullConfig.OIDC_ISSUER),
    });
  } catch (err) {
    if (err instanceof RoleMapConfigError) {
      console.error("FATAL: " + err.message);
      process.exit(1);
    }
    throw err;
  }
  for (const warning of roleMapResult.warnings) console.warn(warning);
  console.info(roleMapResult.summary);

  return { ...fullConfig, roleMap: roleMapResult.map, roleMapSource: roleMapResult.source };
}

export const config = loadConfig();
export const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

// ---------------------------------------------------------------------------
// getAllowedOrigins — single source of truth for the CORS/WebSocket-Origin
// allowlist.
//
// websocket-delivery-time-authorization: design.md Decision D9 (CSWSH
// mitigation). The WebSocket upgrade handshake is not subject to CORS
// preflight, so app.ts's @fastify/cors registration alone does not protect
// it. Decision D9 requires an explicit Origin header check on the WS route
// against "the same allowlist @fastify/cors already uses" — extracted here
// so both call sites (the CORS plugin registration and the WS Origin check)
// read from one place instead of two copies drifting apart.
// ---------------------------------------------------------------------------
export function getAllowedOrigins(): string[] {
  if (config.NODE_ENV === "production") {
    return [config.APP_ORIGIN ?? ""];
  }
  return ["http://localhost:5173", "http://localhost:3000"];
}

// ---------------------------------------------------------------------------
// getAppOrigin — the frontend's origin, for building absolute redirect URLs
// out of routes/auth.ts's /callback handler.
//
// That handler always runs on the backend's own origin (OIDC_REDIRECT_URI
// points directly at the backend, bypassing the frontend dev server), so a
// *relative* reply.redirect() target resolves against the backend, not the
// frontend -- landing the browser on the bare API instead of the SPA. In
// local dev the frontend is a separate origin (the Vite dev server on 5173)
// with no APP_ORIGIN configured, hence the localhost:5173 fallback below;
// in production APP_ORIGIN is mandatory (enforced in loadConfig) and is the
// one true origin both frontend and backend share behind the proxy.
// ---------------------------------------------------------------------------
export function getAppOrigin(): string {
  return config.APP_ORIGIN ?? (config.NODE_ENV === "production" ? "" : "http://localhost:5173");
}
