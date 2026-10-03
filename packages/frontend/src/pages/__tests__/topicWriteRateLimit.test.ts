import { describe, it, expect } from "vitest";
import {
  TOPIC_WRITE_BURST_LIMIT_EXCEEDED,
  TOPIC_WRITE_DAILY_LIMIT_EXCEEDED,
  TOPIC_WRITE_RATE_LIMIT_MESSAGES,
} from "@dipstick/shared";
import { rateLimitMessage, topicWriteErrorMessage } from "../topicWriteRateLimit.js";
import { mockFetchResponse } from "./topicManagementTestUtils.js";

// harden-topic-write-endpoints (#184) task 6.1: rateLimitMessage() picks copy
// by error.code and turns a parseable Retry-After into "about N minute(s)".

const FALLBACK = "Unable to save.";
const burstBody = { error: { code: TOPIC_WRITE_BURST_LIMIT_EXCEEDED, message: TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst } };
const dailyBody = { error: { code: TOPIC_WRITE_DAILY_LIMIT_EXCEEDED, message: TOPIC_WRITE_RATE_LIMIT_MESSAGES.daily } };

function res(headers?: Record<string, string>) {
  return mockFetchResponse(null, 429, headers);
}

describe("rateLimitMessage (#184 6.1)", () => {
  it("Retry-After: 290 gives the pinned 'about 5 minutes' copy", () => {
    expect(rateLimitMessage(res({ "Retry-After": "290" }), burstBody, FALLBACK)).toBe(
      "You've made a lot of topic changes in a short time. Changes so far are saved. Please wait about 5 minutes and try again.",
    );
  });

  it.each(["60", "1", "0"])("Retry-After: %s gives 'about 1 minute' (singular, minimum 1)", (value) => {
    const message = rateLimitMessage(res({ "retry-after": value }), burstBody, FALLBACK);
    expect(message).toContain("Please wait about 1 minute and try again.");
    expect(message).not.toMatch(/\d{2,}|seconds/);
  });

  it("a missing Retry-After keeps the server's message ('a few minutes')", () => {
    expect(rateLimitMessage(res({}), burstBody, FALLBACK)).toBe(TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst);
  });

  it.each(["soon", "Wed, 21 Oct 2026 07:28:00 GMT", "-5", "12.5"])("an unparseable Retry-After (%s) keeps the server's message", (value) => {
    expect(rateLimitMessage(res({ "Retry-After": value }), burstBody, FALLBACK)).toBe(TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst);
  });

  it("a response with no headers at all does not throw and keeps the server's message", () => {
    const headerless = mockFetchResponse(null, 429);
    expect("headers" in headerless).toBe(false);
    expect(rateLimitMessage(headerless, burstBody, FALLBACK)).toBe(TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst);
  });

  it("a daily 429 shows the server's message unchanged, even with a Retry-After", () => {
    expect(rateLimitMessage(res({ "Retry-After": "79200" }), dailyBody, FALLBACK)).toBe(TOPIC_WRITE_RATE_LIMIT_MESSAGES.daily);
  });

  it("falls back when the body has no message", () => {
    expect(rateLimitMessage(res(), null, FALLBACK)).toBe(FALLBACK);
  });
});

describe("topicWriteErrorMessage (#184 6.2)", () => {
  it("uses rate-limit copy only for a 429", () => {
    expect(topicWriteErrorMessage(mockFetchResponse(null, 429, { "Retry-After": "120" }), burstBody, FALLBACK)).toContain(
      "about 2 minutes",
    );
    // A 503 (or anything else) passes the server's message through, even with
    // a burst code and a Retry-After.
    expect(topicWriteErrorMessage(mockFetchResponse(null, 503, { "Retry-After": "120" }), burstBody, FALLBACK)).toBe(
      TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst,
    );
    expect(topicWriteErrorMessage(mockFetchResponse(null, 422), {}, FALLBACK)).toBe(FALLBACK);
  });
});

describe("isTopicWritePause (#184, architect review N4)", () => {
  it("is a 429, or a 503 carrying the limiter's own code -- not any 503", async () => {
    const { isTopicWritePause } = await import("../topicWriteRateLimit.js");
    expect(isTopicWritePause(429, null)).toBe(true);
    expect(isTopicWritePause(503, { error: { code: "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE" } })).toBe(true);
    expect(isTopicWritePause(503, { error: { code: "SOMETHING_ELSE", message: "Bad gateway" } })).toBe(false);
    expect(isTopicWritePause(503, null)).toBe(false);
    expect(isTopicWritePause(500, null)).toBe(false);
  });
});
