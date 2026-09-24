import type { AuthErrorCategory } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// detectSessionExpiry — shared session-expiry detection helper
//
// http-session-expiry-reauth-parity, design.md Decision 1: a single shared
// function so the six in-scope call sites stop each reimplementing "is this
// a disclosed session-expiry" independently.
//
// Owns the single `.json()` body read. Callers must not pre-parse the body
// and hand it in — every in-scope call site already reads the body once for
// its own generic-error fallback, and a second `res.json()` call on the same
// Response throws. Returning the parsed body alongside the boolean (rather
// than a bare boolean) is what lets a caller derive that fallback message
// from a non-session-expiry 401 (e.g. `category: "provider_unavailable"`,
// authMiddleware's transient_failure branch) without a second read.
// ---------------------------------------------------------------------------

export interface SessionExpiryDetection {
  isSessionExpired: boolean;
  body: unknown;
}

export async function detectSessionExpiry(res: Response): Promise<SessionExpiryDetection> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const category = (body as { error?: { category?: AuthErrorCategory } } | null)?.error
    ?.category;
  const isSessionExpired = res.status === 401 && category === "session_expired";

  return { isSessionExpired, body };
}
