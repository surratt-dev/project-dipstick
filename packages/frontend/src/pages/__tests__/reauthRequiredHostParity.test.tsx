import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE } from "@dipstick/shared";
import { SessionConnectionHost } from "../SessionConnectionHost.js";
import { FacilitatorConnectionHost } from "../FacilitatorConnectionHost.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

// ---------------------------------------------------------------------------
// reauth-required-client-prompt tasks.md task 4.7 (resolves engineer
// design-review Finding 1): this MUST mount the two real host components —
// SessionConnectionHost (participant) and FacilitatorConnectionHost
// (facilitator) — not two instances of ConnectionStatusBanner. Two
// ConnectionStatusBanner instances would pass trivially without ever
// rendering FacilitatorReadinessGrid, the file where the divergence this
// test exists to catch actually lived (its own independently-duplicated
// REAUTH_REQUIRED_TEXT/role="status" placeholder, prior to design.md
// Decision D9's extraction).
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reauth-required treatment — role uniformity across real host components (design.md Decision D9/D7, tasks.md task 4.7)", () => {
  it("renders identical text, DOM structure, role, and call-to-action for the participant host and the facilitator host", () => {
    let participantSocket: FakeWebSocket | undefined;
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        participantSocket = new FakeWebSocket();
        return participantSocket;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/session/session-42/live"]}>
        <Routes>
          <Route path="/session/:sessionId/live" element={<SessionConnectionHost />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      participantSocket?.emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });
    const participantHtml = screen.getByRole("alert").outerHTML;

    cleanup();
    vi.restoreAllMocks();

    let facilitatorSocket: FakeWebSocket | undefined;
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        facilitatorSocket = new FakeWebSocket();
        return facilitatorSocket;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/session/session-42/facilitator"]}>
        <Routes>
          <Route path="/session/:sessionId/facilitator" element={<FacilitatorConnectionHost />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      facilitatorSocket?.emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });
    const facilitatorHtml = screen.getByRole("alert").outerHTML;

    expect(facilitatorHtml).not.toBe("");
    expect(facilitatorHtml).toBe(participantHtml);
  });
});
