import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  bulkRestorePosts,
  deferred,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
  topicsAllGets,
} from "./topicManagementTestUtils.js";
import { canShowRestoreControls } from "../bulkRestoreCopy.js";

// ---------------------------------------------------------------------------
// bulk-restore-default-topics (#218) tasks 5.1-5.8: the "Restore default
// topics" control, dialog, result and empty-state arrangement.
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

const TRIGGER = "bulk-restore-defaults-trigger";
const SINGLE = "To bring back only some topics, restore them one at a time from the archived list.";
const FORBIDDEN = /reset|canonical|trend|history lost/i;

function withArchived(overrides = {}) {
  return makeTopics({
    active: [activeTopic("custom-1", "Custom A", { displayOrder: 1, isDefault: false })],
    archived: [
      archivedTopic("d-3", "Delivery", { displayOrder: 3 }),
      archivedTopic("d-1", "Code Quality", { displayOrder: 1 }),
      archivedTopic("d-2", "Pipeline", { displayOrder: 2 }),
    ],
    ...overrides,
  });
}

const afterRestore = () =>
  makeTopics({
    active: [
      activeTopic("custom-1", "Custom A", { displayOrder: 1, isDefault: false }),
      activeTopic("d-1", "Code Quality", { displayOrder: 2 }),
      activeTopic("d-2", "Pipeline", { displayOrder: 3 }),
      activeTopic("d-3", "Delivery", { displayOrder: 4 }),
    ],
    archived: [],
  });

const trigger = () => screen.queryByTestId(TRIGGER);
const open = () => fireEvent.click(screen.getByTestId(TRIGGER));

beforeEach(() => vi.clearAllMocks());

describe("5.1 the named single-Restore predicate", () => {
  it("is true unless the view is the read-only canonical defaults", () => {
    expect(canShowRestoreControls(false)).toBe(true);
    expect(canShowRestoreControls(true)).toBe(false);
  });

  it("single Restore still renders on archived rows", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived())] });
    await renderPage();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    expect(screen.getByTestId("restore-topic-d-1")).toBeInTheDocument();
  });
});

describe("5.3 control visibility and disabled states", () => {
  it("is shown when an archived default is restorable and the team is unlocked", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived())] });
    await renderPage();
    expect(trigger()).toHaveTextContent("Restore default topics");
    expect(trigger()).toBeEnabled();
  });

  it("is hidden when every archived default name is already active", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          withArchived({ active: [activeTopic("x", "code quality ", { displayOrder: 1 })], archived: [archivedTopic("d-1", "Code Quality")] }),
        ),
      ],
    });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
  });

  it("is hidden for archived custom topics only", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived({ archived: [archivedTopic("c-1", "Mine", { isDefault: false })] }))] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
  });

  it("is hidden on a locked team with a restorable default", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived({ isCustomizationLocked: true, lockReason: "first_session" }))] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
  });

  it("is hidden on the read-only canonical defaults", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived({ lockReason: "canonical_defaults", isCustomizationLocked: true }))] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
  });

  it("is disabled with the reason while a reorder is unsaved", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived({ active: [activeTopic("a", "A", { displayOrder: 1, isDefault: false }), activeTopic("b", "B", { displayOrder: 2, isDefault: false })] }))] });
    await renderPage();
    fireEvent.click(screen.getByTestId("move-down-a"));
    expect(trigger()).toBeDisabled();
    expect(screen.getByTestId("bulk-restore-disabled-reason")).toHaveTextContent("Save or discard your edit first.");
  });
});

