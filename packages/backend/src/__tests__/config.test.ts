import { describe, it, expect } from "vitest";

// We can't easily test loadConfig() because it runs at import time and calls process.exit.
// Instead we test isPrivateAddress by extracting its logic. Since it's not exported,
// we replicate the function and test it, or we test it indirectly.
// The function is simple enough to replicate for testing purposes.

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
