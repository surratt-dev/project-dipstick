import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { DraftSessionHost } from "../DraftSessionHost.js";
import type { FacilitatorSessionStateResponse } from "@dipstick/shared";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

// ---------------------------------------------------------------------------
// DraftSessionHost — room open (session-topics-snapshot-at-creation #175,
// tasks.md 7.1-7.3 and 7.5; design.md Decision 7).
//
// "Open the room" silently refetches facilitator state before the
// confirmation, so the topic count it states is never stale; the 422 and
// 409 NO_ACTIVE_TOPICS paths refetch and decide from the refetched status.
// None of these refetches may replace the control view with a loading state
// or a full-page error.
// ---------------------------------------------------------------------------

const NO_TOPICS_COPY =
  "This team has no active topics. Add or restore a topic on Topic Management before opening the room.";

function confirmCopy(topics: string) {
  return (
    `Opening the room lets participants join immediately and locks in this session's ${topics} ` +
    "in their current order. Topic changes after this apply to your next session. This cannot be undone."
  );
}

function draft(activeTopicCount?: number): FacilitatorSessionStateResponse {
  return {
    sessionId: "sess-1",
    teamId: "team-1",
    currentSessionState: "draft",
    bannerState: null,
    joinToken: "tok12345",
    ...(activeTopicCount === undefined ? {} : { activeTopicCount }),
  };
}

const lobby: FacilitatorSessionStateResponse = {
  sessionId: "sess-1",
  teamId: "team-1",
  currentSessionState: "lobby",
  bannerState: null,
  joinToken: "tok12345",
};

type Step =
  | { ok?: boolean; status?: number; body?: unknown }
  | { reject: true }
  | { deferred: Promise<{ ok?: boolean; status?: number; body?: unknown }> };

function toResponse(r: { ok?: boolean; status?: number; body?: unknown }): Response {
  return {
    ok: r.ok ?? true,
    status: r.status ?? 200,
    json: () => Promise.resolve(r.body),
  } as unknown as Response;
}

function mockFetch(...steps: Step[]) {
  const fn = vi.fn();
  for (const step of steps) {
    if ("reject" in step) fn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else if ("deferred" in step) fn.mockReturnValueOnce(step.deferred.then(toResponse));
    else fn.mockResolvedValueOnce(toResponse(step));
  }
  // The roster fetch once the live view mounts, and anything unexpected.
  fn.mockResolvedValue(toResponse({ body: { participants: [] } }));
  global.fetch = fn;
  return fn;
}