describe("5.2 the dialog", () => {
  it("shows the count, names in restore order, placement and unchanged sentences, and the single-restore sentence", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived())] });
    await renderPage();
    open();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Restore default topics" })).toBeInTheDocument();
    expect(screen.getByTestId("bulk-restore-count")).toHaveTextContent("3 topics will be added");
    const names = within(screen.getByTestId("bulk-restore-list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(names).toEqual(["Code Quality", "Pipeline", "Delivery"]);
    expect(screen.getByTestId("bulk-restore-placement")).toHaveTextContent("They will be added to the end of your list, in the order shown.");
    expect(dialog).toHaveTextContent("Your custom topics, the current order, and annotations are not changed.");
    expect(screen.getByTestId("bulk-restore-single-sentence")).toHaveTextContent(SINGLE);
    expect(dialog.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getByTestId("bulk-restore-list")).toHaveAttribute("tabindex", "0");
  });

  it("singular count and placement", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived({ archived: [archivedTopic("d-1", "Code Quality")] }))] });
    await renderPage();
    open();
    expect(screen.getByTestId("bulk-restore-count")).toHaveTextContent("1 topic will be added");
    expect(screen.getByTestId("bulk-restore-placement")).toHaveTextContent("It will be added to the end of your list.");
  });

  it("lists a name-matched default under Not restored with the literal line", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          withArchived({
            active: [activeTopic("x", "pipeline ", { displayOrder: 1, isDefault: false })],
          }),
        ),
      ],
    });
    await renderPage();
    open();
    expect(screen.getByTestId("bulk-restore-count")).toHaveTextContent("2 topics will be added");
    expect(screen.getByTestId("bulk-restore-skipped")).toHaveTextContent("Pipeline: a topic with this name is already in your list");
  });

  it("moves focus into the dialog, and Cancel closes it and returns focus to the control", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived())] });
    await renderPage();
    open();
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.click(screen.getByTestId("bulk-restore-cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("traps Tab inside the dialog", async () => {
    installFetch({ gets: [mockFetchResponse(withArchived())] });
    await renderPage();
    open();
    const cancel = screen.getByTestId("bulk-restore-cancel");
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(screen.getByTestId("bulk-restore-list")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("bulk-restore-list"), { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });
});

describe("5.4 submit and double activation", () => {
  it("one request on confirm, none before; a second activation sends no second request", async () => {
    const gate = deferred<Response>();
    const fetchMock = installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(afterRestore())],
      bulkRestores: [gate.promise],
    });
    await renderPage();
    open();
    expect(bulkRestorePosts(fetchMock)).toHaveLength(0);

    const confirm = screen.getByTestId("bulk-restore-confirm");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(bulkRestorePosts(fetchMock)).toHaveLength(1);
    expect(bulkRestorePosts(fetchMock)[0]![1]).toEqual({ method: "POST", credentials: "include" });

    await act(async () => {
      gate.resolve(mockFetchResponse({ restored: [], skipped: [] }));
    });
    expect(bulkRestorePosts(fetchMock)).toHaveLength(1);
  });
});

describe("5.5 result rendering", () => {
  const restored = [
    { topicId: "d-1", name: "Code Quality", displayOrder: 2 },
    { topicId: "d-2", name: "Pipeline", displayOrder: 3 },
    { topicId: "d-3", name: "Delivery", displayOrder: 4 },
  ];

  it("restored only: the count line, names with positions, a refetch, dialog closed", async () => {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(afterRestore())],
      bulkRestores: [mockFetchResponse({ restored, skipped: [] })],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));

    await waitFor(() => expect(screen.getByTestId("bulk-restore-result-line")).toHaveTextContent("Restored 3 topics. They are at the end of your list."));
    expect(screen.getByTestId("bulk-restore-result-restored")).toHaveTextContent("Code Quality (position 2)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(topicsAllGets(fetchMock)).toHaveLength(2);
    expect(screen.getByTestId("bulk-restore-result")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("bulk-restore-result").textContent).not.toMatch(FORBIDDEN);
  });

  it("singular", async () => {
    installFetch({
      gets: [mockFetchResponse(withArchived({ archived: [archivedTopic("d-1", "Code Quality")] })), mockFetchResponse(afterRestore())],
      bulkRestores: [mockFetchResponse({ restored: [restored[0]], skipped: [] })],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-restore-result-line")).toHaveTextContent("Restored 1 topic. It is at the end of your list."));
  });

  it("restored plus skipped shows the skipped line", async () => {
    installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(afterRestore())],
      bulkRestores: [
        mockFetchResponse({
          restored,
          skipped: [{ topicId: "s", name: "Old", reason: "NAME_ACTIVE" }, { topicId: "u", name: "Odd", reason: "FUTURE_REASON" }],
        }),
      ],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() => screen.getByTestId("bulk-restore-result-skipped"));
    const skipped = screen.getByTestId("bulk-restore-result-skipped");
    expect(skipped).toHaveTextContent("Old: a topic with this name is already in your list");
    expect(skipped).toHaveTextContent("Odd: not restored");
  });

  it("empty 200 shows Nothing to restore. and no success line", async () => {
    installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(makeTopics())],
      bulkRestores: [mockFetchResponse({ restored: [], skipped: [] })],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-restore-result-line")).toHaveTextContent("Nothing to restore."));
    expect(screen.queryByTestId("bulk-restore-result-restored")).not.toBeInTheDocument();
  });

  it("stale preview: the server restores fewer than previewed, so the delta line reports the server's outcome", async () => {
    installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(afterRestore())],
      bulkRestores: [mockFetchResponse({ restored: restored.slice(1), skipped: [] })],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-restore-result-line")).toHaveTextContent("Restored 2 of 3 topics. The list changed after you opened this dialog."),
    );
    expect(screen.getByTestId("bulk-restore-result-restored")).not.toHaveTextContent("Code Quality");
  });
});

