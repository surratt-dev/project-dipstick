import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { STALE_SIGNAL_CLOSE_CODE } from "@dipstick/shared";
import { SessionConnectionHost, buildSessionWebSocketUrl } from "../SessionConnectionHost.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("buildSessionWebSocketUrl", () => {
  it("builds a same-origin ws(s) URL for the given session id", () => {
    expect(buildSessionWebSocketUrl("abc-123")).toBe(`ws://${window.location.host}/ws/sessions/abc-123`);
  });
});

describe("SessionConnectionHost — minimal host surface (design.md Decision D9, task 5.1)", () => {
  it("wires ConnectionStatusBanner to a real WebSocket connection for the routed session id", () => {
    let lastSocket: FakeWebSocket | undefined;
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        lastSocket = new FakeWebSocket();
        return lastSocket;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/session/session-42/live"]}>
        <Routes>
          <Route path="/session/:sessionId/live" element={<SessionConnectionHost />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("session-connection-host")).toBeInTheDocument();
    expect(lastSocket).toBeDefined();

    act(() => {
      lastSocket?.emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    // Nothing renders yet (pre-floor) — this asserts the host wiring didn't crash.
    expect(screen.getByTestId("session-connection-host")).toBeInTheDocument();
  });
});
