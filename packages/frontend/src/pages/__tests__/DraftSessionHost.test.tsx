import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { DraftSessionHost } from "../DraftSessionHost.js";
import type { FacilitatorSessionStateResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// DraftSessionHost — design.md Decision D6. tasks.md Section 7 (7.7-7.12).
// ---------------------------------------------------------------------------

function renderHost(path = "/team/team-1/session/sess-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/team/:teamId/session/:sessionId" element={<DraftSessionHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetchSequence(...responses: Array<Partial<Response> & { jsonBody?: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.jsonBody),
    } as unknown as Response);
  }
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const draftState: FacilitatorSessionStateResponse = {
  sessionId: "sess-1",
  teamId: "team-1",
  currentSessionState: "draft",
  bannerState: null,
  joinToken: "tok12345",
};

describe("DraftSessionHost", () => {
  // task 7.7 / 7.8: same view whether reached via navigation state or a bare
  // direct hit / refresh (no location.state at all here).
  // join-link-redemption-wiring, tasks.md Task 3.4: the join link is built
  // from the backend's actual registered redemption route (/api/join/:token,
  // not /join/:token), and the badge no longer claims the link is inert.
  it("7.7/7.8: renders the draft control view with a redeemable join link, sourced from facilitator-state alone", async () => {
    mockFetchSequence({ jsonBody: draftState });

    renderHost();

    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    const joinLinkText = screen.getByTestId("draft-join-link").textContent;
    expect(joinLinkText).toContain(`${window.location.origin}/api/join/tok12345`);
    expect(screen.getByTestId("draft-join-link-badge").textContent).toMatch(
      /this link works already.*won't see a waiting screen yet/i,
    );
    expect(screen.getByTestId("draft-join-link-badge").textContent).not.toMatch(/not yet joinable/i);
    expect(screen.queryByTestId("session-creation-picker")).not.toBeInTheDocument();
  });

  // task 7.9
  it("7.9: 'Open the room' requires confirmation before the advance request fires", async () => {
    const fetchMock = mockFetchSequence({ jsonBody: draftState });

    renderHost();
    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    expect(screen.getByTestId("open-the-room-confirm")).toBeInTheDocument();
    // Only the initial facilitator-state GET has fired — no advance POST yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId("open-the-room-confirm-cancel"));
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // task 7.10
  it("7.10: 'Open the room' success transitions the view in place to the live readiness view, with no navigation", async () => {
    mockFetchSequence({ jsonBody: draftState }, { status: 200, jsonBody: { sessionId: "sess-1", teamId: "team-1", status: "lobby" } });

    renderHost();
    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    expect(screen.queryByTestId("draft-control-view")).not.toBeInTheDocument();
  });

  // task 7.11
  it("7.11: 'Open the room' failure leaves the draft session intact and the action retryable", async () => {
    mockFetchSequence(
      { jsonBody: draftState },
      { ok: false, status: 500, jsonBody: { error: { message: "Could not open the room." } } },
    );

    renderHost();
    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("advance-error")).toBeInTheDocument());
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    // The action is retryable: the button is back, not stuck disabled forever.
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
  });

  // inline-team-creation, tasks.md 5.7/7.2: the landing-acknowledgment copy
  // is named as its own assertion, distinct from the existing-team flow.
  it("inline-team-creation 5.7: a new-team creation navigation shows the landing acknowledgment on the live readiness view", async () => {
    mockFetchSequence({
      jsonBody: { sessionId: "sess-1", teamId: "team-1", currentSessionState: "lobby", bannerState: null, joinToken: "tok12345" },
    });

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/team/team-1/session/sess-1",
            state: { teamName: "Platform Team", lastSessionAt: null, newTeamCreated: true },
          },
        ]}
      >
        <Routes>
          <Route path="/team/:teamId/session/:sessionId" element={<DraftSessionHost />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    expect(screen.getByTestId("new-team-landing-acknowledgment")).toBeInTheDocument();
    expect(screen.getByTestId("new-team-landing-acknowledgment").textContent).toMatch(/default topics assigned/i);
  });

  it("inline-team-creation 5.7: the existing-team flow's landing view never shows the new-team acknowledgment", async () => {
    mockFetchSequence({
      jsonBody: { sessionId: "sess-1", teamId: "team-1", currentSessionState: "lobby", bannerState: null, joinToken: "tok12345" },
    });

    renderHost();

    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    expect(screen.queryByTestId("new-team-landing-acknowledgment")).not.toBeInTheDocument();
  });

  // task 7.12
  it("7.12: a non-facilitator caller sees the facilitator-state endpoint's existing 403, not the control view", async () => {
    mockFetchSequence({
      ok: false,
      status: 403,
      jsonBody: { error: { message: "Only the session facilitator can access facilitator state." } },
    });

    renderHost();

    await waitFor(() => expect(screen.getByTestId("draft-session-host-error")).toBeInTheDocument());
    expect(screen.getByTestId("draft-session-host-error").textContent).toMatch(/facilitator/i);
    expect(screen.queryByTestId("draft-control-view")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// join-link-display-copy — tasks.md §4. Copy button/banner wiring in both
// draft-control-view and live-readiness-view.
// ---------------------------------------------------------------------------
const lobbyState: FacilitatorSessionStateResponse = {
  sessionId: "sess-1",
  teamId: "team-1",
  currentSessionState: "lobby",
  bannerState: null,
  joinToken: "tok12345",
};

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

describe("join-link-display-copy", () => {
  afterEach(() => {
    vi.useRealTimers();
    setClipboard(undefined);
  });

  // 4.1
  it("4.1: copy button present and functional in draft-status render", async () => {
    mockFetchSequence({ jsonBody: draftState });
    setClipboard(() => Promise.resolve());

    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());

    expect(screen.getByTestId("draft-join-link-copy-button")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    await waitFor(() => expect(screen.getByTestId("draft-join-link-copied-banner")).toBeInTheDocument());
  });

  // 4.2
  it("4.2: copy button present and functional in lobby-status render", async () => {
    mockFetchSequence({ jsonBody: lobbyState });
    setClipboard(() => Promise.resolve());

    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());

    expect(screen.getByTestId("live-join-link-copy-button")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("live-join-link-copy-button"));
    await waitFor(() => expect(screen.getByTestId("live-join-link-copied-banner")).toBeInTheDocument());
  });

  // 4.3
  it("4.3: successful copy shows the 'Link copied' banner in both branches", async () => {
    setClipboard(() => Promise.resolve());

    mockFetchSequence({ jsonBody: draftState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    await waitFor(() =>
      expect(screen.getByTestId("draft-join-link-copied-banner").textContent).toBe("Link copied"),
    );
    cleanup();

    mockFetchSequence({ jsonBody: lobbyState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("live-join-link-copy-button"));
    await waitFor(() =>
      expect(screen.getByTestId("live-join-link-copied-banner").textContent).toBe("Link copied"),
    );
  });

  // 4.4
  it("4.4: navigator.clipboard undefined shows selectable text and never shows the confirmation banner, in both branches", async () => {
    setClipboard(undefined);

    mockFetchSequence({ jsonBody: draftState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    expect(screen.queryByTestId("draft-join-link-copied-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-join-link")).toBeInTheDocument();
    cleanup();

    mockFetchSequence({ jsonBody: lobbyState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("live-join-link-copy-button"));
    expect(screen.queryByTestId("live-join-link-copied-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("live-join-link")).toBeInTheDocument();
  });

  // 4.5
  it("4.5: navigator.clipboard.writeText rejecting shows the same fallback as the undefined case, in both branches", async () => {
    setClipboard(() => Promise.reject(new Error("permission denied")));

    mockFetchSequence({ jsonBody: draftState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    expect(screen.queryByTestId("draft-join-link-copied-banner")).not.toBeInTheDocument();
    cleanup();

    mockFetchSequence({ jsonBody: lobbyState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("live-join-link-copy-button"));
    expect(screen.queryByTestId("live-join-link-copied-banner")).not.toBeInTheDocument();
  });

  // 4.6
  it("4.6: the copied URL matches `${origin}${buildJoinLinkPath(joinToken)}` in both branches", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);

    mockFetchSequence({ jsonBody: draftState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/api/join/tok12345`);
    cleanup();

    mockFetchSequence({ jsonBody: lobbyState });
    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("live-join-link-copy-button"));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/api/join/tok12345`);
  });

  // 4.7
  it("4.7: lobby-status link does not render with the draft branch's muted text color or its badge", async () => {
    mockFetchSequence({ jsonBody: lobbyState });

    renderHost();
    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());

    const liveLink = screen.getByTestId("live-join-link");
    expect(liveLink.getAttribute("style") ?? "").not.toMatch(/#9e9e9e/);
    expect(screen.queryByTestId("draft-join-link-badge")).not.toBeInTheDocument();
  });

  // 4.8
  it("4.8: the 'Link copied' banner, already showing in draft status, survives the transition to lobby without resetting to idle", async () => {
    setClipboard(() => Promise.resolve());
    mockFetchSequence(
      { jsonBody: draftState },
      { status: 200, jsonBody: { sessionId: "sess-1", teamId: "team-1", status: "lobby" } },
    );

    renderHost();
    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("draft-join-link-copy-button"));
    await waitFor(() => expect(screen.getByTestId("draft-join-link-copied-banner")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("live-readiness-view")).toBeInTheDocument());
    expect(screen.getByTestId("live-join-link-copied-banner")).toBeInTheDocument();
    expect(screen.getByTestId("live-join-link-copied-banner").textContent).toBe("Link copied");
  });
});

// ---------------------------------------------------------------------------
// http-session-expiry-reauth-parity, tasks.md 4.1-4.5, design.md Decisions
// 1a and 4.
// ---------------------------------------------------------------------------
const SESSION_EXPIRED_BODY = {
  error: { category: "session_expired", message: "Your session has expired. Please sign in again." },
};

describe("http-session-expiry-reauth-parity: DraftSessionHost reauth parity", () => {
  // task 4.3
  it("4.3: a mount-time facilitator-state session-expiry renders the treatment, not the generic load error", async () => {
    mockFetchSequence({ ok: false, status: 401, jsonBody: SESSION_EXPIRED_BODY });

    renderHost();

    await waitFor(() => expect(screen.getByRole("button", { name: /log in again/i })).toBeInTheDocument());
    expect(screen.queryByTestId("draft-session-host-error")).not.toBeInTheDocument();
  });

  it("a non-session-expiry 401 (e.g. provider_unavailable) keeps the existing generic-error handling, deriving the message from the response body", async () => {
    mockFetchSequence({
      ok: false,
      status: 401,
      jsonBody: { error: { category: "provider_unavailable", message: "Unable to maintain your session." } },
    });

    renderHost();

    await waitFor(() => expect(screen.getByTestId("draft-session-host-error")).toBeInTheDocument());
    expect(screen.getByTestId("draft-session-host-error")).toHaveTextContent("Unable to maintain your session.");
  });

  // task 4.4
  it("4.4: a session expiring between clicking 'Yes, open the room' and the advance response renders the treatment, not 'Could not open the room.'", async () => {
    mockFetchSequence({ jsonBody: draftState }, { ok: false, status: 401, jsonBody: SESSION_EXPIRED_BODY });

    renderHost();
    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    await waitFor(() => expect(screen.getByRole("button", { name: /log in again/i })).toBeInTheDocument());
    expect(screen.queryByTestId("advance-error")).not.toBeInTheDocument();
  });

  // task 4.5
  it("4.5: the confirm-step phase does not survive a fresh mount (a reauth round trip lands on the bare draft view)", async () => {
    mockFetchSequence({ jsonBody: draftState });
    const { unmount } = renderHost();
    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("open-the-room"));
    expect(screen.getByTestId("open-the-room-confirm")).toBeInTheDocument();

    // Session expires while sitting on the confirm step, no further fetch
    // fires. The user reauthenticates and returns via `returnTo` — modeled
    // here as a fresh mount of this component, since `advanceState.phase`
    // is plain React state with no persistence.
    unmount();
    mockFetchSequence({ jsonBody: draftState });
    renderHost();

    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
  });
});
