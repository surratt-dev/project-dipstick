import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import {
  activeTopic,
  archivedTopic,
  assignPosts,
  deferred,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
  topicsAllGets,
  unparseableResponse,
} from "./topicManagementTestUtils.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage -- zero-topic-team-recovery (#200) tasks.md 6.2/6.3:
// the "Assign default topics" action on a locked zero-topic team, driven by
// mocked TOPIC-002 / assign-defaults responses. Spec: topic-management-screen
// "An empty active-topics list shows a small, honest state ...".
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "admin-1", displayName: "Ada", email: "ada@test.com" },
      teamMemberships: [{ teamId: "team-1", role: "participant" }],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

const ADMIN_COPY = "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set.";
const ASK_COPY =
  "This team has no active topics, so its sessions can't run. Ask an application administrator to assign the default topics, then refresh this page.";
const TEMPLATE_MESSAGE =
  'The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again.';
const GENERIC = "The default topics couldn't be assigned. Try again.";

function lockedEmpty(overrides: Partial<GetAllTopicsResponse> = {}) {
  return makeTopics({
    isCustomizationLocked: true,
    lockReason: "first_session",
    canEditAnnotations: false,
    canAddTopics: true,
    canAssignDefaults: true,
    active: [],
    archived: [archivedTopic("arch-1", "Deployment")],
    ...overrides,
  });
}

function afterAssign(count: number) {
  return makeTopics({
    isCustomizationLocked: true,
    lockReason: "first_session",
    canAssignDefaults: false,
    active: Array.from({ length: count }, (_, i) => activeTopic(`t-${i}`, `Topic ${i}`, { displayOrder: i + 1 })),
    archived: [],
  });
}

const assignButton = () => screen.queryByRole("button", { name: /^Assign default topics|^Assigning default topics/ });
const emptyState = () => screen.getByTestId("active-topics-empty");

beforeEach(() => vi.clearAllMocks());

describe("which variant and button are shown", () => {
  it("admin on a locked zero-topic team: admin copy, a primary Assign button, no ask-an-admin sentence, no other actions", async () => {
    installFetch({ gets: [mockFetchResponse(lockedEmpty())] });
    await renderPage();

    expect(within(emptyState()).getByText(ADMIN_COPY)).toBeInTheDocument();
    expect(screen.queryByText(/Ask an application administrator/)).not.toBeInTheDocument();
    expect(assignButton()).toHaveTextContent("Assign default topics");
    expect(screen.queryByRole("button", { name: /^Show archived topics/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add custom topic" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Active Topics/ })).toHaveAccessibleName("Active Topics (0)");
  });

  it.each([
    ["false", { canAssignDefaults: false }],
    ["absent", { canAssignDefaults: undefined }],
  ])("a %s flag fails closed to the ask-an-administrator copy with no Assign control anywhere", async (_label, flag) => {
    installFetch({ gets: [mockFetchResponse(lockedEmpty(flag))] });
    await renderPage();

    expect(within(emptyState()).getByText(ASK_COPY)).toBeInTheDocument();
    expect(assignButton()).not.toBeInTheDocument();
    expect(screen.queryByText(/Assign default topics/)).not.toBeInTheDocument();
  });

  it("a member admin sees the admin variant (the role, not membership, decides)", async () => {
    installFetch({ gets: [mockFetchResponse(lockedEmpty())] });
    await renderPage("team-1"); // the mocked session lists a team-1 membership
    expect(assignButton()).toBeInTheDocument();
  });

  it("no button when the team has active topics, even with the flag set", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ isCustomizationLocked: true, canAssignDefaults: true }))] });
    await renderPage();

    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(assignButton()).not.toBeInTheDocument();
  });

  it("no button on the template team (locked, canonical_defaults, flag false)", async () => {
    installFetch({
      gets: [mockFetchResponse(lockedEmpty({ lockReason: "canonical_defaults", canAssignDefaults: false }))],
    });
    await renderPage();
    expect(assignButton()).not.toBeInTheDocument();
  });

  it("an UNLOCKED zero-topic team shows no Assign button even for an admin; Add and Show archived stay (AC 9)", async () => {
    installFetch({
      // A non-default archived topic: nothing is restorable in bulk (#218), so
      // the pre-#218 empty state applies.
      gets: [
        mockFetchResponse(
          lockedEmpty({
            isCustomizationLocked: false,
            lockReason: null,
            archived: [archivedTopic("arch-1", "Deployment", { isDefault: false })],
          }),
        ),
      ],
    });
    await renderPage();

    expect(assignButton()).not.toBeInTheDocument();
    expect(within(emptyState()).getByText("This team has no active topics.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Show archived topics \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add custom topic" })).toBeInTheDocument();
  });
});

