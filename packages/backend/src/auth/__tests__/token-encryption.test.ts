import { describe, it, expect, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    TOKEN_ENCRYPTION_KEY: "test-encryption-key-for-unit-tests-32chars!",
    SESSION_SECRET: "fallback-session-secret",
  },
}));

import { encryptToken, decryptToken } from "../token-encryption.js";

describe("token-encryption", () => {
  describe("encryptToken / decryptToken round-trip", () => {
    it("should round-trip a simple string", () => {
      const plaintext = "my-access-token-abc123";
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("should round-trip an empty string", () => {
      const encrypted = encryptToken("");
      expect(decryptToken(encrypted)).toBe("");
    });

    it("should round-trip a long JWT-like string", () => {
      const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.signature_here";
      const encrypted = encryptToken(jwt);
      expect(decryptToken(encrypted)).toBe(jwt);
    });

    it("should round-trip unicode content", () => {
      const text = "token-with-unicode-\u{1F600}-\u{1F680}";
      const encrypted = encryptToken(text);
      expect(decryptToken(encrypted)).toBe(text);
    });

    it("should produce different ciphertexts for the same plaintext (random salt/iv)", () => {
      const plaintext = "same-token";
      const a = encryptToken(plaintext);
      const b = encryptToken(plaintext);
      expect(a).not.toBe(b);
      expect(decryptToken(a)).toBe(plaintext);
      expect(decryptToken(b)).toBe(plaintext);
    });
  });

  describe("encryptToken output format", () => {
    it("should produce salt:iv:tag:data base64 format", () => {
      const encrypted = encryptToken("test");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(4);
      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, "base64")).not.toThrow();
      }
    });
  });

  describe("decryptToken error handling", () => {
    it("should throw on malformed input (wrong number of parts)", () => {
      expect(() => decryptToken("a:b:c")).toThrow("Invalid encrypted token format");
      expect(() => decryptToken("a:b:c:d:e")).toThrow("Invalid encrypted token format");
      expect(() => decryptToken("")).toThrow("Invalid encrypted token format");
      expect(() => decryptToken("single")).toThrow("Invalid encrypted token format");
    });

    it("should throw on tampered ciphertext", () => {
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");
      // Tamper with the ciphertext portion
      parts[3] = Buffer.from("tampered").toString("base64");
      expect(() => decryptToken(parts.join(":"))).toThrow();
    });

    it("should throw on tampered auth tag", () => {
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");
      parts[2] = Buffer.from("0000000000000000").toString("base64");
      expect(() => decryptToken(parts.join(":"))).toThrow();
    });
  });
});
