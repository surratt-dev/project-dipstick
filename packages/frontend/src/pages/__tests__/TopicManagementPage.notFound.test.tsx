import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import {
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
  unparseableResponse,
  deferred,
} from "./topicManagementTestUtils.js";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TopicManagementRoute } from "../TopicManagementPage.js";

// ---------------------------------------------------------------------------
// #265 -- the Topic Management screen's not-found state.
//
// An initial-load 404 whose JSON body has error.code === "TEAM_NOT_FOUND"
// shows exactly "Team not found." (a literal constant in the page, never the
// server message) in the existing error state. Every other non-ok initial
// load keeps "Failed to load topics.". A failing quiet refetch after a
// successful load never blanks the screen (characterization: it already
// does not, because fetchAllTopics never calls setError).
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

const NOT_FOUND = "Team not found.";
const GENERIC = "Failed to load topics.";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Renders the page route without waiting for the loaded view. */
function renderRaw(teamId = "team-1") {
  return render(
    <MemoryRouter initialEntries={[`/team/${teamId}/topics`]}>
      <Routes>
        <Route path="/team/:teamId/topics" element={<TopicManagementRoute />} />
        <Route path="/team/:teamId" element={<div>Team Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoTopicScreen() {
  expect(screen.queryByTestId("topic-management-view")).not.toBeInTheDocument();
  expect(screen.queryByTestId("add-topic-trigger")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add custom topic" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Our team's definition/)).not.toBeInTheDocument();
  expect(screen.queryByText("Pairing Effectiveness")).not.toBeInTheDocument();
  expect(screen.queryByText(/Network error/)).not.toBeInTheDocument();
}

describe("initial-load TEAM_NOT_FOUND (AC 9)", () => {
  it("shows exactly 'Team not found.' in the existing error state with the Back to team link", async () => {
    installFetch({ gets: [envelope(404, "TEAM_NOT_FOUND", "Team not found.")] });
    renderRaw();

    const alert = await screen.findByTestId("topic-management-error");
    expect(alert).toHaveTextContent(NOT_FOUND);
    expect(alert.textContent).toBe(NOT_FOUND);
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getByRole("link", { name: "Back to team" })).toHaveAttribute("href", "/team/team-1");
    expectNoTopicScreen();
  });

  it("renders the page's literal constant even when the body carries a different message", async () => {
    installFetch({ gets: [envelope(404, "TEAM_NOT_FOUND", "Something the server reworded, team-1")] });
    renderRaw();

    const alert = await screen.findByTestId("topic-management-error");
    expect(alert.textContent).toBe(NOT_FOUND);
    expect(screen.queryByText(/reworded/)).not.toBeInTheDocument();
  });

  it("a non-canonical team id in the URL (same envelope) shows the same state and does not echo the id", async () => {
    installFetch({ gets: [envelope(404, "TEAM_NOT_FOUND", "Team not found.")] });
    renderRaw("not-a-uuid");

    const alert = await screen.findByTestId("topic-management-error");
    expect(alert.textContent).toBe(NOT_FOUND);
    expect(alert.textContent).not.toContain("not-a-uuid");
  });

  it("renders no topic-list or definition element before the response resolves (a loading indicator is fine)", async () => {
    const pending = deferred<Response>();
    installFetch({ gets: [pending.promise] });
    renderRaw();

    expect(screen.getByText(/Loading topics/)).toBeInTheDocument();
    expectNoTopicScreen();
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();

    pending.resolve(envelope(404, "TEAM_NOT_FOUND", "Team not found."));
    expect((await screen.findByTestId("topic-management-error")).textContent).toBe(NOT_FOUND);
    expectNoTopicScreen();
  });
});

describe("other non-ok initial loads (AC 10)", () => {
  it.each([
    ["a non-JSON 404", () => unparseableResponse(404)],
    ["a JSON 404 with a different code", () => envelope(404, "SESSION_NOT_FOUND", "Session not found.")],
    ["a JSON 404 with no code", () => mockFetchResponse({ error: { message: "Team not found." } }, 404)],
    ["a JSON 404 whose error is not an object", () => mockFetchResponse({ error: "TEAM_NOT_FOUND" }, 404)],
    ["a JSON 404 with a null body", () => mockFetchResponse(null, 404)],
    ["a 500", () => mockFetchResponse({}, 500)],
  ])("%s shows 'Failed to load topics.' and never 'Team not found.'", async (_label, make) => {
    installFetch({ gets: [make()] });
    renderRaw();

    const alert = await screen.findByTestId("topic-management-error");
    expect(alert.textContent).toBe(GENERIC);
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
  });

  it("a 403 is unchanged: the server's message, or the fallback when the body is not an envelope", async () => {
    installFetch({ gets: [envelope(403, "X", "A facilitator cannot view topic management for a team they are a member of.")] });
    const first = renderRaw();
    expect((await screen.findByTestId("topic-management-error")).textContent).toBe(
      "A facilitator cannot view topic management for a team they are a member of.",
    );
    first.unmount();

    installFetch({ gets: [mockFetchResponse({}, 403)] });
    renderRaw();
    expect((await screen.findByTestId("topic-management-error")).textContent).toBe(
      "You do not have access to this team's topic management.",
    );
  });
});

describe("a failing quiet refetch keeps the screen (AC 11, characterization)", () => {
  const removeOk = () =>
    mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" });

  it.each([
    [404, () => envelope(404, "TEAM_NOT_FOUND", "Team not found.")],
    [403, () => envelope(403, "X", "A facilitator cannot view topic management for a team they are a member of.")],
    [500, () => mockFetchResponse({}, 500)],
  ])("a %s refetch after Remove keeps the list and an unsaved add-form draft and shows no full-screen error", async (_status, make) => {
    installFetch({ gets: [mockFetchResponse(makeTopics()), make()], removes: [removeOk()] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add custom topic" }));
    fireEvent.change(screen.getByTestId("add-topic-name"), { target: { value: "Partner Integration" } });

    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() => expect(screen.getByTestId("screen-message")).toBeInTheDocument());
    expect(screen.getByTestId("topic-management-view")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(screen.getByTestId("topic-row-topic-1")).toBeInTheDocument();
    expect(screen.getByTestId("topic-row-topic-2")).toBeInTheDocument();
    expect(screen.getByTestId("add-topic-name")).toHaveValue("Partner Integration");
  });

  // Not pinned here: an open definition editor with unsaved text. Starting
  // Remove disables the edit control, so a definition draft and an in-flight
  // quiet refetch cannot coexist (verified while writing this suite); the
  // unsaved add-form draft above is the reachable unsaved edit.
});
