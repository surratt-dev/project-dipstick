import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useParticipantRoster } from "../participantRoster.js";
import { FakeWebSocket } from "./fake-websocket.js";

// ---------------------------------------------------------------------------
// useParticipantRoster — participant-readiness-roster, tasks.md 3.6.
// ---------------------------------------------------------------------------

function mockFetchOnce(participants: Array<{ userId: string; displayName: string }>): void {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ participants }),
  } as Response);
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useParticipantRoster", () => {
  it("fetches the initial roster on mount, sorted alphabetically", async () => {
    mockFetchOnce([
      { userId: "u2", displayName: "Bob" },
      { userId: "u1", displayName: "Alice" },
    ]);

    const { result } = renderHook(() => useParticipantRoster("sess-1", null));

    await waitFor(() =>
      expect(result.current.participants.map((p) => p.displayName)).toEqual(["Alice", "Bob"]),
    );
    expect(result.current.participants.every((p) => !p.disconnected)).toBe(true);
  });

  it("participant_left marks the existing row disconnected without removing it", async () => {
    mockFetchOnce([{ userId: "u1", displayName: "Alice" }]);
    const socket = new FakeWebSocket() as unknown as WebSocket;

    const { result } = renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(result.current.participants).toHaveLength(1));

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_left",
        payload: { sessionId: "sess-1", userId: "u1", leftAt: "2026-01-01T00:00:00Z" },
      });
    });

    await waitFor(() => expect(result.current.participants[0]?.disconnected).toBe(true));
    expect(result.current.participants).toHaveLength(1);
  });

  it("participant_joined for a known userId clears the disconnected marker without duplicating the row", async () => {
    mockFetchOnce([{ userId: "u1", displayName: "Alice" }]);
    const socket = new FakeWebSocket() as unknown as WebSocket;

    const { result } = renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(result.current.participants).toHaveLength(1));

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_left",
        payload: { sessionId: "sess-1", userId: "u1", leftAt: "2026-01-01T00:00:00Z" },
      });
    });
    await waitFor(() => expect(result.current.participants[0]?.disconnected).toBe(true));

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_joined",
        payload: { sessionId: "sess-1", userId: "u1", joinedAt: "2026-01-01T00:01:00Z" },
      });
    });

    await waitFor(() => expect(result.current.participants[0]?.disconnected).toBe(false));
    expect(result.current.participants).toHaveLength(1);
  });

  // design.md D3a: participant_joined for an unrecognized userId re-fetches
  // the roster (no display name on the event) rather than inserting a
  // blank/UUID row.
  it("participant_joined for an unrecognized userId triggers a re-fetch and renders a real display name", async () => {
    mockFetchOnce([]); // initial fetch — empty roster
    const socket = new FakeWebSocket() as unknown as WebSocket;

    const { result } = renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(result.current.participants).toHaveLength(0));

    mockFetchOnce([{ userId: "u1", displayName: "Alice" }]); // re-fetch triggered by the event below

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_joined",
        payload: { sessionId: "sess-1", userId: "u1", joinedAt: "2026-01-01T00:00:00Z" },
      });
    });

    await waitFor(() =>
      expect(result.current.participants).toEqual([
        { userId: "u1", displayName: "Alice", disconnected: false },
      ]),
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it("sort position is unaffected by a disconnect/reconnect cycle", async () => {
    mockFetchOnce([
      { userId: "u1", displayName: "Alice" },
      { userId: "u2", displayName: "Bob" },
      { userId: "u3", displayName: "Carol" },
    ]);
    const socket = new FakeWebSocket() as unknown as WebSocket;

    const { result } = renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(result.current.participants).toHaveLength(3));

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_left",
        payload: { sessionId: "sess-1", userId: "u2", leftAt: "2026-01-01T00:00:00Z" },
      });
    });
    await waitFor(() => expect(result.current.participants[1]?.disconnected).toBe(true));

    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_joined",
        payload: { sessionId: "sess-1", userId: "u2", joinedAt: "2026-01-01T00:01:00Z" },
      });
    });

    await waitFor(() => expect(result.current.participants[1]?.disconnected).toBe(false));
    expect(result.current.participants.map((p) => p.displayName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  // design.md D3's accepted multi-tab edge case: closing one of two tabs
  // marks the row disconnected even though the other tab is still live —
  // documented behavior, not a crash or unhandled state.
  it("multi-tab edge case: a second connection's own participant_left still marks the row disconnected (accepted, documented)", async () => {
    mockFetchOnce([{ userId: "u1", displayName: "Alice" }]);
    const socket = new FakeWebSocket() as unknown as WebSocket;

    const { result } = renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(result.current.participants).toHaveLength(1));

    // Tab 2 opens (participant_joined) then closes (participant_left) —
    // Tab 1's own connection never sent an event, but the row still ends up
    // disconnected: a documented limitation (design.md D3), not a crash.
    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_joined",
        payload: { sessionId: "sess-1", userId: "u1", joinedAt: "2026-01-01T00:00:30Z" },
      });
    });
    act(() => {
      (socket as unknown as FakeWebSocket).emitMessage({
        eventType: "participant_left",
        payload: { sessionId: "sess-1", userId: "u1", leftAt: "2026-01-01T00:01:00Z" },
      });
    });

    await waitFor(() => expect(result.current.participants[0]?.disconnected).toBe(true));
    expect(result.current.participants).toHaveLength(1);
  });

  it("does not open a second WebSocket connection — it only attaches a listener to the socket it's given", async () => {
    mockFetchOnce([]);
    const socket = new FakeWebSocket() as unknown as WebSocket;
    const addListenerSpy = vi.spyOn(socket, "addEventListener");

    renderHook(() => useParticipantRoster("sess-1", socket));
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1));

    expect(addListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
