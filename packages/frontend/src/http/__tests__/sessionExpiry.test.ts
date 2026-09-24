import { describe, it, expect } from "vitest";
import { detectSessionExpiry } from "../sessionExpiry.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("detectSessionExpiry (http-session-expiry-reauth-parity, design.md Decision 1)", () => {
  it("recognizes a 401 with category session_expired", async () => {
    const res = jsonResponse(401, {
      error: { category: "session_expired", message: "Your session has expired." },
    });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(true);
  });

  it("does not recognize a 401 with a different category, but still exposes the parsed body", async () => {
    const res = jsonResponse(401, {
      error: { category: "provider_unavailable", message: "Unable to maintain your session." },
    });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(false);
    expect((result.body as { error: { message: string } }).error.message).toBe(
      "Unable to maintain your session.",
    );
  });

  it("does not recognize a 401 with an absent category", async () => {
    const res = jsonResponse(401, { error: { message: "Something went wrong." } });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(false);
    expect(result.body).toEqual({ error: { message: "Something went wrong." } });
  });

  it("never recognizes a non-401 status, regardless of body content", async () => {
    const res = jsonResponse(500, { error: { category: "session_expired", message: "x" } });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(false);
  });

  it("does not throw on a non-JSON body, resolving body to null", async () => {
    const res = new Response("not json", { status: 401 });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(false);
    expect(result.body).toBeNull();
  });

  it("does not throw on an empty body, resolving body to null", async () => {
    const res = new Response(null, { status: 401 });
    const result = await detectSessionExpiry(res);
    expect(result.isSessionExpired).toBe(false);
    expect(result.body).toBeNull();
  });
});
