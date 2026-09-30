import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { TopicManagementPage } from "../TopicManagementPage.js";
import type { GetAllTopicsResponse, ReorderTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage reorder controls — reorder-topics, design.md
// Decision 8, tasks.md Sections 7-8 (specs/topic-management-screen/spec.md).
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "facilitator-1", displayName: "Marcus", email: "marcus@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

const NAMES = [
  "Warm-up",
  "Deployment",
  "Pipeline",
  "Pairing",
  "Tech Debt",
  "Mission",
  "Fun",
  "Learning",
  "Speed",
  "Health",
  "Support",
];
const IDS = NAMES.map((_, i) => `topic-${i + 1}`);
// Stored displayOrder values are deliberately 0-based and gapped: position
// numbers must come from the rendered index, never from these.
const STORED_ORDERS = [0, 1, 2, 5, 6, 9, 10, 14, 15, 20, 21];

function makeTopics(ids: string[] = IDS): GetAllTopicsResponse {
  return {
    teamId: "team-1",
    teamName: "Platform Squad",
    isCustomizationLocked: false,
    active: ids.map((id, i) => ({
      topicId: id,
      name: NAMES[IDS.indexOf(id)]!,
      prompt: `Prompt for ${id}`,
      voteType: "finger" as const,
      displayOrder: STORED_ORDERS[i] ?? i,
      isDefault: false,
      firstSessionDescription: null,
      teamAnnotation: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })),
    archived: [
      {
        topicId: "topic-old",
        name: "Old Topic",
        prompt: "An old prompt",
        voteType: "finger",
        isDefault: false,
        archivedAt: "2026-08-01T12:00:00.000Z",
        archivedBy: null,
        restoredAt: null,
        restoredBy: null,
      },
    ],
    defaultTopicsNotActive: [],
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function reorderResponse(ids: string[], openSessionCreatedAt: string | null = null): ReorderTopicsResponse {
  return {
    topics: ids.map((id, i) => ({ topicId: id, name: NAMES[IDS.indexOf(id)]!, displayOrder: i + 1 })),
    openSessionCreatedAt,
  };
}

/**
 * Route-aware fetch mock: GET /topics/all answers from `gets` in turn (the
 * last entry repeats), PUT /topics/order from `puts` in turn.
 */
function installFetch(opts: {
  gets?: Array<Response | Error>;
  puts?: Array<Response | Error | Promise<Response>>;
}) {
  const gets = opts.gets ?? [mockFetchResponse(makeTopics())];
  const puts = opts.puts ?? [];
  let getIndex = 0;
  let putIndex = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const next = puts[putIndex++];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? mockFetchResponse({}, 500));
    }
    if (url.endsWith("/topics/all")) {
      const next = gets[Math.min(getIndex++, gets.length - 1)]!;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    }
    return Promise.resolve(mockFetchResponse({}, 404));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function putCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
}

function getAllCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([url, init]) => !init?.method && String(url).endsWith("/topics/all"));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/team/team-1/topics"]}>
      <Routes>
        <Route path="/team/:teamId/topics" element={<TopicManagementPage />} />
        <Route
          path="/team/:teamId"
          element={
            <div>
              Team Page <Link to="/team/team-1/topics">Manage topics</Link>
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  renderPage();
  await waitFor(() => screen.getByTestId("topic-row-topic-1"));
}

/** Displayed order of active topic IDs, read from the DOM. */
function displayedIds(): string[] {
  return screen
    .getAllByTestId(/^topic-row-/)
    .map((row) => row.getAttribute("data-testid")!.replace("topic-row-", ""));
}

