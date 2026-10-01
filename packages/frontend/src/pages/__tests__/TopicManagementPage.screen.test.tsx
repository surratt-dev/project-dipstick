import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  deferred,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
  topicsAllGets,
  unparseableResponse,
} from "./topicManagementTestUtils.js";

// ---------------------------------------------------------------------------
// TopicManagementPage — topic-add-form-and-empty-state, tasks.md sections 2
// and 3: the screen message region, quiet refetches after Remove/Restore,
// latest-issued refetch wins, team-change reset, row headings, the "Custom"
// tag, and the counted Active Topics heading.
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

const ARCHIVED_FAILED = "Archived 'Pairing Effectiveness', but the list couldn't be refreshed. Reload the page to see it.";
const RESTORED_FAILED = "Restored 'Codebase Health', but the list couldn't be refreshed. Reload the page to see it.";

const archiveOk = () => mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" });
const restoreOk = () =>
  mockFetchResponse({ topicId: "topic-old", name: "Codebase Health", status: "active", displayOrder: 3, restoredAt: "2026-10-01T00:00:00.000Z" });

const threeActive = () =>
  makeTopics({
    active: [
      activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1 }),
      activeTopic("topic-2", "Pipeline", { displayOrder: 2 }),
      activeTopic("topic-3", "Deploys", { displayOrder: 3 }),
    ],
  });

async function removeTopic1() {
  fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
  fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));
}

async function restoreArchived() {
  fireEvent.click(screen.getByTestId("toggle-archived-topics"));
  fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
  fireEvent.click(screen.getByTestId("confirm-restore-topic-old"));
}

async function showArchivedFailedMessage() {
  await removeTopic1();
  await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent(ARCHIVED_FAILED));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Task 2.3 / 2.5 — Remove and Restore refetch quietly
