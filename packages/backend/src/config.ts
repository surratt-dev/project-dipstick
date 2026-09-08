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
] as const;

type ConfigKey = (typeof required)[number];
type OptionalConfigKey = (typeof optional)[number];
type FullConfig = Record<ConfigKey, string> & Partial<Record<OptionalConfigKey, string>>;

function isPrivateAddress(issuer: string): boolean {
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

function loadConfig(): FullConfig {
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const cfg = Object.fromEntries(
    required.map((key) => [key, process.env[key] as string])
  ) as Record<ConfigKey, string>;

  // Add optional config
  const fullConfig: FullConfig = { ...cfg };
  for (const key of optional) {
    if (process.env[key]) {
      fullConfig[key] = process.env[key];
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

  return fullConfig;
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
