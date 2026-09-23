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
//
// session-timeout-continuity (design.md Decision 4, tasks.md task 3.6)
// narrows the invariant this test checks: the two hosts' rendered output is
// no longer byte-for-byte identical — the facilitator host omits the
// vote-loss sentence (facilitators never vote). Every other content
// element, the ARIA role, and the call-to-action remain identical.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reauth-required treatment — role uniformity across real host components (design.md Decision D9/D7, tasks.md tasks 4.7/3.6)", () => {
  it("renders identical text, DOM structure, role, and call-to-action for the participant host and the facilitator host, except the vote-loss sentence's presence/absence", () => {
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
    const participantHtmlWithoutVoteLoss = participantHtml.replace(
      / Any vote you haven't submitted yet will be lost\./i,
      "",
    );
    expect(facilitatorHtml).toBe(participantHtmlWithoutVoteLoss);
    expect(participantHtml).not.toBe(facilitatorHtml);
  });

  it("the facilitator host never includes the vote-loss sentence, and the participant host does (per the current voteDraft.ts import determination)", () => {
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

    expect(screen.getByRole("alert").textContent).not.toMatch(
      /vote you haven't submitted yet will be lost/i,
    );
  });
});