function renderHost() {
  return render(
    <MemoryRouter initialEntries={["/team/team-1/session/sess-1"]}>
      <Routes>
        <Route path="/team/:teamId/session/:sessionId" element={<DraftSessionHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

function advanceCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/advance"));
}

function stateCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/facilitator-state"));
}

async function openConfirm() {
  await userEvent.click(await screen.findByTestId("open-the-room"));
  return screen.findByTestId("open-the-room-confirm");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("7.1 — the zero-topic disabled state", () => {
  it("activeTopicCount 0 disables 'Open the room' and shows the copy with a Topic Management link", async () => {
    mockFetch({ body: draft(0) });
    renderHost();

    expect(await screen.findByTestId("open-the-room")).toBeDisabled();
    expect(screen.getByTestId("open-the-room-no-topics").textContent).toContain(NO_TOPICS_COPY);
    expect(screen.getByTestId("open-the-room-no-topics-link").getAttribute("href")).toBe("/team/team-1/topics");
  });

  it("an absent activeTopicCount never shows the disabled state", async () => {
    mockFetch({ body: draft() });
    renderHost();

    expect(await screen.findByTestId("open-the-room")).not.toBeDisabled();
    expect(screen.queryByTestId("open-the-room-no-topics")).not.toBeInTheDocument();
  });
});

describe("7.2 — the confirmation refetches first", () => {
  it("states the fresh count, not the count from the initial load", async () => {
    mockFetch({ body: draft(9) }, { body: draft(6) });
    renderHost();

    await openConfirm();
    expect(screen.getByTestId("open-the-room-confirm-copy").textContent).toBe(confirmCopy("6 topics"));
  });

  it("uses the singular for one topic", async () => {
    mockFetch({ body: draft(1) }, { body: draft(1) });
    renderHost();

    await openConfirm();
    expect(screen.getByTestId("open-the-room-confirm-copy").textContent).toBe(confirmCopy("1 topic"));
  });

  it("states 9 topics for a team with 9", async () => {
    mockFetch({ body: draft(9) }, { body: draft(9) });
    renderHost();

    await openConfirm();
    expect(screen.getByTestId("open-the-room-confirm-copy").textContent).toBe(confirmCopy("9 topics"));
  });

  it("shows a pending state while checking, ignores a second click, and confirms only after the refetch returns", async () => {
    let release!: (r: { body: unknown }) => void;
    const pending = new Promise<{ body: unknown }>((resolve) => {
      release = resolve;
    });
    const fetchMock = mockFetch({ body: draft(6) }, { deferred: pending });
    renderHost();

    const button = await screen.findByTestId("open-the-room");
    await userEvent.click(button);

    expect(screen.getByTestId("open-the-room")).toBeDisabled();
    expect(screen.getByTestId("open-the-room").textContent).toBe("Checking…");
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
    // No full-page loading state while the silent refetch is in flight.
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    expect(screen.queryByText("Loading session…")).not.toBeInTheDocument();

    // A second click during "checking" fires no second refetch.
    await userEvent.click(screen.getByTestId("open-the-room"));
    expect(stateCalls(fetchMock)).toHaveLength(2);

    release({ body: draft(6) });
    expect(await screen.findByTestId("open-the-room-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("open-the-room-confirm-copy").textContent).toBe(confirmCopy("6 topics"));
    expect(stateCalls(fetchMock)).toHaveLength(2);
  });

  it("a fresh count of 0 shows the disabled state instead of the confirmation", async () => {
    mockFetch({ body: draft(3) }, { body: draft(0) });
    renderHost();

    await userEvent.click(await screen.findByTestId("open-the-room"));

    await waitFor(() => expect(screen.getByTestId("open-the-room")).toBeDisabled());
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-the-room-no-topics").textContent).toContain(NO_TOPICS_COPY);
  });

  it("a room already opened elsewhere shows the live readiness view, with no error", async () => {
    mockFetch({ body: draft(3) }, { body: lobby });
    renderHost();

    await userEvent.click(await screen.findByTestId("open-the-room"));

    expect(await screen.findByTestId("live-readiness-view")).toBeInTheDocument();
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("advance-error")).not.toBeInTheDocument();
  });

  it.each([
    ["a 5xx", { ok: false, status: 503, body: { error: { message: "unavailable" } } } as Step],
    ["a network error", { reject: true } as Step],
  ])("a failed refetch (%s) shows no confirmation and an inline, retryable error in place", async (_label, failure) => {
    const fetchMock = mockFetch({ body: draft(3) }, failure, { body: draft(3) });
    renderHost();

    await userEvent.click(await screen.findByTestId("open-the-room"));

    expect(await screen.findByTestId("advance-error")).toBeInTheDocument();
    expect(screen.queryByTestId("open-the-room-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    expect(screen.queryByTestId("draft-session-host-error")).not.toBeInTheDocument();

    // Retry: the button is live and a second attempt reaches the confirmation.
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("open-the-room"));
    expect(await screen.findByTestId("open-the-room-confirm")).toBeInTheDocument();
    expect(advanceCalls(fetchMock)).toHaveLength(0);
  });
});

describe("7.3 — advance failures", () => {
  it("a network error on the advance keeps the draft view with an inline error and a retry", async () => {
    mockFetch({ body: draft(3) }, { body: draft(3) }, { reject: true });
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    expect(await screen.findByTestId("advance-error")).toBeInTheDocument();
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
  });

  it("a 422 whose refetch shows lobby is a success: the live view, no error (double-click absorption)", async () => {
    const fetchMock = mockFetch(
      { body: draft(3) },
      { body: draft(3) },
      // The message is deliberately misleading: the decision must come from
      // the refetched status, not from the text.
      { ok: false, status: 422, body: { error: { category: "invalid_request", message: "Session cannot be advanced from status 'draft'." } } },
      { body: lobby },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    expect(await screen.findByTestId("live-readiness-view")).toBeInTheDocument();
    expect(screen.queryByTestId("advance-error")).not.toBeInTheDocument();
    expect(stateCalls(fetchMock)).toHaveLength(3);
  });

  it("a 422 whose refetch still shows draft offers an inline error and a retry", async () => {
    mockFetch(
      { body: draft(3) },
      { body: draft(3) },
      { ok: false, status: 422, body: { error: { message: "Session cannot be advanced from status 'lobby'." } } },
      { body: draft(3) },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    expect((await screen.findByTestId("advance-error")).textContent).toBe("Session cannot be advanced from status 'lobby'.");
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
  });

  it("a 422 whose refetch fails offers an inline error and a retry, not the live view", async () => {
    mockFetch(
      { body: draft(3) },
      { body: draft(3) },
      { ok: false, status: 422, body: { error: { message: "Session cannot be advanced from status 'lobby'." } } },
      { reject: true },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    expect(await screen.findByTestId("advance-error")).toBeInTheDocument();
    expect(screen.queryByTestId("live-readiness-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
  });

  it("a 409 NO_ACTIVE_TOPICS refetches and shows only the disabled-state copy, with no retry", async () => {
    mockFetch(
      { body: draft(1) },
      { body: draft(1) },
      {
        ok: false,
        status: 409,
        body: { error: { category: "precondition_failed", code: "NO_ACTIVE_TOPICS", message: NO_TOPICS_COPY } },
      },
      { body: draft(0) },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("open-the-room-no-topics")).toBeInTheDocument());
    expect(screen.queryByTestId("advance-error")).not.toBeInTheDocument();
    expect(screen.getAllByText(NO_TOPICS_COPY, { exact: false })).toHaveLength(1);
    expect(screen.getByTestId("open-the-room")).toBeDisabled();
  });

  it("a 409 whose refetch fails shows the server message inline, with no separate retry control, in place", async () => {
    mockFetch(
      { body: draft(1) },
      { body: draft(1) },
      {
        ok: false,
        status: 409,
        body: { error: { category: "precondition_failed", code: "NO_ACTIVE_TOPICS", message: "Server says no topics." } },
      },
      { ok: false, status: 500, body: null },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));

    expect((await screen.findByTestId("advance-error")).textContent).toBe("Server says no topics.");
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-control-view")).toBeInTheDocument();
    expect(screen.queryByText("Loading session…")).not.toBeInTheDocument();
    expect(screen.queryByTestId("draft-session-host-error")).not.toBeInTheDocument();
  });

  it("a 409 whose refetch fails is recoverable: the next click re-runs the confirm refetch (architect review S3)", async () => {
    const fetchMock = mockFetch(
      { body: draft(1) },
      { body: draft(1) },
      {
        ok: false,
        status: 409,
        body: { error: { category: "precondition_failed", code: "NO_ACTIVE_TOPICS", message: "Server says no topics." } },
      },
      { ok: false, status: 500, body: null },
      // The facilitator restored a topic in another tab; the next click's
      // confirm refetch sees it.
      { body: draft(2) },
    );
    renderHost();

    await openConfirm();
    await userEvent.click(screen.getByTestId("open-the-room-confirm-yes"));
    await screen.findByTestId("advance-error");

    // Not stuck disabled until a reload.
    expect(screen.getByTestId("open-the-room")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("open-the-room"));

    expect((await screen.findByTestId("open-the-room-confirm-copy")).textContent).toBe(confirmCopy("2 topics"));
    expect(stateCalls(fetchMock)).toHaveLength(4);
    expect(advanceCalls(fetchMock)).toHaveLength(1);
  });
});