function moveButton(label: string, name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}: ${name}$`) });
}

function allMoveButtons() {
  return screen.getAllByRole("button", { name: /^Move (to top|up|down|to bottom): / });
}

function click(label: string, name: string) {
  fireEvent.click(moveButton(label, name));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Task 8.1 — rendering and moves
// ---------------------------------------------------------------------------
describe("reorder controls — rendering and moves", () => {
  it("shows positions 1..11 from the rendered order, not the gapped stored displayOrder", async () => {
    installFetch({});
    await renderLoaded();

    IDS.forEach((id, i) => {
      expect(screen.getByTestId(`topic-position-${id}`).textContent).toBe(`${i + 1}.`);
    });
  });

  it("shows four move buttons per row whose accessible names include the topic name", async () => {
    installFetch({});
    await renderLoaded();

    expect(allMoveButtons()).toHaveLength(44);
    expect(screen.getByRole("button", { name: /Move up.*Deployment/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move down.*Deployment/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move to top.*Deployment/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move to bottom.*Deployment/ })).toBeInTheDocument();
  });

  it("renders boundary buttons disabled, not hidden", async () => {
    installFetch({});
    await renderLoaded();

    expect(moveButton("Move to top", "Warm-up")).toBeDisabled();
    expect(moveButton("Move up", "Warm-up")).toBeDisabled();
    expect(moveButton("Move down", "Warm-up")).toBeEnabled();
    expect(moveButton("Move down", "Support")).toBeDisabled();
    expect(moveButton("Move to bottom", "Support")).toBeDisabled();
    expect(moveButton("Move up", "Support")).toBeEnabled();
  });

  it("shows no reorder UI and no Save order control for a locked team", async () => {
    installFetch({ gets: [mockFetchResponse({ ...makeTopics(), isCustomizationLocked: true })] });
    await renderLoaded();

    expect(screen.queryAllByRole("button", { name: /^Move / })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("topic-position-topic-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reorder-order-copy")).not.toBeInTheDocument();
  });

  it("shows no reorder UI for a team with one active topic", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics(["topic-1"]))] });
    await renderLoaded();

    expect(screen.queryAllByRole("button", { name: /^Move / })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
  });

  it("Move to top from position 7 shifts rows 1-6 down and sends no request", async () => {
    const fetchMock = installFetch({});
    await renderLoaded();

    click("Move to top", "Fun");

    expect(displayedIds()).toEqual(["topic-7", ...IDS.slice(0, 6), ...IDS.slice(7)]);
    expect(screen.getByTestId("topic-position-topic-7").textContent).toBe("1.");
    expect(screen.getByTestId("topic-position-topic-1").textContent).toBe("2.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Move to bottom from position 1 lands at position 11", async () => {
    installFetch({});
    await renderLoaded();

    click("Move to bottom", "Warm-up");

    expect(displayedIds()).toEqual([...IDS.slice(1), "topic-1"]);
    expect(screen.getByTestId("topic-position-topic-1").textContent).toBe("11.");
  });

  it("moving down then up leaves the draft clean with Save order disabled", async () => {
    installFetch({});
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();

    click("Move down", "Deployment");
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
    click("Move up", "Deployment");

    expect(displayedIds()).toEqual(IDS);
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    expect(screen.queryByTestId("reorder-locked-reason")).not.toBeInTheDocument();
  });

  it("Discard reverts to the saved order without a request", async () => {
    const fetchMock = installFetch({});
    await renderLoaded();

    click("Move to bottom", "Warm-up");
    click("Move to top", "Health");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(displayedIds()).toEqual(IDS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the pinned order copy with the reorder controls", async () => {
    installFetch({});
    await renderLoaded();

    expect(
      screen.getByText(
        "Order changes apply to sessions created after you save. Sessions already created keep their order.",
      ),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — Save
// ---------------------------------------------------------------------------
describe("reorder controls — save", () => {
  it("sends one PUT with every active ID in displayed order, patches the list without a refetch, and confirms", async () => {
    const newOrder = ["topic-2", "topic-1", ...IDS.slice(2)];
    const fetchMock = installFetch({ puts: [mockFetchResponse(reorderResponse(newOrder))] });
    await renderLoaded();

    click("Move up", "Deployment");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Order saved."));
    const puts = putCalls(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0]![0]).toBe("/api/v1/teams/team-1/topics/order");
    expect(JSON.parse(puts[0]![1]!.body as string)).toEqual({ orderedTopicIds: newOrder });
    expect(getAllCalls(fetchMock)).toHaveLength(1);
    expect(displayedIds()).toEqual(newOrder);
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();

    // The confirmation stays until the next move.
    click("Move down", "Deployment");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("names the open session's creation date in place of the plain confirmation", async () => {
    const newOrder = ["topic-2", "topic-1", ...IDS.slice(2)];
    installFetch({ puts: [mockFetchResponse(reorderResponse(newOrder, "2026-09-30T12:00:00.000Z"))] });
    await renderLoaded();

    click("Move up", "Deployment");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Order saved. The session created on Sep 30, 2026 keeps its original order.",
      ),
    );
    expect(screen.queryByText("Order saved.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 8.3 — interaction locking
// ---------------------------------------------------------------------------
describe("reorder controls — interaction locking", () => {
  async function openArchived() {
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    await waitFor(() => screen.getByTestId("restore-topic-topic-old"));
  }

  it("disables Remove and Restore with the reason while dirty, and re-enables them after Discard", async () => {
    installFetch({});
    await renderLoaded();
    await openArchived();

    click("Move down", "Warm-up");

    expect(screen.getByText("Save or discard your order changes first.")).toBeInTheDocument();
    expect(screen.getByTestId("remove-topic-topic-1")).toBeDisabled();
    expect(screen.getByTestId("restore-topic-topic-old")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText("Save or discard your order changes first.")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-topic-topic-1")).toBeEnabled();
    expect(screen.getByTestId("restore-topic-topic-old")).toBeEnabled();
  });

  it("keeps everything locked while a save is in flight, then re-enables Remove and Restore after it succeeds", async () => {
    let resolvePut!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const newOrder = ["topic-2", "topic-1", ...IDS.slice(2)];
    installFetch({ puts: [pending] });
    await renderLoaded();
    await openArchived();

    click("Move up", "Deployment");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    allMoveButtons().forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByTestId("remove-topic-topic-1")).toBeDisabled();
    expect(screen.getByTestId("restore-topic-topic-old")).toBeDisabled();

    resolvePut(mockFetchResponse(reorderResponse(newOrder)));

    await waitFor(() => expect(screen.getByTestId("remove-topic-topic-1")).toBeEnabled());
    expect(screen.getByTestId("restore-topic-topic-old")).toBeEnabled();
  });

  it("disables every move button, Save, and Discard while a Remove dialog is open", async () => {
    installFetch({});
    await renderLoaded();

    fireEvent.click(screen.getByTestId("remove-topic-topic-3"));

    allMoveButtons().forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();

    fireEvent.click(screen.getByTestId("cancel-remove-topic-3"));
    expect(moveButton("Move down", "Warm-up")).toBeEnabled();
  });

  it("disables every move button, Save, and Discard while a Restore dialog is open", async () => {
    installFetch({});
    await renderLoaded();
    await openArchived();

    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));

    allMoveButtons().forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("re-enables Remove and Restore after Reload following a stale save", async () => {
    installFetch({
      puts: [mockFetchResponse({ error: { code: "TOPIC_ORDER_STALE", message: "stale" } }, 409)],
    });
    await renderLoaded();
    await openArchived();

    click("Move down", "Warm-up");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByTestId("remove-topic-topic-1")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(screen.getByTestId("remove-topic-topic-1")).toBeEnabled());
    expect(screen.getByTestId("restore-topic-topic-old")).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Task 8.4 — stale save
// ---------------------------------------------------------------------------
describe("reorder controls — stale save", () => {
  const STALE = mockFetchResponse(
    { error: { category: "precondition_failed", code: "TOPIC_ORDER_STALE", message: "changed" } },
    409,
  );
  // The recovery fetch returns an order different from the initial load.
  const serverOrder = [...IDS].reverse();
  const refreshed = mockFetchResponse(makeTopics(serverOrder));

  async function goStale() {
    click("Move to top", "Support");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByText("The topic list was changed elsewhere since you opened this page.")).toBeInTheDocument(),
    );
  }

  it("explains the stale save, keeps the draft, disables Save and moves, and Reload resets to the server order", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics()), refreshed], puts: [STALE] });
    await renderLoaded();

    await goStale();

    expect(displayedIds()).toEqual(["topic-11", ...IDS.slice(0, 10)]);
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    allMoveButtons().forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(displayedIds()).toEqual(serverOrder));
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    expect(screen.queryByText("The topic list was changed elsewhere since you opened this page.")).not.toBeInTheDocument();
  });

  it("announces the stale message to assistive technology as an alert", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics()), refreshed], puts: [STALE] });
    await renderLoaded();

    await goStale();

    const message = screen.getByTestId("reorder-stale-message");
    expect(message).toHaveAttribute("role", "alert");
    expect(screen.getAllByRole("alert")).toContain(message);
  });

  it("Discard after a stale save goes to the server's current order, not the initially loaded one", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics()), refreshed], puts: [STALE] });
    await renderLoaded();

    await goStale();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(displayedIds()).toEqual(serverOrder));
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
  });

  it("a failed Reload stays stale, shows the reload error, keeps the list, and keeps Reload enabled", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics()), mockFetchResponse({}, 500)], puts: [STALE] });
    await renderLoaded();

    await goStale();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(screen.getByTestId("reorder-save-error").textContent).toBe("Unable to reload topics."));
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
    expect(displayedIds()).toEqual(["topic-11", ...IDS.slice(0, 10)]);
    expect(screen.getByText("The topic list was changed elsewhere since you opened this page.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Task 8.5 — every other save failure
// ---------------------------------------------------------------------------
describe("reorder controls — other save failures", () => {
  it.each([
    ["a 500 without a message", mockFetchResponse({}, 500) as Response | Error],
    ["a network error", new Error("offline") as Response | Error],
  ])("%s shows the fallback, keeps the list and the dirty draft, and does not retry", async (_label, failure) => {
    const fetchMock = installFetch({ puts: [failure] });
    await renderLoaded();

    click("Move down", "Warm-up");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    const alert = await screen.findByTestId("reorder-save-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toBe("Unable to save the topic order.");
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
    expect(displayedIds()).toEqual(["topic-2", "topic-1", ...IDS.slice(2)]);
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
    expect(putCalls(fetchMock)).toHaveLength(1);
  });

  it("a 500 with a server message shows that message", async () => {
    installFetch({ puts: [mockFetchResponse({ error: { message: "Something broke on our side." } }, 500)] });
    await renderLoaded();

    click("Move down", "Warm-up");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    expect((await screen.findByTestId("reorder-save-error")).textContent).toBe("Something broke on our side.");
  });

  it("clears the save error on the next move, and keeps Save usable for the changed draft", async () => {
    const fetchMock = installFetch({ puts: [mockFetchResponse({}, 500)] });
    await renderLoaded();

    click("Move down", "Warm-up");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await screen.findByTestId("reorder-save-error");

    click("Move to top", "Support");

    expect(screen.queryByTestId("reorder-save-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
    expect(putCalls(fetchMock)).toHaveLength(1);
  });

  it("403 FACILITATOR_IS_TEAM_MEMBER shows the server's message and keeps the draft", async () => {
    const message = "A facilitator cannot reorder topics for a team they are a member of.";
    installFetch({
      puts: [mockFetchResponse({ error: { code: "FACILITATOR_IS_TEAM_MEMBER", message } }, 403)],
    });
    await renderLoaded();

    click("Move to bottom", "Warm-up");
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    expect((await screen.findByTestId("reorder-save-error")).textContent).toBe(message);
    expect(displayedIds()).toEqual([...IDS.slice(1), "topic-1"]);
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Task 8.6 — announcements and focus
// ---------------------------------------------------------------------------
describe("reorder controls — announcements and focus", () => {
  it("announces each move and keeps focus on Move down of the moved row", async () => {
    installFetch({});
    await renderLoaded();
    const liveRegion = screen.getByTestId("reorder-announcement");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");

    moveButton("Move down", "Deployment").focus();
    click("Move down", "Deployment");

    expect(liveRegion.textContent).toBe("Deployment moved to position 3 of 11");
    expect(document.activeElement).toBe(moveButton("Move down", "Deployment"));

    click("Move to bottom", "Warm-up");
    expect(liveRegion.textContent).toBe("Warm-up moved to position 11 of 11");
  });

  it("falls back to an enabled move button in the same row after Move to top", async () => {
    installFetch({});
    await renderLoaded();

    click("Move to top", "Tech Debt");

    const row = screen.getByTestId("topic-row-topic-5");
    expect(row.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBeDisabled();
    expect(document.activeElement).toBe(within(row).getByRole("button", { name: "Move down: Tech Debt" }));
  });
});

// ---------------------------------------------------------------------------
// Task 7.2 — beforeunload-only guard
// ---------------------------------------------------------------------------
describe("reorder controls — unsaved-draft guard", () => {
  function dispatchBeforeUnload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it("prevents beforeunload only while the draft is dirty, and registers no listener while clean", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    installFetch({});
    await renderLoaded();

    expect(addSpy.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    click("Move down", "Warm-up");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("leaving by an in-app link with a dirty draft shows no prompt, and returning shows the saved order", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    installFetch({});
    await renderLoaded();

    click("Move to bottom", "Warm-up");
    fireEvent.click(screen.getByTestId("back-to-team-page"));
    await waitFor(() => screen.getByText("Manage topics"));
    fireEvent.click(screen.getByText("Manage topics"));
    await waitFor(() => screen.getByTestId("topic-row-topic-1"));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(displayedIds()).toEqual(IDS);
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
  });
});
