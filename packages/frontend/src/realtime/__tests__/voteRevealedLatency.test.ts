import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeObservedLatencyMs, attachVoteRevealedLatencyLogger } from "../voteRevealedLatency.js";
import { FakeWebSocket } from "./fake-websocket.js";

// ---------------------------------------------------------------------------
// FR-4.6.1 client obligation (websocket-specification Decision D2, tasks.md
// tasks 2.4/2.5).
// ---------------------------------------------------------------------------

describe("computeObservedLatencyMs", () => {
  it("is received_at - serverTimestamp, in milliseconds", () => {
    const serverTimestamp = "2026-01-01T00:00:00.000Z";
    const receivedAtMs = Date.parse("2026-01-01T00:00:00.842Z");
    expect(computeObservedLatencyMs(serverTimestamp, receivedAtMs)).toBe(842);
  });
});

describe("attachVoteRevealedLatencyLogger", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("computes and logs observed latency, and reports it to the reveal-latency endpoint, on a vote_revealed message", () => {
    const socket = new FakeWebSocket() as unknown as WebSocket;
    const detach = attachVoteRevealedLatencyLogger(socket, "s1");

    const serverTimestamp = "2026-01-01T00:00:00.000Z";
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(serverTimestamp) + 500);

    (socket as unknown as FakeWebSocket).emitMessage({
      eventType: "vote_revealed",
      payload: { sessionId: "s1", sessionStatus: "active", topics: [] },
      serverTimestamp,
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[reveal-latency] observed_latency_ms",
      500,
      expect.objectContaining({ sessionId: "s1", serverTimestamp }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/sessions/s1/reveal-latency");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ serverTimestamp, observedLatencyMs: 500 });

    detach();
  });

  it("ignores non-vote_revealed messages", () => {
    const socket = new FakeWebSocket() as unknown as WebSocket;
    attachVoteRevealedLatencyLogger(socket, "s1");

    (socket as unknown as FakeWebSocket).emitMessage({ eventType: "reauth_required" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the report fetch rejects", () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const socket = new FakeWebSocket() as unknown as WebSocket;
    attachVoteRevealedLatencyLogger(socket, "s1");

    expect(() =>
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "vote_revealed",
        payload: { sessionId: "s1", sessionStatus: "active", topics: [] },
        serverTimestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("detach removes the listener — no further computation or reporting", () => {
    const socket = new FakeWebSocket() as unknown as WebSocket;
    const detach = attachVoteRevealedLatencyLogger(socket, "s1");
    detach();

    (socket as unknown as FakeWebSocket).emitMessage({
      eventType: "vote_revealed",
      payload: { sessionId: "s1", sessionStatus: "active", topics: [] },
      serverTimestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
