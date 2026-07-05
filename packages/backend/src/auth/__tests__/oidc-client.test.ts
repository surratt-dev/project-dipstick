import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDiscovery = vi.fn();
const mockBuildAuthorizationUrl = vi.fn();
const mockAuthorizationCodeGrant = vi.fn();
const mockRefreshTokenGrant = vi.fn();
const mockCalculatePKCE = vi.fn();
const mockBuildEndSessionUrl = vi.fn();

vi.mock("openid-client", () => ({
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  refreshTokenGrant: (...args: unknown[]) => mockRefreshTokenGrant(...args),
  calculatePKCECodeChallenge: (...args: unknown[]) => mockCalculatePKCE(...args),
  buildEndSessionUrl: (...args: unknown[]) => mockBuildEndSessionUrl(...args),
  allowInsecureRequests: Symbol("allowInsecureRequests"),
  ClientSecretBasic: vi.fn(() => "client-secret-basic"),
}));

vi.mock("../../config.js", () => ({
  config: {
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import {
  getOidcConfig,
  getAuthorizationUrl,
  handleCallback,
  refreshToken,
  getEndSessionUrl,
} from "../oidc-client.js";

describe("oidc-client", () => {
  const mockOidcConfig = { serverMetadata: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(mockOidcConfig);
  });

  describe("getOidcConfig", () => {
    it("should call discovery and return config", async () => {
      const result = await getOidcConfig();
      expect(result).toBe(mockOidcConfig);
      expect(mockDiscovery).toHaveBeenCalled();
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should build authorization URL with PKCE", async () => {
      mockCalculatePKCE.mockResolvedValue("challenge-hash");
      mockBuildAuthorizationUrl.mockReturnValue(new URL("https://idp.example.com/authorize?state=s1"));

      const result = await getAuthorizationUrl("state-1", "nonce-1", "verifier-1");
      expect(result.url.toString()).toContain("idp.example.com/authorize");
      expect(result.codeVerifier).toBe("verifier-1");
      expect(mockCalculatePKCE).toHaveBeenCalledWith("verifier-1");
    });
  });

  describe("handleCallback", () => {
    it("should exchange code for tokens", async () => {
      const mockTokens = { access_token: "at", id_token: "it" };
      mockAuthorizationCodeGrant.mockResolvedValue(mockTokens);

      const result = await handleCallback(
        new URL("http://localhost:3000/auth/callback?code=abc&state=s1"),
        "nonce-1",
        "s1",
        "verifier-1",
      );

      expect(result).toBe(mockTokens);
      expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(
        mockOidcConfig,
        expect.any(URL),
        expect.objectContaining({
          expectedNonce: "nonce-1",
          expectedState: "s1",
          pkceCodeVerifier: "verifier-1",
        }),
      );
    });
  });

  describe("refreshToken", () => {
    it("should call refreshTokenGrant", async () => {
      const mockResult = { access_token: "new-at" };
      mockRefreshTokenGrant.mockResolvedValue(mockResult);

      const result = await refreshToken("rt-123");
      expect(result).toBe(mockResult);
      expect(mockRefreshTokenGrant).toHaveBeenCalledWith(mockOidcConfig, "rt-123");
    });
  });

  describe("getEndSessionUrl", () => {
    it("should return end session URL when endpoint exists", async () => {
      mockOidcConfig.serverMetadata.mockReturnValue({ end_session_endpoint: "https://idp.example.com/logout" });
      mockBuildEndSessionUrl.mockReturnValue(new URL("https://idp.example.com/logout?id_token_hint=tok"));

      const result = await getEndSessionUrl("id-tok", "http://localhost:5173");
      expect(result?.toString()).toContain("idp.example.com/logout");
    });

    it("should return null when no end_session_endpoint", async () => {
      mockOidcConfig.serverMetadata.mockReturnValue({});

      const result = await getEndSessionUrl("id-tok", "http://localhost:5173");
      expect(result).toBeNull();
    });
  });
});
