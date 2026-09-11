import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const mockPublish = vi.fn();
const mockDuplicate = vi.fn();

vi.mock("../../redis.js", () => ({
  redis: {
    publish: (...args: unknown[]) => mockPublish(...args),
    duplicate: (...args: unknown[]) => mockDuplicate(...args),
  },
}));
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import {
  WS_EVENTS_CHANNEL,
  publishWsEvent,
  publishVoteReadinessUpdate,
  publishSessionStateChange,
  publishVoteRevealed,
  publishTopicHistoryUpdate,
  createWsSubscriber,
} from "../ws-pubsub.js";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;
}

describe("publishWsEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes a JSON-serialized envelope on the ws:events channel using the SHARED redis client (not duplicate())", async () => {
    await publishWsEvent({
      eventType: "vote_readiness_update",
      sessionId: "s1",
      payload: { sessionId: "s1", sessionTopicId: "st1", voterId: "u1", readyAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      WS_EVENTS_CHANNEL,
      JSON.stringify({
        eventType: "vote_readiness_update",
        sessionId: "s1",
        payload: { sessionId: "s1", sessionTopicId: "st1", voterId: "u1", readyAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    // Publishing must never call duplicate() — only .subscribe() requires
    // connection isolation (design.md Decision D2). PUBLISH is an ordinary
    // command and correctly reuses the shared client.
    expect(mockDuplicate).not.toHaveBeenCalled();
  });
});

describe("typed publish wrappers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishVoteReadinessUpdate wraps the payload in the correct envelope shape", async () => {
    await publishVoteReadinessUpdate("s1", { sessionId: "s1", sessionTopicId: "st1", voterId: "u1", readyAt: "2026-01-01T00:00:00.000Z" });
    const [, body] = mockPublish.mock.calls[0] as [string, string];
    expect(JSON.parse(body)).toMatchObject({ eventType: "vote_readiness_update", sessionId: "s1" });
  });

  it("publishSessionStateChange wraps the payload in the correct envelope shape", async () => {
    await publishSessionStateChange("s1", { sessionId: "s1", teamId: "t1", previousStatus: "draft", newStatus: "lobby", changedAt: "2026-01-01T00:00:00.000Z" });
    const [, body] = mockPublish.mock.calls[0] as [string, string];
    expect(JSON.parse(body)).toMatchObject({ eventType: "session_state_change", sessionId: "s1" });
  });

  it("publishVoteRevealed wraps a minimal trigger payload — not the revealed vote content (this wrapper is unreachable in production pending #26)", async () => {
    await publishVoteRevealed("s1", {
      sessionId: "s1",
      sessionStatus: "active",
      serverTimestamp: "2026-01-01T00:00:00.000Z",
    });
    const [, body] = mockPublish.mock.calls[0] as [string, string];
    expect(JSON.parse(body)).toEqual({
      eventType: "vote_revealed",
      sessionId: "s1",
      payload: { sessionId: "s1", sessionStatus: "active", serverTimestamp: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("publishTopicHistoryUpdate wraps the payload in the correct envelope shape (this wrapper is unreachable in production pending #26)", async () => {
    await publishTopicHistoryUpdate("t1", { teamId: "t1", updateType: "action_item_finalized", sessionId: "s1", updatedAt: "2026-01-01T00:00:00.000Z" });
    const [, body] = mockPublish.mock.calls[0] as [string, string];
    expect(JSON.parse(body)).toMatchObject({ eventType: "topic_history_update", teamId: "t1" });
  });
});

describe("createWsSubscriber — connection isolation (design.md Decision D2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the subscriber via redis.duplicate(), never subscribing on the shared client", () => {
    const fakeSubscriberConn = { on: vi.fn() };
    mockDuplicate.mockReturnValue(fakeSubscriberConn);

    const result = createWsSubscriber(fakeLogger());

    expect(mockDuplicate).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeSubscriberConn);
  });

  it("registers structured-warning listeners for reconnecting, ready, and error", () => {
    const fakeSubscriberConn = { on: vi.fn() };
    mockDuplicate.mockReturnValue(fakeSubscriberConn);

    createWsSubscriber(fakeLogger());

    const registeredEvents = fakeSubscriberConn.on.mock.calls.map(([event]: [string]) => event);
    expect(registeredEvents).toEqual(expect.arrayContaining(["reconnecting", "ready", "error"]));
  });

  it("logs a warning when the subscriber connection is reconnecting", () => {
    const handlers: Record<string, () => void> = {};
    const fakeSubscriberConn = {
      on: (event: string, cb: () => void) => {
        handlers[event] = cb;
      },
    };
    mockDuplicate.mockReturnValue(fakeSubscriberConn);
    const logger = fakeLogger();

    createWsSubscriber(logger);
    handlers["reconnecting"]!();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: WS_EVENTS_CHANNEL }),
      expect.stringContaining("reconnecting"),
    );
  });
});