describe("activating Assign default topics", () => {
  it("201: sends one body-less POST, refetches, shows the count line in a status region, focuses the heading, no stale empty state, no full-screen reload", async () => {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(5))],
      assigns: [mockFetchResponse({ topicCount: 5 }, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("5 default topics assigned."));
    expect(screen.getByTestId("screen-message")).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("topic-row-t-0")).toBeInTheDocument();
    expect(assignButton()).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Active Topics/ })).toHaveFocus();
    // The team stays locked: its explanation and read-only list are shown.
    expect(screen.getByTestId("customization-lock-notice")).toBeInTheDocument();
    // Exactly one POST, no body, and exactly one extra refetch; the page never fell back to the loading/error path.
    expect(assignPosts(fetchMock)).toHaveLength(1);
    expect(assignPosts(fetchMock)[0]![1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(assignPosts(fetchMock)[0]![1]).not.toHaveProperty("body");
    expect(topicsAllGets(fetchMock)).toHaveLength(2);
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
  });

  it("201 with one topic reads 'default topic' (singular); the count comes from topicCount, not a literal", async () => {
    installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(1))],
      assigns: [mockFetchResponse({ topicCount: 1 }, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent(/^1 default topic assigned\.$/));
  });

  it("201 with an unusable body still shows a true count, read from the refetched list", async () => {
    installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(3))],
      assigns: [mockFetchResponse({}, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("3 default topics assigned."));
  });

  it("201 whose refetch fails: an alert says the topics were assigned but the list could not be refreshed", async () => {
    installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse({}, 500)],
      assigns: [mockFetchResponse({ topicCount: 5 }, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("5 default topics assigned, but the list couldn't be refreshed."));
  });

  it("is disabled and exposes it while in flight, and a double click sends exactly one request", async () => {
    const pending = deferred<Response>();
    const fetchMock = installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(2))],
      assigns: [pending.promise],
    });
    await renderPage();
    const button = assignButton()!;

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(assignButton()).toBeDisabled());
    expect(assignButton()).toHaveAttribute("aria-busy", "true");
    expect(assignButton()).toHaveAccessibleName("Assigning default topics…");
    expect(assignPosts(fetchMock)).toHaveLength(1);

    await act(async () => pending.resolve(mockFetchResponse({ topicCount: 2 }, 201)));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("2 default topics assigned."));
    expect(assignPosts(fetchMock)).toHaveLength(1);
  });

  it("409 TEAM_HAS_ACTIVE_TOPICS: refetches and shows the list with no message and no banner", async () => {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(4))],
      assigns: [envelope(409, "TEAM_HAS_ACTIVE_TOPICS", "This team already has active topics.")],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("topic-row-t-0")).toBeInTheDocument());
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-topics-empty")).not.toBeInTheDocument();
    expect(topicsAllGets(fetchMock)).toHaveLength(2);
  });

  it("500 DEFAULT_TOPICS_UNAVAILABLE: the template message in an alert; the empty state stays and Assign is enabled for a retry", async () => {
    installFetch({
      gets: [mockFetchResponse(lockedEmpty())],
      assigns: [envelope(500, "DEFAULT_TOPICS_UNAVAILABLE", "ignored server text")],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(TEMPLATE_MESSAGE));
    expect(screen.getByRole("alert")).not.toHaveTextContent("ignored server text");
    expect(emptyState()).toBeInTheDocument();
    expect(assignButton()).toBeEnabled();
    expect(assignButton()).toHaveAttribute("aria-busy", "false");
  });

  it.each([
    ["403", () => envelope(403, "NOT_AN_ADMIN", "x")],
    ["404", () => envelope(404, "TEAM_NOT_FOUND", "x")],
    ["429", () => envelope(429, "TOPIC_WRITE_BURST_LIMIT_EXCEEDED", "x", undefined, { "Retry-After": "60" })],
    ["503", () => envelope(503, "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE", "x")],
    ["500 ASSIGN_DEFAULTS_FAILED", () => envelope(500, "ASSIGN_DEFAULTS_FAILED", "x")],
    ["500 with an unknown code", () => envelope(500, "SOMETHING_NEW", "x")],
    ["500 with an unparseable body", () => unparseableResponse(500)],
    ["a network error", () => new TypeError("Failed to fetch")],
  ])("%s: the generic failure message in an alert; the empty state and an enabled button remain", async (_label, reply) => {
    installFetch({ gets: [mockFetchResponse(lockedEmpty())], assigns: [reply()] });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(GENERIC));
    expect(screen.getByRole("alert")).not.toHaveTextContent("template");
    expect(emptyState()).toBeInTheDocument();
    expect(assignButton()).toBeEnabled();
  });

  it("a failed attempt can be retried and then succeeds; the stale alert is cleared", async () => {
    const fetchMock = installFetch({
      gets: [mockFetchResponse(lockedEmpty()), mockFetchResponse(afterAssign(2))],
      assigns: [envelope(500, "ASSIGN_DEFAULTS_FAILED", "x"), mockFetchResponse({ topicCount: 2 }, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent("2 default topics assigned."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(assignPosts(fetchMock)).toHaveLength(2);
  });

  it("makes no request on its own: no polling, no extra refetch trigger", async () => {
    const fetchMock = installFetch({ gets: [mockFetchResponse(lockedEmpty())] });
    await renderPage();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(topicsAllGets(fetchMock)).toHaveLength(1);
    expect(assignPosts(fetchMock)).toHaveLength(0);
  });
});

// tasks.md 6.5: template text now propagates to teams that did not review it,
// on the strength of React's escaping. A markup-bearing name and prompt must
// render as text, never as elements, in the list an assignment produces.
describe("escape at render (#200 6.5)", () => {
  it("topic names and prompts containing markup are rendered as text after an assignment", async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const script = "<script>window.__pwned=2</script>";
    installFetch({
      gets: [
        mockFetchResponse(lockedEmpty()),
        mockFetchResponse(
          makeTopics({
            isCustomizationLocked: true,
            canAssignDefaults: false,
            active: [activeTopic("t-evil", evil, { displayOrder: 1, prompt: script })],
            archived: [],
          }),
        ),
      ],
      assigns: [mockFetchResponse({ topicCount: 1 }, 201)],
    });
    await renderPage();

    fireEvent.click(assignButton()!);

    await waitFor(() => expect(screen.getByTestId("topic-row-t-evil")).toBeInTheDocument());
    const row = screen.getByTestId("topic-row-t-evil");
    expect(row).toHaveTextContent(evil);
    expect(row).toHaveTextContent(script);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("script")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["__pwned"]).toBeUndefined();
  });
});