// ---------------------------------------------------------------------------
describe("refetches after Remove or Restore never replace the screen", () => {
  it("a refetch failure after Remove shows the inline alert and keeps the screen", async () => {
    installFetch({ gets: [mockFetchResponse(threeActive()), mockFetchResponse({}, 500)], removes: [archiveOk()] });
    await renderPage();

    await removeTopic1();

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent(ARCHIVED_FAILED);
    expect(screen.getByTestId("topic-management-view")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-topic-dialog")).not.toBeInTheDocument();
  });

  it("a refetch failure after Restore shows the inline alert and keeps the screen", async () => {
    installFetch({ gets: [mockFetchResponse(threeActive()), new Error("offline")], restores: [restoreOk()] });
    await renderPage();

    await restoreArchived();

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent(RESTORED_FAILED));
    expect(screen.getByTestId("screen-message")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("restore-topic-dialog")).not.toBeInTheDocument();
  });

  it("the archived row stays as last loaded, and a second Remove reports the server's 422 message", async () => {
    installFetch({
      gets: [mockFetchResponse(threeActive()), mockFetchResponse({}, 500)],
      removes: [archiveOk(), envelope(422, "TOPIC_ALREADY_ARCHIVED", "This topic is already archived.")],
    });
    await renderPage();

    await showArchivedFailedMessage();
    expect(screen.getByTestId("topic-row-topic-1")).toBeInTheDocument();

    await removeTopic1();
    await waitFor(() =>
      expect(screen.getByTestId("remove-error-topic-1")).toHaveTextContent("This topic is already archived."),
    );
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
  });

  it("a Remove failure with an unparseable body shows 'Unable to archive this topic.'", async () => {
    installFetch({ removes: [unparseableResponse(502)] });
    await renderPage();

    await removeTopic1();

    await waitFor(() => expect(screen.getByTestId("remove-error-topic-1")).toHaveTextContent("Unable to archive this topic."));
  });

  it("moves stay disabled, and the dialog submitting, until the post-Remove refetch settles", async () => {
    const refetch = deferred<Response>();
    installFetch({ gets: [mockFetchResponse(threeActive()), refetch.promise], removes: [archiveOk()] });
    await renderPage();

    await removeTopic1();
    await waitFor(() => expect(topicsAllGets(global.fetch as never)).toHaveLength(2));

    expect(screen.getByTestId("confirm-remove-topic-1")).toHaveTextContent("Archiving…");
    expect(screen.getByTestId("move-down-topic-2")).toBeDisabled();
    expect(screen.getByTestId("move-up-topic-3")).toBeDisabled();

    await act(async () => {
      refetch.resolve(
        mockFetchResponse(
          makeTopics({
            active: [activeTopic("topic-2", "Pipeline"), activeTopic("topic-3", "Deploys")],
          }),
        ),
      );
    });

    await waitFor(() => expect(screen.queryByTestId("remove-topic-dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("topic-row-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("move-down-topic-2")).toBeEnabled();
  });

  it("the latest-issued refetch wins: a superseded post-Remove refetch applies nothing, shows no failure, and closes the dialog", async () => {
    const removeRefetch = deferred<Response>();
    const older = makeTopics({ active: [activeTopic("topic-2", "Pipeline"), activeTopic("topic-3", "Deploys")] });
    const newer = makeTopics({
      active: [
        activeTopic("topic-2", "Pipeline"),
        activeTopic("topic-3", "Deploys"),
        activeTopic("topic-old", "Codebase Health", { isDefault: true }),
      ],
      archived: [archivedTopic("topic-1", "Pairing Effectiveness")],
    });
    installFetch({
      gets: [mockFetchResponse(threeActive()), removeRefetch.promise, mockFetchResponse(newer)],
      removes: [archiveOk()],
      restores: [restoreOk()],
    });
    await renderPage();

    await removeTopic1();
    await waitFor(() => expect(topicsAllGets(global.fetch as never)).toHaveLength(2));
    // While the Remove's refetch is pending, a Restore issues a newer one.
    await restoreArchived();
    await waitFor(() => expect(screen.getByTestId("topic-row-topic-old")).toBeInTheDocument());

    // The older (Remove's) refetch resolves last, with a different list.
    await act(async () => {
      removeRefetch.resolve(mockFetchResponse(older));
    });

    await waitFor(() => expect(screen.queryByTestId("remove-topic-dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("topic-row-topic-old")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't be refreshed/)).not.toBeInTheDocument();
  });

  // Implementation review S1: the first call's completion must not close a
  // second dialog whose write is still in flight.
  it("a first Remove's completion does not close a second Remove still in flight; moves stay locked until it settles", async () => {
    const refetchA = deferred<Response>();
    const deleteB = deferred<Response>();
    const refetchB = deferred<Response>();
    installFetch({
      gets: [mockFetchResponse(threeActive()), refetchA.promise, refetchB.promise],
      removes: [archiveOk(), deleteB.promise],
    });
    await renderPage();

    await removeTopic1();
    await waitFor(() => expect(topicsAllGets(global.fetch as never)).toHaveLength(2));

    // While A's refetch is pending, Remove B is confirmed and its DELETE hangs.
    fireEvent.click(screen.getByTestId("remove-topic-topic-2"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-2"));
    await waitFor(() => expect(screen.getByTestId("confirm-remove-topic-2")).toHaveTextContent("Archiving…"));

    await act(async () => {
      refetchA.resolve(mockFetchResponse(makeTopics({ active: [activeTopic("topic-2", "Pipeline"), activeTopic("topic-3", "Deploys")] })));
    });
    await waitFor(() => expect(screen.queryByTestId("topic-row-topic-1")).not.toBeInTheDocument());

    // B's dialog is still open and submitting; moves stay disabled.
    expect(screen.getByTestId("confirm-remove-topic-2")).toHaveTextContent("Archiving…");
    expect(screen.getByTestId("move-up-topic-3")).toBeDisabled();

    await act(async () => {
      deleteB.resolve(mockFetchResponse({ topicId: "topic-2", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" }));
    });
    await waitFor(() => expect(topicsAllGets(global.fetch as never)).toHaveLength(3));
    expect(screen.getByTestId("confirm-remove-topic-2")).toHaveTextContent("Archiving…");

    await act(async () => {
      refetchB.resolve(
        mockFetchResponse(
          makeTopics({ active: [activeTopic("topic-3", "Deploys"), activeTopic("topic-4", "Ownership", { displayOrder: 2 })] }),
        ),
      );
    });
    await waitFor(() => expect(screen.queryByTestId("remove-topic-dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("move-down-topic-3")).toBeEnabled();
  });

  it("a first Restore's completion does not close a second Restore still in flight", async () => {
    const twoArchived = () =>
      makeTopics({
        active: threeActive().active,
        archived: [archivedTopic("topic-old", "Codebase Health"), archivedTopic("topic-older", "Flow")],
      });
    const refetchA = deferred<Response>();
    const restoreB = deferred<Response>();
    const refetchB = deferred<Response>();
    installFetch({
      gets: [mockFetchResponse(twoArchived()), refetchA.promise, refetchB.promise],
      restores: [restoreOk(), restoreB.promise],
    });
    await renderPage();

    await restoreArchived();
    await waitFor(() => expect(topicsAllGets(global.fetch as never)).toHaveLength(2));

    fireEvent.click(screen.getByTestId("restore-topic-topic-older"));
    fireEvent.click(screen.getByTestId("confirm-restore-topic-older"));
    await waitFor(() => expect(screen.getByTestId("confirm-restore-topic-older")).toHaveTextContent("Restoring…"));

    await act(async () => {
      refetchA.resolve(
        mockFetchResponse(
          makeTopics({
            active: [...threeActive().active, activeTopic("topic-old", "Codebase Health", { displayOrder: 4 })],
            archived: [archivedTopic("topic-older", "Flow")],
          }),
        ),
      );
    });
    await waitFor(() => expect(screen.getByTestId("topic-row-topic-old")).toBeInTheDocument());

    expect(screen.getByTestId("confirm-restore-topic-older")).toHaveTextContent("Restoring…");
    expect(screen.getByTestId("move-up-topic-3")).toBeDisabled();

    await act(async () => {
      restoreB.resolve(
        mockFetchResponse({ topicId: "topic-older", name: "Flow", status: "active", displayOrder: 5, restoredAt: "2026-10-01T00:00:00.000Z" }),
      );
    });
    await act(async () => {
      refetchB.resolve(mockFetchResponse(makeTopics({ active: threeActive().active, archived: [] })));
    });
    await waitFor(() => expect(screen.queryByTestId("restore-topic-dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("move-up-topic-3")).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Task 2.1 — screen message region
// ---------------------------------------------------------------------------
describe("the screen message region", () => {
  function setup() {
    installFetch({ gets: [mockFetchResponse(threeActive()), mockFetchResponse({}, 500)], removes: [archiveOk()] });
    return renderPage();
  }

  it("sits directly under the Active Topics heading and persists while focus moves", async () => {
    await setup();
    await showArchivedFailedMessage();

    const heading = screen.getByRole("heading", { level: 2, name: /^Active Topics/ });
    const region = screen.getByTestId("screen-message");
    // The region follows the heading row and precedes the active list.
    expect(heading.parentElement?.nextElementSibling).toBe(region);
    expect(region.compareDocumentPosition(screen.getByTestId("topic-row-topic-2")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    screen.getByTestId("toggle-archived-topics").focus();
    screen.getByTestId("move-down-topic-2").focus();
    expect(screen.getByTestId("screen-message")).toHaveTextContent(ARCHIVED_FAILED);
  });

  it("is cleared by a move", async () => {
    await setup();
    await showArchivedFailedMessage();
    fireEvent.click(screen.getByTestId("move-down-topic-1"));
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
  });

  it("is cleared by opening a Remove confirmation", async () => {
    await setup();
    await showArchivedFailedMessage();
    fireEvent.click(screen.getByTestId("remove-topic-topic-2"));
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
  });

  it("is cleared by opening a Restore confirmation", async () => {
    await setup();
    await showArchivedFailedMessage();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
  });

  it("is cleared by opening a definition editor", async () => {
    await setup();
    await showArchivedFailedMessage();
    fireEvent.click(screen.getByTestId("edit-definition-topic-2"));
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
  });

  it("a new message replaces the previous one", async () => {
    installFetch({
      gets: [mockFetchResponse(threeActive()), mockFetchResponse({}, 500)],
      removes: [archiveOk()],
      restores: [restoreOk()],
    });
    await renderPage();
    await showArchivedFailedMessage();

    await restoreArchived();

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent(RESTORED_FAILED));
    expect(screen.getAllByTestId("screen-message")).toHaveLength(1);
    expect(screen.queryByText(ARCHIVED_FAILED)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 — team change resets local state
// ---------------------------------------------------------------------------
describe("a change of team", () => {
  it("discards a dirty reorder draft", async () => {
    installFetch({ gets: [mockFetchResponse(threeActive())] });
    await renderPage();

    fireEvent.click(screen.getByTestId("move-down-topic-1"));
    expect(screen.getByTestId("reorder-save")).toBeEnabled();

    fireEvent.click(screen.getByTestId("switch-team"));
    await waitFor(() => expect(screen.getByTestId("reorder-save")).toBeDisabled());
    expect(screen.queryByTestId("reorder-locked-reason")).not.toBeInTheDocument();
  });

  it("discards an open definition editor", async () => {
    installFetch({ gets: [mockFetchResponse(threeActive())] });
    await renderPage();

    fireEvent.click(screen.getByTestId("edit-definition-topic-2"));
    expect(screen.getByTestId("definition-editor-topic-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("switch-team"));
    await waitFor(() =>
      expect(topicsAllGets(global.fetch as never).some(([url]) => String(url).includes("team-2"))).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("topic-management-view")).toBeInTheDocument());
    expect(screen.queryByTestId("definition-editor-topic-2")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Section 3 — row headings, "Custom" tag, counted heading, descriptions
// ---------------------------------------------------------------------------
describe("custom topics are marked and rows are headed", () => {
  const response = () =>
    makeTopics({
      active: [
        activeTopic("topic-1", "Partner Integration", { isDefault: false }),
        activeTopic("topic-2", "Pipeline", { isDefault: true, firstSessionDescription: "   " }),
      ],
      archived: [archivedTopic("topic-old", "Legacy System", { isDefault: false }), archivedTopic("topic-def", "Deployment")],
    });

  it("a custom active topic's heading includes 'Custom' in its accessible name", async () => {
    installFetch({ gets: [mockFetchResponse(response())] });
    await renderPage();

    const heading = screen.getByRole("heading", { level: 3, name: /Partner Integration.*Custom/ });
    expect(heading).toHaveAttribute("id", "topic-heading-topic-1");
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(within(heading).getByText("Custom")).toBeInTheDocument();
  });

  it("a custom archived topic is tagged; a default one is not", async () => {
    installFetch({ gets: [mockFetchResponse(response())] });
    await renderPage();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    expect(screen.getByRole("heading", { level: 3, name: /Legacy System.*Custom/ })).toBeInTheDocument();
    const defaultArchived = screen.getByTestId("archived-topic-heading-topic-def");
    expect(within(defaultArchived).queryByText("Custom")).not.toBeInTheDocument();
  });

  it("default topics carry no tag, on locked teams too the custom tag stays", async () => {
    installFetch({ gets: [mockFetchResponse({ ...response(), isCustomizationLocked: true })] });
    await renderPage();

    expect(within(screen.getByTestId("topic-heading-topic-2")).queryByText("Custom")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("topic-heading-topic-1")).getByText("Custom")).toBeInTheDocument();
  });

  it("a whitespace-only description is not rendered", async () => {
    installFetch({ gets: [mockFetchResponse(response())] });
    await renderPage();
    expect(screen.queryByTestId("topic-description-topic-2")).not.toBeInTheDocument();
  });

  it("the heading shows the active count and its accessible name excludes the add trigger", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => activeTopic(`t-${i}`, `Topic ${i}`, { displayOrder: i }));
    installFetch({ gets: [mockFetchResponse(makeTopics({ active: twelve }))] });
    await renderPage();

    const heading = screen.getByRole("heading", { level: 2, name: "Active Topics (12)" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Add custom topic" })).toBeInTheDocument();
    expect(within(heading).queryByRole("button")).not.toBeInTheDocument();
  });
});
