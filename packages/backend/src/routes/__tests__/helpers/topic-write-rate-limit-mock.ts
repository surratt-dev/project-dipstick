import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared unit-test stand-in for routes/topic-write-rate-limit.ts —
// harden-topic-write-endpoints (#184) task 5.4a / design.md Decision 13.
//
// Unit tests that import routes/topics.ts mock db.js and config.js
// (REDIS_URL "redis://test") but not redis.js. Without this mock the real
// limiter would build an ioredis client against redis://test: every write
// would answer 503 after the 500 ms timeout and reconnect timers would leak
// into the worker. Every such file mocks the limiter with THIS module:
//
//   vi.mock("../topic-write-rate-limit.js", () => import("./helpers/topic-write-rate-limit-mock.js"));
//
// topic-write-rate-limit-structural.test.ts fails if a non-real-Redis test
// file imports topics.ts without that line.
// ---------------------------------------------------------------------------

export const enforceTopicWriteRateLimit = vi.fn(async (): Promise<"allowed" | "rejected"> => "allowed");
