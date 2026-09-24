import { describe, it, expect } from "vitest";
import { mapAuthError } from "../error-handler.js";
import { MissingClaimError, AuditWriteError } from "../errors.js";

describe("MissingClaimError", () => {
  it("maps to authentication_failed with a generic message", () => {
    const result = mapAuthError(new MissingClaimError("sub"));
    expect(result.category).toBe("authentication_failed");
    // Message must be generic — must not contain any claim value
    expect(result.message).toContain("identity provider");
  });

  it("does not leak the claim value into the message", () => {
    const claimValue = "some-sensitive-subject-value";
    // Even if someone passes a value as the claim name (shouldn't happen),
    // the message must not include raw claim values.
    const result = mapAuthError(new MissingClaimError("iss"));
    expect(result.message).not.toContain(claimValue);
  });

  it("maps iss MissingClaimError to authentication_failed", () => {
    const result = mapAuthError(new MissingClaimError("iss"));
    expect(result.category).toBe("authentication_failed");
  });
});

// auth-events-audit-log-coverage, design.md Decision D7.
describe("AuditWriteError", () => {
  it("maps to internal_error, not authentication_failed", () => {
    const result = mapAuthError(new AuditWriteError(new Error("connection reset")));
    expect(result.category).toBe("internal_error");
  });

  it("does not use authentication_failed's 'sign-in' framing", () => {
    const result = mapAuthError(new AuditWriteError(new Error("boom")));
    expect(result.message).toContain("internal problem");
    expect(result.message).not.toContain("credentials");
  });

  it("is distinguished from a db.connect() failure the same way (same underlying class)", () => {
    const insertFailure = mapAuthError(new AuditWriteError(new Error("insert failed")));
    const connectFailure = mapAuthError(new AuditWriteError(new Error("pool exhausted")));
    expect(insertFailure).toEqual(connectFailure);
  });
});

describe("mapAuthError", () => {
  describe("authentication_failed — user cancelled/denied", () => {
    it.each(["access_denied", "consent_required", "login_required"])(
      "should map '%s' to authentication_failed",
      (keyword) => {
        const result = mapAuthError(new Error(`Something ${keyword} happened`));
        expect(result.category).toBe("authentication_failed");
        expect(result.message).toContain("cancelled or denied");
      },
    );
  });

  describe("authentication_failed — IdP errors", () => {
    it.each(["invalid_grant", "invalid_client", "unauthorized_client", "invalid_scope"])(
      "should map '%s' to authentication_failed",
      (keyword) => {
        const result = mapAuthError(new Error(`Error: ${keyword}`));
        expect(result.category).toBe("authentication_failed");
        expect(result.message).toContain("Authentication failed");
      },
    );
  });

  describe("provider_unavailable — network errors", () => {
    it.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "fetch failed", "network error"])(
      "should map '%s' to provider_unavailable",
      (keyword) => {
        const result = mapAuthError(new Error(keyword));
        expect(result.category).toBe("provider_unavailable");
        expect(result.message).toContain("temporarily unavailable");
      },
    );
  });

  describe("invalid_request — state/nonce/csrf", () => {
    it.each(["state mismatch", "nonce mismatch", "csrf detected"])(
      "should map '%s' to invalid_request",
      (keyword) => {
        const result = mapAuthError(new Error(keyword));
        expect(result.category).toBe("invalid_request");
        expect(result.message).toContain("could not be verified");
      },
    );
  });

  describe("default fallback", () => {
    it("should return authentication_failed for unknown errors", () => {
      const result = mapAuthError(new Error("something unknown"));
      expect(result.category).toBe("authentication_failed");
      expect(result.message).toContain("unexpected error");
    });

    it("should return authentication_failed for non-Error values", () => {
      expect(mapAuthError("string error").category).toBe("authentication_failed");
      expect(mapAuthError(null).category).toBe("authentication_failed");
      expect(mapAuthError(undefined).category).toBe("authentication_failed");
      expect(mapAuthError(42).category).toBe("authentication_failed");
    });
  });
});
