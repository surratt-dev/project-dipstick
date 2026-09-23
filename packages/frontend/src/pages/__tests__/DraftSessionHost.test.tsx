import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("7.7/7.8: renders the draft control view with a non-joinable join link, sourced from facilitator-state alone", async () => {
    mockFetchSequence({ jsonBody: draftState });

    renderHost();

    await waitFor(() => expect(screen.getByTestId("draft-control-view")).toBeInTheDocument());
    expect(screen.getByTestId("draft-join-link-not-joinable").textContent).toContain("tok12345");
    expect(screen.getByTestId("draft-join-link-badge").textContent).toMatch(/not yet joinable/i);
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
