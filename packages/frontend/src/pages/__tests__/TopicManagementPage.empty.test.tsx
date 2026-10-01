import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
} from "./topicManagementTestUtils.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage — topic-add-form-and-empty-state, tasks.md task 8.4:
// the empty active-topics state. Rows 1 and 2's causes can't be reached
// through the UI, so all five rows are driven by mocked TOPIC-002 responses.
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

const NO_TOPICS = "This team has no active topics.";
const LOCKED_COPY =
  "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics.";
const ADMIN_NOTHING_ARCHIVED = "This team has no active topics. Topics can't be added from this account yet.";

const threeArchived = [
  archivedTopic("arch-1", "Deployment"),
  archivedTopic("arch-2", "Codebase Health"),
  archivedTopic("arch-3", "Legacy System", { isDefault: false }),
];

function empty(overrides: Partial<GetAllTopicsResponse> = {}) {
  return makeTopics({ active: [], archived: threeArchived, ...overrides });
}

const emptyState = () => screen.getByTestId("active-topics-empty");
const showArchivedButton = () => screen.queryByRole("button", { name: /^Show archived topics/ });
const addButton = () => screen.queryByRole("button", { name: "Add custom topic" });
const activeHeading = () => screen.getByRole("heading", { level: 2, name: /^Active Topics/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the five empty-state rows", () => {
  it("row 1: a locked team names no role, channel, or control and offers no actions", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ isCustomizationLocked: true }))] });
    await renderPage();

    expect(within(emptyState()).getByText(LOCKED_COPY)).toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(addButton()).not.toBeInTheDocument();
    expect(activeHeading()).toHaveAccessibleName("Active Topics (0)");
  });

  it("row 2: unlocked, archived topics, facilitator", async () => {
    installFetch({ gets: [mockFetchResponse(empty())] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).toHaveTextContent("Show archived topics (3)");
    // Exactly one add entry point: the empty state's, not the heading's.
    expect(screen.getAllByRole("button", { name: "Add custom topic" })).toHaveLength(1);
    expect(within(emptyState()).getByRole("button", { name: "Add custom topic" })).toBeInTheDocument();
    expect(activeHeading()).toHaveAccessibleName("Active Topics (0)");
    expect(screen.queryByTestId("add-topic-trigger")).not.toBeInTheDocument();
  });

  it("row 3: unlocked, archived topics, administrator", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ canAddTopics: false, canEditAnnotations: false }))] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).toHaveTextContent("Show archived topics (3)");
    expect(addButton()).not.toBeInTheDocument();
  });

  it("row 4: unlocked, nothing archived, facilitator", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ archived: [] }))] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
  });

  it("row 5: unlocked, nothing archived, administrator", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ archived: [], canAddTopics: false }))] });
    await renderPage();

    expect(within(emptyState()).getByText(ADMIN_NOTHING_ARCHIVED)).toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(addButton()).not.toBeInTheDocument();
  });
});

describe("empty-state actions", () => {
  it("'Show archived topics (n)' expands Archived and focuses its show/hide control, adding no restore action", async () => {
    installFetch({ gets: [mockFetchResponse(empty())] });
    await renderPage();

    fireEvent.click(showArchivedButton()!);

    const toggle = screen.getByTestId("toggle-archived-topics");
    expect(toggle).toHaveFocus();
    expect(screen.getByTestId("archived-topic-row-arch-1")).toBeInTheDocument();
    expect(within(emptyState()).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  it("restoring from the empty state replaces it without the full-screen path", async () => {
    installFetch({
      gets: [
        mockFetchResponse(empty()),
        mockFetchResponse(
          makeTopics({ active: [activeTopic("arch-1", "Deployment")], archived: threeArchived.slice(1) }),
        ),
      ],
      restores: [
        mockFetchResponse({ topicId: "arch-1", name: "Deployment", status: "active", displayOrder: 1, restoredAt: "2026-10-01T00:00:00.000Z" }),
      ],
    });
    await renderPage();

    fireEvent.click(showArchivedButton()!);
    fireEvent.click(screen.getByTestId("restore-topic-arch-1"));
    fireEvent.click(screen.getByTestId("confirm-restore-arch-1"));

    await waitFor(() => expect(screen.getByTestId("topic-row-arch-1")).toBeInTheDocument());
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading topics…")).not.toBeInTheDocument();
    expect(screen.getByTestId("topic-management-view")).toBeInTheDocument();
  });

  it("never reads defaultTopicsNotActive", async () => {
    const defaults = Array.from({ length: 12 }, (_, i) => ({ topicId: `tmpl-${i}`, name: `Template Default ${i}`, isArchived: false }));
    installFetch({
      gets: [mockFetchResponse(empty({ archived: threeArchived.slice(0, 2), defaultTopicsNotActive: defaults }))],
    });
    await renderPage();

    expect(showArchivedButton()).toHaveTextContent("Show archived topics (2)");
    expect(screen.queryByText(/Template Default/)).not.toBeInTheDocument();
    fireEvent.click(showArchivedButton()!);
    expect(screen.queryByText(/Template Default/)).not.toBeInTheDocument();
  });
});

describe("adding from the empty state", () => {
  it("the form takes the place of the actions below the message; Cancel returns focus to the empty-state control", async () => {
    installFetch({ gets: [mockFetchResponse(empty())] });
    await renderPage();

    fireEvent.click(addButton()!);

    const state = emptyState();
    const form = within(state).getByTestId("add-topic-form");
    expect(within(state).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(
      within(state).getByText(NO_TOPICS).compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-topics-empty-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-topic-name")).toHaveFocus();

    fireEvent.click(screen.getByTestId("add-topic-cancel"));
    expect(showArchivedButton()).toBeInTheDocument();
    expect(screen.getByTestId("empty-state-add-topic")).toHaveFocus();
  });

  it("Discard returns focus to the empty-state control", async () => {
    installFetch({ gets: [mockFetchResponse(empty())] });
    await renderPage();

    fireEvent.click(addButton()!);
    fireEvent.change(screen.getByTestId("add-topic-name"), { target: { value: "Partner" } });
    fireEvent.click(screen.getByTestId("add-topic-cancel"));
    fireEvent.click(screen.getByTestId("add-topic-discard"));

    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("empty-state-add-topic")).toHaveFocus();
  });

  it("the first topic added from the empty state uses the short message", async () => {
    installFetch({
      gets: [
        mockFetchResponse(empty({ archived: [] })),
        mockFetchResponse(
          makeTopics({ active: [activeTopic("topic-new", "Partner Integration", { isDefault: false })], archived: [] }),
        ),
      ],
      adds: [
        mockFetchResponse(
          {
            topicId: "topic-new",
            name: "Partner Integration",
            prompt: "How is it going?",
            voteType: "finger",
            displayOrder: 0,
            isDefault: false,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          201,
        ),
      ],
    });
    await renderPage();

    fireEvent.click(addButton()!);
    fireEvent.change(screen.getByTestId("add-topic-name"), { target: { value: "Partner Integration" } });
    fireEvent.change(screen.getByTestId("add-topic-prompt"), { target: { value: "How is it going?" } });
    fireEvent.click(screen.getByTestId("add-topic-vote-type-finger"));
    fireEvent.click(screen.getByTestId("add-topic-submit"));

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("Added 'Partner Integration'."));
    expect(screen.getByTestId("screen-message")).toHaveTextContent(/^Added 'Partner Integration'\.$/);
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(activeHeading()).toHaveAccessibleName("Active Topics (1)");
    expect(screen.getAllByTestId(/^topic-row-/)).toHaveLength(1);
  });
});
