import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFacilitatorConnectionStatus } from "../facilitatorConnectionStatus.js";
import { FakeWebSocket } from "./fake-websocket.js";

afterEach(() => {
  // no-op — kept for symmetry with sibling test files in this directory.
});

describe("useFacilitatorConnectionStatus (facilitator-reconnect-indicator, session-timeout-continuity design.md Decision 5)", () => {
  it("defaults to connected (true) before any message is received", () => {
    const socket = new FakeWebSocket();
    const { result } = renderHook(() => useFacilitatorConnectionStatus(socket as unknown as WebSocket));
    expect(result.current).toBe(true);
  });

  it("returns false after receiving a facilitator_connection_status message with connected: false", () => {
    const socket = new FakeWebSocket();
    const { result } = renderHook(() => useFacilitatorConnectionStatus(socket as unknown as WebSocket));

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    expect(result.current).toBe(false);
  });

  it("returns true again after a subsequent connected: true message", () => {
    const socket = new FakeWebSocket();
    const { result } = renderHook(() => useFacilitatorConnectionStatus(socket as unknown as WebSocket));

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });
    expect(result.current).toBe(false);

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: true } });
    });
    expect(result.current).toBe(true);
  });

  it("ignores unrelated message eventTypes on the same socket (composes with other listeners)", () => {
    const socket = new FakeWebSocket();
    const { result } = renderHook(() => useFacilitatorConnectionStatus(socket as unknown as WebSocket));

    act(() => {
      socket.emitMessage({ eventType: "session_state_change", payload: {} });
    });

    expect(result.current).toBe(true);
  });

  it("returns true when socket is null, and does not throw", () => {
    const { result } = renderHook(() => useFacilitatorConnectionStatus(null));
    expect(result.current).toBe(true);
  });

  it("resets to true when the socket instance itself changes (this participant's own reconnect)", () => {
    const socketA = new FakeWebSocket();
    const { result, rerender } = renderHook(
      ({ socket }: { socket: WebSocket | null }) => useFacilitatorConnectionStatus(socket),
      { initialProps: { socket: socketA as unknown as WebSocket } },
    );

    act(() => {
      socketA.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });
    expect(result.current).toBe(false);

    const socketB = new FakeWebSocket();
    rerender({ socket: socketB as unknown as WebSocket });

    expect(result.current).toBe(true);
  });

  it("stops listening on the old socket after the socket instance changes", () => {
    const socketA = new FakeWebSocket();
    const { result, rerender } = renderHook(
      ({ socket }: { socket: WebSocket | null }) => useFacilitatorConnectionStatus(socket),
      { initialProps: { socket: socketA as unknown as WebSocket } },
    );

    const socketB = new FakeWebSocket();
    rerender({ socket: socketB as unknown as WebSocket });

    act(() => {
      socketA.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    expect(result.current).toBe(true);
  });

  it("ignores a malformed (non-JSON) message without throwing", () => {
    const socket = new FakeWebSocket();
    const { result } = renderHook(() => useFacilitatorConnectionStatus(socket as unknown as WebSocket));

    expect(() => {
      act(() => {
        socket.dispatchEvent(new MessageEvent("message", { data: "not json" }));
      });
    }).not.toThrow();
    expect(result.current).toBe(true);
  });
});
