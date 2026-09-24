import type { AuthErrorCategory } from "@dipstick/shared";
import { MissingClaimError, AuditWriteError } from "./errors.js";

interface AuthErrorResponse {
  category: AuthErrorCategory;
  message: string;
}

export function mapAuthError(err: unknown): AuthErrorResponse {
  // Missing or empty required claim: treat as an authentication failure with a
  // generic message. The claim name is safe to carry in the error class (it
  // identifies which field was absent, not any value), so no PII leaks here.
  if (err instanceof MissingClaimError) {
    return {
      category: "authentication_failed",
      message:
        "Sign-in failed: the identity provider did not return a valid identity token. Please try signing in again.",
    };
  }

  // auth-events-audit-log-coverage, design.md Decision D7: an AuditWriteError
  // means this application's own database infrastructure failed (the audit
  // INSERT inside the transactional group's transaction, or acquiring that
  // transaction's connection) -- not the identity provider and not the
  // user's credentials. Neither authentication_failed's "sign-in" framing
  // nor provider_unavailable (which would misname the IdP as the failing
  // party) fits honestly, so this gets its own category.
  if (err instanceof AuditWriteError) {
    return {
      category: "internal_error",
      message:
        "We couldn't finish signing you in due to a temporary internal problem. Please try again in a few moments. If this continues, contact your IT administrator.",
    };
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    // User cancelled or denied
    if (
      message.includes("access_denied") ||
      message.includes("consent_required") ||
      message.includes("login_required")
    ) {
      return {
        category: "authentication_failed",
        message:
          "Sign-in was cancelled or denied. Please try again. If the problem persists, contact your IT administrator.",
      };
    }

    // IdP returned an error
    if (
      message.includes("invalid_grant") ||
      message.includes("invalid_client") ||
      message.includes("unauthorized_client") ||
      message.includes("invalid_scope")
    ) {
      return {
        category: "authentication_failed",
        message:
          "Authentication failed. Please try signing in again. If this continues, contact your IT administrator.",
      };
    }

    // Network / provider unreachable
    if (
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("etimedout") ||
      message.includes("fetch failed") ||
      message.includes("network")
    ) {
      return {
        category: "provider_unavailable",
        message:
          "The identity provider is temporarily unavailable. Please try again in a few moments. If this continues, contact your IT administrator.",
      };
    }

    // State/nonce mismatch
    if (
      message.includes("state") ||
      message.includes("nonce") ||
      message.includes("csrf")
    ) {
      return {
        category: "invalid_request",
        message:
          "The sign-in request could not be verified. Please try signing in again from the beginning.",
      };
    }
  }

  // Default
  return {
    category: "authentication_failed",
    message:
      "An unexpected error occurred during sign-in. Please try again. If this continues, contact your IT administrator.",
  };
}
