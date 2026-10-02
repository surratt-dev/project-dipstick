import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
} from "./topicManagementTestUtils.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";
import { ActiveTopicsEmptyState } from "../../components/ActiveTopicsEmptyState.js";

// ---------------------------------------------------------------------------
// TopicManagementPage — topic-add-form-and-empty-state, tasks.md task 8.4:
// the empty active-topics state, driven by mocked TOPIC-002 responses.
// topic-003-admin-authorization (#176) tasks.md 4.3: application admins can
// add topics (FR-8.2); the add action is gated by canAddTopics === true and
// the lock, never by the empty-state variant.
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

const threeArchived = [
  archivedTopic("arch-1", "Deployment"),
  archivedTopic("arch-2", "Codebase Health"),
  archivedTopic("arch-3", "Legacy System", { isDefault: false }),
];

// TOPIC-002 as an application admin sees it after #176.
const ADMIN_FLAGS = { canAddTopics: true, canEditAnnotations: false } as const;

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

describe("the empty-state variants", () => {
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

  it("row 4: unlocked, nothing archived, facilitator", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ archived: [] }))] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
  });

});

describe("application admin (topic-003-admin-authorization, #176)", () => {
  it("(a1) unlocked, no active topics, 3 archived: Show archived topics (3) and Add custom topic", async () => {
    installFetch({ gets: [mockFetchResponse(empty(ADMIN_FLAGS))] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).toHaveTextContent("Show archived topics (3)");
    expect(within(emptyState()).getByRole("button", { name: "Add custom topic" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add custom topic" })).toHaveLength(1);
  });

  it("(a2) unlocked, no active topics, nothing archived: Add custom topic, no Show archived action", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ ...ADMIN_FLAGS, archived: [] }))] });
    await renderPage();

    expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(within(emptyState()).getByRole("button", { name: "Add custom topic" })).toBeInTheDocument();
  });

  it("(b) unlocked, with active topics: the heading trigger is shown", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics(ADMIN_FLAGS))] });
    await renderPage();

    expect(screen.getByTestId("add-topic-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
  });

  it("(c) locked, no active topics: locked variant, no Show archived and no add action", async () => {
    installFetch({ gets: [mockFetchResponse(empty({ ...ADMIN_FLAGS, isCustomizationLocked: true }))] });
    await renderPage();

    // The locked message text for admins is owned by #200; only structure is asserted.
    expect(emptyState()).toBeInTheDocument();
    expect(screen.queryByTestId("active-topics-empty-actions")).not.toBeInTheDocument();
    expect(showArchivedButton()).not.toBeInTheDocument();
    expect(addButton()).not.toBeInTheDocument();
  });

  it("(d) unlocked empty state: opens the form, submits, and the new row replaces the empty state", async () => {
    installFetch({
      gets: [
        mockFetchResponse(empty({ ...ADMIN_FLAGS, archived: [] })),
        mockFetchResponse(
          makeTopics({
            ...ADMIN_FLAGS,
            active: [activeTopic("topic-admin", "Org Alignment", { isDefault: false })],
            archived: [],
          }),
        ),
      ],
      adds: [
        mockFetchResponse(
          {
            topicId: "topic-admin",
            name: "Org Alignment",
            prompt: "How aligned are we?",
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

    fireEvent.click(within(emptyState()).getByRole("button", { name: "Add custom topic" }));
    fireEvent.change(screen.getByTestId("add-topic-name"), { target: { value: "Org Alignment" } });
    fireEvent.change(screen.getByTestId("add-topic-prompt"), { target: { value: "How aligned are we?" } });
    fireEvent.click(screen.getByTestId("add-topic-vote-type-finger"));
    fireEvent.click(screen.getByTestId("add-topic-submit"));

    await waitFor(() => expect(screen.getByTestId("topic-row-topic-admin")).toBeInTheDocument());
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(activeHeading()).toHaveAccessibleName("Active Topics (1)");
  });

  it.each([
    ["absent", { canAddTopics: undefined }],
    ["explicit false (backend rollback)", { canAddTopics: false }],
  ] as const)(
    "(e) drift guard: canAddTopics %s on an unlocked team with 2 archived shows no add action anywhere",
    async (_label, flag) => {
      const data = empty({ canEditAnnotations: false, archived: threeArchived.slice(0, 2) });
      const body: Record<string, unknown> = { ...data, ...flag };
      if (flag.canAddTopics === undefined) delete body["canAddTopics"];
      installFetch({ gets: [mockFetchResponse(body)] });
      await renderPage();

      expect(within(emptyState()).getByText(NO_TOPICS)).toBeInTheDocument();
      expect(showArchivedButton()).toHaveTextContent("Show archived topics (2)");
      expect(addButton()).not.toBeInTheDocument();
    },
  );

  it("(f) locked, with active topics: no Add custom topic anywhere, lock notice shown", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ ...ADMIN_FLAGS, isCustomizationLocked: true }))] });
    await renderPage();

    expect(screen.getByTestId("customization-lock-notice")).toBeInTheDocument();
    expect(addButton()).not.toBeInTheDocument();
  });
});

describe("ActiveTopicsEmptyState addAllowed gate (engineer review B1)", () => {
  it.each(["unlocked_with_archived", "unlocked_none_archived"] as const)(
    "variant %s with addAllowed={false} renders no Add custom topic",
    (variant) => {
      render(
        <ActiveTopicsEmptyState
          variant={variant}
          addAllowed={false}
          archivedCount={variant === "unlocked_with_archived" ? 2 : 0}
          onShowArchived={() => undefined}
          onAddTopic={() => undefined}
        />,
      );
      expect(screen.queryByRole("button", { name: "Add custom topic" })).not.toBeInTheDocument();
    },
  );

  it("the locked variant renders no Add custom topic even with addAllowed={true}", () => {
    render(
      <ActiveTopicsEmptyState
        variant="locked"
        addAllowed={true}
        archivedCount={2}
        onShowArchived={() => undefined}
        onAddTopic={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add custom topic" })).not.toBeInTheDocument();
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
