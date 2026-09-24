import { describe, it, expect } from "vitest";
import pino from "pino";
import type { FastifyBaseLogger } from "fastify";
import {
  ResponseBodyError,
  AuthorizationResponseError,
  WWWAuthenticateChallengeError,
  Configuration,
  buildEndSessionUrl,
} from "openid-client";
import { OperationProcessingError } from "oauth4webapi";
import { ClientError } from "openid-client";
import { sanitizeOidcError } from "../oidc-error-sanitizer.js";
import { MissingClaimError, AuditWriteError } from "../errors.js";

const CANARY = `CANARY_TOKEN_${crypto.randomUUID()}`;

/**
 * Logs `err` through a real pino() instance, configured the same way
 * app.ts configures its logger (no custom `err` serializer — only `req` is
 * customized there, which is irrelevant to this module), and returns the
 * parsed JSON line plus the raw serialized text (for substring assertions
 * against fields that aren't part of the known schema).
 */
function logAndCapture(err: unknown, log: FastifyBaseLogger): { parsed: Record<string, unknown>; raw: string } {
  const lines: string[] = [];
  const logger = pino({ level: "error" }, { write: (line: string) => lines.push(line) });
  const sanitized = sanitizeOidcError(err, log);
  logger.error({ err: sanitized });
  const raw = lines[0];
  return { parsed: JSON.parse(raw) as Record<string, unknown>, raw };
}

/** A no-op logger for cases where the sanitizer's own log.error call isn't under test. */
function noopLogger(): FastifyBaseLogger {
  return {
    error: () => {},
  } as unknown as FastifyBaseLogger;
}

