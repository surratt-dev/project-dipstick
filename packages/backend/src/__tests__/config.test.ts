import { describe, it, expect } from "vitest";

// We can't easily test loadConfig() because it runs at import time and calls process.exit.
// isPrivateAddress is now exported (persona-login task 1.1) specifically so it can be
// imported and tested directly here instead of being replicated for testing purposes.
process.env["DATABASE_URL"] ??= "postgres://test";
process.env["REDIS_URL"] ??= "redis://test";
process.env["SESSION_SECRET"] ??= "test-secret";
process.env["OIDC_ISSUER"] ??= "https://idp.example.com";
process.env["OIDC_CLIENT_ID"] ??= "client-id";
process.env["OIDC_CLIENT_SECRET"] ??= "client-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const { isPrivateAddress } = await import("../config.js");

describe("isPrivateAddress", () => {
  it.each([
    ["http://localhost:8080", true],
    ["http://127.0.0.1:3000", true],
    ["http://0.0.0.0:443", true],
    ["http://10.0.0.1/path", true],
    ["http://10.255.255.255", true],
    ["http://172.16.0.1", true],
    ["http://172.31.255.255", true],
    ["http://192.168.1.1", true],
    ["http://192.168.0.100", true],
    ["http://8.8.8.8", false],
    ["http://172.15.0.1", false],
    ["http://172.32.0.1", false],
    ["http://192.167.1.1", false],
    ["https://accounts.google.com", false],
    ["https://login.microsoftonline.com", false],
    ["not-a-url", false],
  ])("isPrivateAddress(%s) should be %s", (input, expected) => {
    expect(isPrivateAddress(input)).toBe(expected);
  });
});
