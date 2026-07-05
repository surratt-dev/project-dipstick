import { describe, it, expect } from "vitest";
import { mapAuthError } from "../error-handler.js";

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