/** A logger that records calls made directly to it (distinct from the pino instance under `err`). */
function spyLogger(): { log: FastifyBaseLogger; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = {
    error: (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as FastifyBaseLogger;
  return { log, calls };
}

describe("sanitizeOidcError", () => {
  describe("ResponseBodyError (case 1a)", () => {
    it("redacts error_description and cause, keeps errorClass/message/stack/code/error", () => {
      const err = new ResponseBodyError("server responded with an error in the response body", {
        cause: { error: "invalid_grant", error_description: CANARY },
        response: { status: 400 },
      });

      const { parsed, raw } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("ResponseBodyError");
      expect(out.message).toBe("server responded with an error in the response body");
      expect(out.code).toBe("OAUTH_RESPONSE_BODY_ERROR");
      expect(out.error).toBe("invalid_grant");
      expect(typeof out.stack).toBe("string");
      expect(out.error_description).toBe("[redacted]");
      expect(out.cause).toBe("[redacted]");
    });
  });

  describe("AuthorizationResponseError (case 1a)", () => {
    it("redacts error_description and cause, keeps errorClass/message/stack/code/error", () => {
      // AuthorizationResponseError's constructor calls .get('error')/.get('error_description')
      // directly on its `cause` option — a plain object literal throws a TypeError at
      // construction time, not a testable instance. Must be a real URLSearchParams.
      const err = new AuthorizationResponseError("authorization response from the server is an error", {
        cause: new URLSearchParams({ error: "invalid_grant", error_description: CANARY }),
      });

      const { parsed, raw } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("AuthorizationResponseError");
      expect(out.code).toBe("OAUTH_AUTHORIZATION_RESPONSE_ERROR");
      expect(out.error).toBe("invalid_grant");
      expect(out.error_description).toBe("[redacted]");
      expect(out.cause).toBe("[redacted]");
    });
  });

  describe("WWWAuthenticateChallengeError (case 1b)", () => {
    it("redacts cause, keeps errorClass/message/stack/code, and has no error/error_description keys", () => {
      const err = new WWWAuthenticateChallengeError(
        "server responded with a challenge in the WWW-Authenticate HTTP Header",
        {
          cause: [{ scheme: "bearer", parameters: { error_description: CANARY } }],
          response: { status: 401 },
        },
      );

      const { parsed, raw } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("WWWAuthenticateChallengeError");
      expect(out.code).toBe("OAUTH_WWW_AUTHENTICATE_CHALLENGE");
      expect(out.cause).toBe("[redacted]");
      // This class has neither field on the real instance — absent, not falsely
      // marked as redacted.
      expect(out).not.toHaveProperty("error");
      expect(out).not.toHaveProperty("error_description");
    });
  });

  describe("ClientError (case 2)", () => {
    it("redacts cause, keeps errorClass/message/stack/code, lands in the same branch as OperationProcessingError", () => {
      // Directly constructible: new ClientError(message, { code, cause }), the native
      // Error(message, options) form — same non-enumerable-cause mechanism as
      // OperationProcessingError.
      const err = new ClientError("unexpected JWT claim value encountered", {
        code: "OAUTH_JWT_CLAIM_COMPARISON",
        cause: CANARY,
      });

      const { parsed, raw } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("ClientError");
      expect(out.message).toBe("unexpected JWT claim value encountered");
      expect(out.code).toBe("OAUTH_JWT_CLAIM_COMPARISON");
      expect(typeof out.stack).toBe("string");
      expect(out.cause).toBe("[redacted]");
    });
  });

  describe("OperationProcessingError (case 2), via the real getEndSessionUrl()-reachable path", () => {
    it("classifies the real, unwrapped error thrown for a malformed end_session_endpoint", () => {
      // buildEndSessionUrl() -> oauth4webapi's resolveEndpoint() -> validateEndpoint() is
      // synchronous and bypasses openid-client's errorHandler() entirely — the one call
      // site that can throw a raw, unwrapped OperationProcessingError. Simulate discovered
      // issuer metadata with a malformed end_session_endpoint rather than constructing the
      // class arbitrarily, so this proves the call site that actually needs it works.
      const config = new Configuration(
        { issuer: "https://idp.example.com", end_session_endpoint: "not a url" },
        "test-client-id",
      );

      let thrown: unknown;
      try {
        buildEndSessionUrl(config, {
          id_token_hint: "id-token",
          post_logout_redirect_uri: "https://app.example.com",
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(OperationProcessingError);

      const { parsed } = logAndCapture(thrown, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(out.errorClass).toBe("OperationProcessingError");
      expect(out.code).toBe("OAUTH_INVALID_SERVER_METADATA");
      expect(typeof out.message).toBe("string");
      // No canary is feasible here: validateEndpoint()'s cause is always the fixed
      // shape { attribute: "end_session_endpoint" }, never built from the malformed
      // value itself (consistent with Finding 1 — message/cause content is static,
      // not IdP- or input-derived, for this throw site). Still must be redacted.
      expect(out.cause).toBe("[redacted]");
    });
  });

  describe("MissingClaimError (case 3)", () => {
    it("allowlists errorClass/message/stack/claim only", () => {
      const err = new MissingClaimError("sub");

      const { parsed } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(out.errorClass).toBe("MissingClaimError");
      expect(out.claim).toBe("sub");
      expect(typeof out.message).toBe("string");
      expect(typeof out.stack).toBe("string");
      // "type" is pino's own reserved field, unconditionally recomputed by its default
      // err serializer's second pass (D3) -- not something the sanitizer adds. Everything
      // else beyond the case-3 allowlist would be a real leak.
      expect(Object.keys(out).sort()).toEqual(["claim", "errorClass", "message", "stack", "type"].sort());
    });
  });

  // auth-events-audit-log-coverage, design.md Decision D7.
  describe("AuditWriteError", () => {
    it("preserves errorClass/message/stack/causeClass unredacted, mirroring MissingClaimError's treatment", () => {
      const err = new AuditWriteError(new Error("connection reset"));

      const { parsed } = logAndCapture(err, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(out.errorClass).toBe("AuditWriteError");
      expect(out.causeClass).toBe("Error");
      expect(typeof out.message).toBe("string");
      expect(typeof out.stack).toBe("string");
      expect(Object.keys(out).sort()).toEqual(["causeClass", "errorClass", "message", "stack", "type"].sort());
    });

    it("never carries the underlying database error's own message", () => {
      const CANARY_DB_MESSAGE = `SELECT * FROM secrets WHERE token='${CANARY}'`;
      const err = new AuditWriteError(new Error(CANARY_DB_MESSAGE));

      const { raw } = logAndCapture(err, noopLogger());
      expect(raw).not.toContain(CANARY);
    });
  });

  describe("unrecognized Error subclass (case 4)", () => {
    class SomeOtherLibraryError extends Error {}

    it("redacts message/stack, sets unrecognized: true, and emits a separate signal log line", () => {
      const err = new SomeOtherLibraryError(CANARY);
      const { log, calls } = spyLogger();

      const { parsed, raw } = logAndCapture(err, log);
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("SomeOtherLibraryError");
      expect(out.message).toBe("[redacted]");
      expect(out.stack).toBe("[redacted]");
      expect(out.unrecognized).toBe(true);

      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toMatchObject({
        event: "oidc_error_sanitizer.unrecognized_class",
        errorClass: "SomeOtherLibraryError",
      });
    });
  });

  describe("non-Error thrown value (case 5)", () => {
    it("derives errorClass from typeof, redacts message, sets unrecognized: true", () => {
      const thrown = `plain string throw ${CANARY}`;
      const { log, calls } = spyLogger();

      const { parsed, raw } = logAndCapture(thrown, log);
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("string");
      expect(out.message).toBe("[redacted]");
      expect(out.unrecognized).toBe(true);
      // The wrapper itself never sets `stack` for a non-Error thrown value (case 5) --
      // pino's default err serializer adds an empty "" placeholder for any object with a
      // string `.message` (D2's inert second pass), not a real stack trace.
      expect(out.stack).toBeFalsy();

      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toMatchObject({
        event: "oidc_error_sanitizer.unrecognized_class",
        errorClass: "string",
      });
    });

    it("handles a plain object literal thrown value the same way", () => {
      const thrown = { error_description: CANARY };
      const { parsed, raw } = logAndCapture(thrown, noopLogger());
      const out = parsed.err as Record<string, unknown>;

      expect(raw).not.toContain(CANARY);
      expect(out.errorClass).toBe("object");
      expect(out.unrecognized).toBe(true);
    });
  });
});