describe("5.6 error mapping and close-and-refetch", () => {
  async function failWith(res: Response, secondGet = makeTopics()) {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(withArchived()), mockFetchResponse(secondGet)],
      bulkRestores: [res],
    });
    await renderPage();
    open();
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    return fetchMock;
  }

  it("403 FACILITATOR_IS_TEAM_MEMBER closes, shows the server message and refetches", async () => {
    const fetchMock = await failWith(envelope(403, "FACILITATOR_IS_TEAM_MEMBER", "A facilitator cannot restore default topics for a team they are a member of."));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("cannot restore default topics for a team they are a member of"));
    await waitFor(() => expect(topicsAllGets(fetchMock)).toHaveLength(2));
  });

  it("404 closes, shows the not-found copy and refetches", async () => {
    const fetchMock = await failWith(envelope(404, "TEAM_NOT_FOUND", "Team not found."));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("Team not found."));
    await waitFor(() => expect(topicsAllGets(fetchMock)).toHaveLength(2));
  });

  it("409 shows the locked notice and refetches", async () => {
    const fetchMock = await failWith(envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "x"));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("Topics cannot be customized until this team's first session is completed."));
    await waitFor(() => expect(topicsAllGets(fetchMock)).toHaveLength(2));
  });

  it("429 shows the rate-limit message with no refetch, and the control stays for a retry", async () => {
    const fetchMock = await failWith(envelope(429, "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED", "Daily limit reached."));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("Daily limit reached."));
    expect(topicsAllGets(fetchMock)).toHaveLength(1);
    expect(trigger()).toBeInTheDocument();
  });

  it("500 shows the generic failure notice with no refetch", async () => {
    const fetchMock = await failWith(envelope(500, "INTERNAL_ERROR", "boom"));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("The default topics couldn't be restored. Try again."));
    expect(topicsAllGets(fetchMock)).toHaveLength(1);
  });
});

describe("5.7 empty state", () => {
  const emptyRestorable = (overrides = {}) =>
    makeTopics({ active: [], archived: [archivedTopic("d-1", "Code Quality"), archivedTopic("d-2", "Pipeline", { displayOrder: 2 })], ...overrides });

  it("empty team with restorable archived defaults: bulk restore is primary (first), Assign is secondary with fresh-copies copy for an admin", async () => {
    installFetch({ gets: [mockFetchResponse(emptyRestorable({ canAssignDefaults: true }))] });
    await renderPage();
    const actions = screen.getByTestId("active-topics-empty-actions");
    const buttons = within(actions).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Restore default topics");
    expect(buttons.some((b) => /^Assign default topics/.test(b.textContent ?? ""))).toBe(true);
    expect(screen.getByTestId("empty-state-assign-copy")).toHaveTextContent(
      "Assign default topics creates new copies of the default topics; it does not bring back the originals or their history.",
    );
  });

  it("a non-admin facilitator sees the bulk control and no Assign", async () => {
    installFetch({ gets: [mockFetchResponse(emptyRestorable({ canAssignDefaults: false }))] });
    await renderPage();
    expect(screen.getByTestId("empty-state-bulk-restore")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Assign default topics/ })).not.toBeInTheDocument();
  });

  it("empty team with nothing restorable: the existing path, no bulk control", async () => {
    installFetch({
      gets: [mockFetchResponse(emptyRestorable({ archived: [archivedTopic("c", "Mine", { isDefault: false })] }))],
    });
    await renderPage();
    expect(screen.queryByTestId("empty-state-bulk-restore")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Show archived topics/ })).toBeInTheDocument();
  });

  it("the empty-state control opens the same dialog and restores", async () => {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(emptyRestorable()), mockFetchResponse(afterRestore())],
      bulkRestores: [mockFetchResponse({ restored: [{ topicId: "d-1", name: "Code Quality", displayOrder: 1 }, { topicId: "d-2", name: "Pipeline", displayOrder: 2 }], skipped: [] })],
    });
    await renderPage();
    fireEvent.click(screen.getByTestId("empty-state-bulk-restore"));
    expect(screen.getByTestId("bulk-restore-count")).toHaveTextContent("2 topics will be added");
    fireEvent.click(screen.getByTestId("bulk-restore-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-restore-result-line")).toHaveTextContent("Restored 2 topics"));
    expect(bulkRestorePosts(fetchMock)).toHaveLength(1);
  });
});
