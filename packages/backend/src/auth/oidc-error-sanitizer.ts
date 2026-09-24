import type { FastifyBaseLogger } from "fastify";
import {
  ResponseBodyError,
  AuthorizationResponseError,
  WWWAuthenticateChallengeError,
  ClientError,
} from "openid-client";
import { OperationProcessingError } from "oauth4webapi";
import { MissingClaimError, AuditWriteError } from "./errors.js";

const REDACTED = "[redacted]";

// Onboarding notes for whoever next touches this file or adds an OIDC provider:
//
// (a) Enumerability invariant (exploration-notes.md Finding 2): oauth4webapi's
//     OperationProcessingError sets `cause` via the native `Error(message, { cause })`
//     constructor form, which the spec makes non-enumerable -- pino's default
//     serializer happens to skip it today, but that's incidental, not structural.
//     ResponseBodyError/AuthorizationResponseError/WWWAuthenticateChallengeError instead
//     assign `cause`/`error`/`error_description` as ordinary `this.x = y` fields, which
//     ARE enumerable and DO reach the log unless something stops them. This module exists
//     so nothing here depends on that distinction: every branch below builds its return
//     value as an explicit, opt-in-only object literal, never a mutated/spread clone of
//     `err` itself.
// (b) The class-name field is called `errorClass`, not `type`. Pino's default `err`
//     serializer unconditionally recomputes a `type` key from `err.constructor.name`
//     before copying any field from what we return, and since these return values are
//     plain object literals, `.constructor` is `Object` -- a field named `type` here
//     would be silently overwritten with the string `"Object"` on every branch. `errorClass`
//     sits outside that reserved computation.
// (c) `WWWAuthenticateChallengeError` genuinely has no `error`/`error_description` fields
//     on the real class (verified against oauth4webapi's source) -- that's not an
//     oversight if a future reader goes looking for them.
// (d) Checklist before trusting a new error class (a new oauth4webapi release) or a second
//     IdP's client library: (1) does the class assign sensitive data via the native
//     `Error(message, { cause })` form, or via a plain enumerable field assignment? (2) does
//     `message`/`stack` ever get built from IdP- or token-supplied content, or are they
//     always static strings? (3) run it through a real `pino()` instance and read the actual
//     serialized JSON -- don't reason about it from the class definition alone.
// (e) The `oidc_error_sanitizer.unrecognized_class` line this function emits itself, and
//     the call site's own `log.error(...)` using this function's return value, are two
//     separate, both-expected log lines per invocation for an unrecognized error -- not
//     duplicate logging to be "cleaned up."
export function sanitizeOidcError(
  err: unknown,
  log: FastifyBaseLogger,
): Record<string, unknown> {
  if (err instanceof ResponseBodyError || err instanceof AuthorizationResponseError) {
    return {
      errorClass: err.constructor.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      error: err.error,
      error_description: REDACTED,
      cause: REDACTED,
    };
  }

  if (err instanceof WWWAuthenticateChallengeError) {
    return {
      errorClass: err.constructor.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      cause: REDACTED,
    };
  }

  if (err instanceof OperationProcessingError || err instanceof ClientError) {
    return {
      errorClass: err.constructor.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      cause: REDACTED,
    };
  }

  if (err instanceof MissingClaimError) {
    return {
      errorClass: err.constructor.name,
      message: err.message,
      stack: err.stack,
      claim: err.claim,
    };
  }

  // AuditWriteError: auth-events-audit-log-coverage, design.md Decision D7.
  // message is always a fixed, static string and causeClass never carries
  // identity-provider- or user-supplied content, so nothing here needs
  // redaction -- mirrors MissingClaimError's existing treatment above.
  if (err instanceof AuditWriteError) {
    return {
      errorClass: err.constructor.name,
      message: err.message,
      stack: err.stack,
      causeClass: err.causeClass,
    };
  }

  const errorClass = err instanceof Error ? err.constructor.name : typeof err;
  log.error({ event: "oidc_error_sanitizer.unrecognized_class", errorClass });

  if (err instanceof Error) {
    return {
      errorClass,
      message: REDACTED,
      stack: REDACTED,
      unrecognized: true,
    };
  }

  return {
    errorClass,
    message: REDACTED,
    unrecognized: true,
  };
}
