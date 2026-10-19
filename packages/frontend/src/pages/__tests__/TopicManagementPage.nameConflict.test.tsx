import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  nameActiveConflict,
  renderPage,
} from "./topicManagementTestUtils.js";

// ---------------------------------------------------------------------------
// enforce-active-name-duplicate-rule (#299) tasks 5.4 / 6.2 / 6.3: the
// single-restore 409 TOPIC_NAME_ACTIVE is explained at the archived row.
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

const MESSAGE = (name: string) =>
  `Not restored. An active topic with this name already exists: "${name}". Nothing was changed. Archive the active topic first if you want to restore this one.`;

const withConflict = (activeName = "codebase health") =>
  makeTopics({
    active: [
      activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1 }),
      activeTopic("topic-ch", activeName, { displayOrder: 2 }),
    ],
    archived: [archivedTopic("topic-old", "Codebase Health", { prompt: "Is the codebase easy to work with?" })],
  });

async function openArchivedAndRestore() {
  await renderPage();
  fireEvent.click(screen.getByTestId("toggle-archived-topics"));
  await waitFor(() => screen.getByTestId("restore-topic-topic-old"));
  fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
  fireEvent.click(screen.getByTestId("confirm-restore-topic-old"));
}

beforeEach(() => vi.clearAllMocks());

describe("restore rejected with TOPIC_NAME_ACTIVE", () => {
  it("shows the fixed client-owned text at the row, persistently, announced, with the row still archived", async () => {
    installFetch({ gets: [mockFetchResponse(withConflict())], restores: [nameActiveConflict("codebase health", "topic-ch")] });
    await openArchivedAndRestore();

    const message = await screen.findByTestId("restore-error-topic-old");
    expect(message).toHaveTextContent(MESSAGE("codebase health"));
    expect(message).toHaveAttribute("role", "alert");
    expect(message.textContent).not.toContain("server text, never shown");
    // The confirmation dialog is closed; the message stays (not a toast).
    expect(screen.queryByTestId("restore-topic-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("archived-topic-row-topic-old")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-row-topic-old")).not.toBeInTheDocument();
    expect(screen.getByTestId("restore-topic-topic-old")).toBeEnabled();
  });

  it("an empty conflictingName reads 'a topic with no name'", async () => {
    installFetch({ gets: [mockFetchResponse(withConflict())], restores: [nameActiveConflict("")] });
    await openArchivedAndRestore();
    expect(await screen.findByTestId("restore-error-topic-old")).toHaveTextContent(
      "exists: a topic with no name. Nothing was changed.",
    );
  });

  it("renders a markup name as literal text", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    installFetch({ gets: [mockFetchResponse(withConflict())], restores: [nameActiveConflict(markup)] });
    await openArchivedAndRestore();
    expect(await screen.findByTestId("restore-error-topic-old")).toHaveTextContent(MESSAGE(markup));
    expect(document.querySelector("img")).toBeNull();
  });

  it("clears on the next restore attempt on that row", async () => {
    installFetch({ gets: [mockFetchResponse(withConflict())], restores: [nameActiveConflict("codebase health")] });
    await openArchivedAndRestore();
    await screen.findByTestId("restore-error-topic-old");

    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
    expect(screen.queryByTestId("restore-error-topic-old")).not.toBeInTheDocument();
    expect(screen.getByTestId("restore-topic-dialog")).toBeInTheDocument();
  });

  it("clears on a successful archive in the team, after which the same restore succeeds", async () => {
    const afterArchive = makeTopics({
      active: [activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1 })],
      archived: [
        archivedTopic("topic-old", "Codebase Health", { prompt: "Is the codebase easy to work with?" }),
        archivedTopic("topic-ch", "codebase health"),
      ],
    });
    const afterRestore = makeTopics({
      active: [
        activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1 }),
        activeTopic("topic-old", "Codebase Health", { displayOrder: 2 }),
      ],
      archived: [archivedTopic("topic-ch", "codebase health")],
    });
    installFetch({
      gets: [mockFetchResponse(withConflict()), mockFetchResponse(afterArchive), mockFetchResponse(afterRestore)],
      restores: [
        nameActiveConflict("codebase health", "topic-ch"),
        mockFetchResponse({ topicId: "topic-old", name: "Codebase Health", status: "active", displayOrder: 2, restoredAt: "2026-10-01T00:00:00.000Z" }),
      ],
      removes: [mockFetchResponse({ topicId: "topic-ch", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" })],
    });
    await openArchivedAndRestore();
    await screen.findByTestId("restore-error-topic-old");

    fireEvent.click(screen.getByTestId("remove-topic-topic-ch"));
    fireEvent.click(await screen.findByTestId("confirm-remove-topic-ch"));
    await waitFor(() => expect(screen.queryByTestId("restore-error-topic-old")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("confirm-restore-topic-old"));
    await waitFor(() => expect(screen.getByTestId("topic-row-topic-old")).toBeInTheDocument());
  });

  it("a lock 409 shows the lock message, never the name-conflict text", async () => {
    installFetch({
      gets: [mockFetchResponse(withConflict())],
      restores: [envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "Topics are locked for this team.")],
    });
    await openArchivedAndRestore();
    const message = await screen.findByTestId("restore-error-topic-old");
    expect(message).toHaveTextContent("Topics are locked for this team.");
    expect(message.textContent?.toLowerCase()).not.toContain("an active topic with this name already exists");
  });

  it("an unknown 409 code falls back to the generic server message", async () => {
    installFetch({ gets: [mockFetchResponse(withConflict())], restores: [envelope(409, "SOMETHING_ELSE", "Odd.")] });
    await openArchivedAndRestore();
    const message = await screen.findByTestId("restore-error-topic-old");
    expect(message.textContent?.toLowerCase()).not.toContain("an active topic with this name already exists");
  });
});
