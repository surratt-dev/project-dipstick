import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TopicManagementPage } from "../TopicManagementPage.js";
import type { GetAllTopicsResponse, UpdateTopicAnnotationResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage — topic-annotation, design.md Decision 10, tasks.md
// Section 8: "Our team's definition" display and inline editor.
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

const HELP = "What this topic means for this team, in the team's words. Not for notes about people or how to vote.";
const SAVED = "Saved. Sessions that already exist keep the previous definition.";
const CLEAR_CONFIRM = "Remove this team's definition? This can't be undone.";
const DEFINITION_REASON = "Save or cancel your definition changes first.";
const ORDER_REASON = "Save or discard your order changes first.";
const DIALOG_REASON = "Finish or cancel the open remove or restore first.";

type Active = GetAllTopicsResponse["active"][number];
type Archived = GetAllTopicsResponse["archived"][number];

function activeTopic(id: string, name: string, overrides: Partial<Active> = {}): Active {
  return {
    topicId: id,
    name,
    prompt: `Prompt for ${name}`,
    voteType: "finger",
    displayOrder: 0,
    isDefault: false,
    firstSessionDescription: `Description of ${name}`,
    teamAnnotation: null,
    annotationUpdatedAt: null,
    annotationUpdatedBy: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function archivedTopic(overrides: Partial<Archived> = {}): Archived {
  return {
    topicId: "topic-old",
    name: "Old Topic",
    prompt: "An old prompt",
    voteType: "finger",
    isDefault: false,
    archivedAt: "2026-08-01T12:00:00.000Z",
    archivedBy: { userId: "user-9", displayName: "Priya Nair" },
    restoredAt: null,
    restoredBy: null,
    teamAnnotation: null,
    annotationUpdatedAt: null,
    annotationUpdatedBy: null,
    ...overrides,
  };
}

function makeTopics(overrides: Partial<GetAllTopicsResponse> = {}): GetAllTopicsResponse {
  return {
    teamId: "team-1",
    teamName: "Platform Squad",
    isCustomizationLocked: false,
    canEditAnnotations: true,
    canAddTopics: true,
    active: [
      activeTopic("topic-1", "Pipeline", {
        displayOrder: 1,
        teamAnnotation: "Our build and deploy pipeline",
        annotationUpdatedAt: "2026-09-30T12:00:00.000Z",
        annotationUpdatedBy: { userId: "user-d", displayName: "Dana Ruiz" },
      }),
      activeTopic("topic-2", "Codebase Health", { displayOrder: 2 }),
    ],
    archived: [archivedTopic()],
    defaultTopicsNotActive: [],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function annotationResponse(topicId: string, text: string | null, by = "Gil Facilitator"): UpdateTopicAnnotationResponse {
  return {
    topicId,
    teamAnnotation: text,
    annotationUpdatedAt: "2026-09-30T15:00:00.000Z",
    annotationUpdatedBy: { userId: "user-g", displayName: by },
  };
}

/** Route-aware fetch: GET /topics/all answers from `gets` (last repeats); PUT …/annotation from `puts`. */
function installFetch(opts: { gets?: Array<Response | Error>; puts?: Array<Response | Error> } = {}) {
  const gets = opts.gets ?? [mockFetchResponse(makeTopics())];
  const puts = opts.puts ?? [];
  let getIndex = 0;
  let putIndex = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PUT" && url.endsWith("/annotation")) {
      const next = puts[putIndex++];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? mockFetchResponse({}, 500));
    }
    if (url.endsWith("/topics/all")) {
      const next = gets[Math.min(getIndex++, gets.length - 1)]!;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    }
    return Promise.resolve(mockFetchResponse({}, 500));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function annotationPuts(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([url, init]) => init?.method === "PUT" && String(url).endsWith("/annotation"));
}

function topicsAllGets(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/topics/all"));
}

async function renderLoaded() {
  render(
    <MemoryRouter initialEntries={["/team/team-1/topics"]}>
      <Routes>
        {/* Unkeyed is safe only because this suite never changes team; production mounts TopicManagementRoute (keyed on teamId). */}
        <Route path="/team/:teamId/topics" element={<TopicManagementPage />} />
        <Route path="/team/:teamId" element={<div>Team Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByTestId("topic-management-view"));
}

const input = (id: string) => screen.getByTestId(`definition-input-${id}`) as HTMLTextAreaElement;
const openEditor = (id: string) => fireEvent.click(screen.getByTestId(`edit-definition-${id}`));
const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } });
const save = (id: string) => fireEvent.click(screen.getByTestId(`definition-save-${id}`));

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Task 8.1 — display
// ---------------------------------------------------------------------------
describe("team definition — display", () => {
  it("shows 'Our team's definition' above the description with the provenance line", async () => {
    installFetch();
    await renderLoaded();

    const row = screen.getByTestId("topic-row-topic-1");
    const definition = within(row).getByTestId("team-definition-topic-1");
    expect(definition.textContent).toContain("Our team's definition");
    expect(screen.getByTestId("team-definition-text-topic-1").textContent).toBe("Our build and deploy pipeline");
    expect(screen.getByTestId("team-definition-provenance-topic-1").textContent).toBe(
      "Last edited Sep 30, 2026 by Dana Ruiz",
    );
    // Above the description.
    const description = within(row).getByTestId("topic-description-topic-1");
    expect(definition.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // "annotation" is never user-facing copy.
    expect(screen.getByTestId("topic-management-view").textContent?.toLowerCase()).not.toContain("annotation");
  });

  it("renders no definition element and no provenance when teamAnnotation is null (including after a clear)", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({
            active: [
              activeTopic("topic-2", "Codebase Health", {
                teamAnnotation: null,
                annotationUpdatedAt: "2026-09-30T12:00:00.000Z",
                annotationUpdatedBy: { userId: "user-g", displayName: "Gil" },
              }),
            ],
          }),
        ),
      ],
    });
    await renderLoaded();

    expect(screen.queryByTestId("team-definition-topic-2")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last edited/)).not.toBeInTheDocument();
  });

  it("omits the name when annotationUpdatedBy is null, and the whole line when annotationUpdatedAt is null", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({
            active: [
              activeTopic("topic-1", "Pipeline", {
                teamAnnotation: "X",
                annotationUpdatedAt: "2026-09-30T12:00:00.000Z",
                annotationUpdatedBy: null,
              }),
              activeTopic("topic-2", "Codebase Health", { teamAnnotation: "Y", annotationUpdatedAt: null }),
            ],
          }),
        ),
      ],
    });
    await renderLoaded();

    expect(screen.getByTestId("team-definition-provenance-topic-1").textContent).toBe("Last edited Sep 30, 2026");
    expect(screen.getByTestId("team-definition-text-topic-2").textContent).toBe("Y");
    expect(screen.queryByTestId("team-definition-provenance-topic-2")).not.toBeInTheDocument();
  });

  it("shows an archived row's definition read-only, with no add or edit control", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({
            archived: [
              archivedTopic({
                teamAnnotation: "X",
                annotationUpdatedAt: "2026-09-30T12:00:00.000Z",
                annotationUpdatedBy: { userId: "user-d", displayName: "Dana Ruiz" },
              }),
            ],
          }),
        ),
      ],
    });
    await renderLoaded();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    const row = screen.getByTestId("archived-topic-row-topic-old");
    expect(within(row).getByTestId("team-definition-text-topic-old").textContent).toBe("X");
    expect(within(row).getByTestId("team-definition-provenance-topic-old").textContent).toBe(
      "Last edited Sep 30, 2026 by Dana Ruiz",
    );
    expect(within(row).queryByTestId("edit-definition-topic-old")).not.toBeInTheDocument();
    expect(within(row).queryByText("Add team definition")).not.toBeInTheDocument();
    expect(within(row).queryByText("Edit")).not.toBeInTheDocument();
  });

  it("renders line breaks and markup as plain text", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({
            active: [activeTopic("topic-1", "Pipeline", { teamAnnotation: "Line one\nLine two <b>bold</b>" })],
          }),
        ),
      ],
    });
    await renderLoaded();

    const text = screen.getByTestId("team-definition-text-topic-1");
    expect(text.textContent).toBe("Line one\nLine two <b>bold</b>");
    expect(text.querySelector("b")).toBeNull();
    expect(text.style.whiteSpace).toBe("pre-wrap");
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — editor state
// ---------------------------------------------------------------------------
describe("team definition — editor state", () => {
  it("offers 'Add team definition' when null and 'Edit' when set", async () => {
    installFetch();
    await renderLoaded();

    expect(screen.getByTestId("edit-definition-topic-1").textContent).toBe("Edit");
    expect(screen.getByTestId("edit-definition-topic-2").textContent).toBe("Add team definition");
  });

  it("blocks a second editor while the first is dirty: text kept, focus moved, message shown", async () => {
    installFetch();
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Unsaved wording");
    openEditor("topic-2");

    expect(screen.queryByTestId("definition-input-topic-2")).not.toBeInTheDocument();
    expect(input("topic-1").value).toBe("Unsaved wording");
    expect(document.activeElement).toBe(input("topic-1"));
    expect(screen.getByTestId("definition-blocked-topic-1").textContent).toBe("Save or cancel this definition first.");
  });

  it("a clean editor yields to another row", async () => {
    installFetch();
    await renderLoaded();

    openEditor("topic-1");
    openEditor("topic-2");

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("definition-input-topic-2")).toBeInTheDocument();
  });

  it("Esc closes the editor, restores the saved text, and sends nothing", async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Something else");
    fireEvent.keyDown(input("topic-1"), { key: "Escape" });

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("team-definition-text-topic-1").textContent).toBe("Our build and deploy pipeline");
    expect(annotationPuts(fetchMock)).toHaveLength(0);

    openEditor("topic-1");
    expect(input("topic-1").value).toBe("Our build and deploy pipeline");
  });
});

// ---------------------------------------------------------------------------
// Task 8.3 — editor UI
// ---------------------------------------------------------------------------
describe("team definition — editor UI", () => {
  it("is labelled 'Our team's definition' and described by the exact helper text", async () => {
    installFetch();
    await renderLoaded();
    openEditor("topic-2");

    const field = screen.getByLabelText("Our team's definition");
    expect(field).toBe(input("topic-2"));
    expect(field).toHaveAccessibleDescription(HELP);
    expect(screen.getByTestId("definition-help-topic-2").textContent).toBe(HELP);
    expect(field.getAttribute("maxlength")).toBe("500");
  });

  it("a 520-character paste leaves exactly the first 500 units and announces the limit", async () => {
    installFetch();
    await renderLoaded();
    openEditor("topic-2");

    const pasted = Array.from({ length: 520 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const user = userEvent.setup();
    await user.click(input("topic-2"));
    await user.paste(pasted);

    expect(input("topic-2").value).toBe(pasted.slice(0, 500));
    expect(screen.getByTestId("definition-counter-topic-2").textContent).toBe("500 / 500");
    expect(screen.getByTestId("definition-counter-topic-2").getAttribute("data-limit-reached")).toBe("true");
    const live = screen.getByTestId("definition-limit-topic-2");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("500 character limit reached.");
  });

  it("shows the limit at raw 500 while the normalized counter reads 497 / 500 (trailing spaces)", async () => {
    installFetch();
    await renderLoaded();
    openEditor("topic-2");

    type("topic-2", `${"a".repeat(497)}   `);

    expect(screen.getByTestId("definition-counter-topic-2").textContent).toBe("497 / 500");
    expect(screen.getByTestId("definition-counter-topic-2").getAttribute("data-limit-reached")).toBe("true");
    expect(screen.getByTestId("definition-limit-topic-2").textContent).toBe("500 character limit reached.");
  });

  it("counts in UTF-16 units: 10 emoji read 20 / 500", async () => {
    installFetch();
    await renderLoaded();
    openEditor("topic-2");

    type("topic-2", "😀".repeat(10));

    expect(screen.getByTestId("definition-counter-topic-2").textContent).toBe("20 / 500");
    expect(screen.getByTestId("definition-limit-topic-2").textContent).toBe("");
  });

  it("keeps the saved text and provenance visible while editing", async () => {
    installFetch();
    await renderLoaded();
    openEditor("topic-1");
    type("topic-1", "Draft");

    expect(screen.getByTestId("team-definition-text-topic-1").textContent).toBe("Our build and deploy pipeline");
    expect(screen.getByTestId("team-definition-provenance-topic-1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 8.4 — save flow
// ---------------------------------------------------------------------------
describe("team definition — save flow", () => {
  it("adds a definition: one PUT with the text, row patched without a reload, Saved. in a status region", async () => {
    const fetchMock = installFetch({ puts: [mockFetchResponse(annotationResponse("topic-2", "Our code health"))] });
    await renderLoaded();

    openEditor("topic-2");
    type("topic-2", "Our code health");
    save("topic-2");

    await waitFor(() => expect(screen.getByTestId("team-definition-text-topic-2").textContent).toBe("Our code health"));
    const puts = annotationPuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(String(puts[0]![0])).toBe("/api/v1/teams/team-1/topics/topic-2/annotation");
    expect(JSON.parse(String(puts[0]![1]!.body))).toEqual({ annotation: "Our code health" });
    expect(topicsAllGets(fetchMock)).toHaveLength(1); // no refetch
    expect(screen.getByTestId("team-definition-provenance-topic-2").textContent).toBe(
      "Last edited Sep 30, 2026 by Gil Facilitator",
    );
    const status = screen.getByTestId("definition-saved-topic-2");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe(SAVED);
  });

  it("overwrites with no confirmation", async () => {
    const fetchMock = installFetch({ puts: [mockFetchResponse(annotationResponse("topic-1", "New wording"))] });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "New wording");
    save("topic-1");

    expect(screen.queryByText(CLEAR_CONFIRM)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("definition-saved-topic-1").textContent).toBe(SAVED));
    expect(annotationPuts(fetchMock)).toHaveLength(1);
  });

  it("clearing asks first and sends nothing until Remove", async () => {
    const fetchMock = installFetch({ puts: [mockFetchResponse(annotationResponse("topic-1", null))] });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "   ");
    save("topic-1");

    expect(screen.getByTestId("definition-clear-confirm-topic-1").textContent).toContain(CLEAR_CONFIRM);
    expect(annotationPuts(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("definition-clear-remove-topic-1"));
    await waitFor(() => expect(screen.queryByTestId("team-definition-topic-1")).not.toBeInTheDocument());
    expect(annotationPuts(fetchMock)).toHaveLength(1);
    expect(screen.queryByText(/Last edited/)).not.toBeInTheDocument();
  });

  it("clear-confirm Cancel returns to the editor with the draft unchanged and sends nothing", async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "  ");
    save("topic-1");
    fireEvent.click(screen.getByTestId("definition-clear-cancel-topic-1"));

    expect(screen.queryByTestId("definition-clear-confirm-topic-1")).not.toBeInTheDocument();
    expect(input("topic-1").value).toBe("  ");
    expect(annotationPuts(fetchMock)).toHaveLength(0);
  });

  it("an unchanged save ('  X  ' over 'X') closes with no request and no message", async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "  Our build and deploy pipeline \r\n");
    save("topic-1");

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    expect(annotationPuts(fetchMock)).toHaveLength(0);
    expect(screen.queryByText(SAVED)).not.toBeInTheDocument();
  });

  it("saving an empty editor over no definition sends nothing and asks nothing", async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    openEditor("topic-2");
    save("topic-2");

    expect(screen.queryByTestId("definition-input-topic-2")).not.toBeInTheDocument();
    expect(screen.queryByText(CLEAR_CONFIRM)).not.toBeInTheDocument();
    expect(annotationPuts(fetchMock)).toHaveLength(0);
  });

  it("an error keeps the text, shows the server message, and leaves the saved definition unchanged", async () => {
    installFetch({
      puts: [mockFetchResponse({ error: { code: "INTERNAL", message: "Something broke." } }, 500)],
    });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "My careful wording");
    save("topic-1");

    await waitFor(() => expect(screen.getByTestId("definition-error-topic-1").textContent).toBe("Something broke."));
    expect(input("topic-1").value).toBe("My careful wording");
    expect(screen.getByTestId("team-definition-text-topic-1").textContent).toBe("Our build and deploy pipeline");
  });

  it("a network failure shows the fallback message and keeps the text", async () => {
    installFetch({ puts: [new Error("offline")] });
    await renderLoaded();

    openEditor("topic-2");
    type("topic-2", "Words");
    save("topic-2");

    await waitFor(() =>
      expect(screen.getByTestId("definition-error-topic-2").textContent).toBe("Unable to save the team's definition."),
    );
    expect(input("topic-2").value).toBe("Words");
  });

  it("after 422 TOPIC_ALREADY_ARCHIVED, closing the editor refetches and the topic moves to the archived list", async () => {
    const archivedElsewhere = makeTopics({
      active: [makeTopics().active[1]!],
      archived: [archivedTopic(), archivedTopic({ topicId: "topic-1", name: "Pipeline" })],
    });
    const fetchMock = installFetch({
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse(archivedElsewhere)],
      puts: [
        mockFetchResponse(
          { error: { category: "invalid_request", code: "TOPIC_ALREADY_ARCHIVED", message: "This topic is already archived." } },
          422,
        ),
      ],
    });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Words to keep");
    save("topic-1");

    await waitFor(() =>
      expect(screen.getByTestId("definition-error-topic-1").textContent).toBe("This topic is already archived."),
    );
    // The text stays so it can be copied; no refetch yet.
    expect(input("topic-1").value).toBe("Words to keep");
    expect(topicsAllGets(fetchMock)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("definition-cancel-topic-1"));

    await waitFor(() => expect(screen.queryByTestId("topic-row-topic-1")).not.toBeInTheDocument());
    expect(topicsAllGets(fetchMock)).toHaveLength(2);
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    expect(screen.getByTestId("archived-topic-row-topic-1")).toBeInTheDocument();
  });

  // Implementation review N-4: a retry after a 422 that then fails at the
  // network level keeps the pending refetch.
  it("a network failure on a retry after 422 still refetches when the editor closes", async () => {
    const fetchMock = installFetch({
      puts: [
        mockFetchResponse({ error: { code: "TOPIC_ALREADY_ARCHIVED", message: "This topic is already archived." } }, 422),
        new Error("offline"),
      ],
    });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Words");
    save("topic-1");
    await waitFor(() => screen.getByTestId("definition-error-topic-1"));

    save("topic-1");
    await waitFor(() =>
      expect(screen.getByTestId("definition-error-topic-1").textContent).toBe("Unable to save the team's definition."),
    );
    expect(annotationPuts(fetchMock)).toHaveLength(2);
    expect(topicsAllGets(fetchMock)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("definition-cancel-topic-1"));
    await waitFor(() => expect(topicsAllGets(fetchMock)).toHaveLength(2));
  });

  // Implementation review N-3: a 404/422 editor made clean again, then
  // closed by opening a Remove dialog, still runs the pending refetch.
  it("a clean 422 editor closed by a Remove dialog still refetches", async () => {
    const fetchMock = installFetch({
      puts: [mockFetchResponse({ error: { code: "TOPIC_ALREADY_ARCHIVED", message: "This topic is already archived." } }, 422)],
    });
    await renderLoaded();
    const saved = makeTopics().active[0]!.teamAnnotation ?? "";

    openEditor("topic-1");
    type("topic-1", "Words");
    save("topic-1");
    await waitFor(() => screen.getByTestId("definition-error-topic-1"));
    type("topic-1", saved);

    fireEvent.click(screen.getByTestId("remove-topic-topic-2"));

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    await waitFor(() => expect(topicsAllGets(fetchMock)).toHaveLength(2));
  });

  it("a failed quiet refetch after 422 shows an inline error and keeps the screen", async () => {
    installFetch({
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse({}, 500)],
      puts: [mockFetchResponse({ error: { code: "TOPIC_ALREADY_ARCHIVED", message: "This topic is already archived." } }, 422)],
    });
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Words");
    save("topic-1");
    await waitFor(() => screen.getByTestId("definition-error-topic-1"));
    fireEvent.click(screen.getByTestId("definition-cancel-topic-1"));

    await waitFor(() => expect(screen.getByTestId("definition-refetch-error").textContent).toBe("Unable to reload topics."));
    expect(screen.getByTestId("topic-management-view")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
  });

  it("'Saved.' has no timeout, clears on the next action on that row, and on the next successful save", async () => {
    installFetch({
      puts: [
        mockFetchResponse(annotationResponse("topic-2", "First")),
        mockFetchResponse(annotationResponse("topic-1", "Second")),
        mockFetchResponse(annotationResponse("topic-2", "Third")),
      ],
    });
    await renderLoaded();

    openEditor("topic-2");
    type("topic-2", "First");
    save("topic-2");
    await waitFor(() => expect(screen.getByTestId("definition-saved-topic-2").textContent).toBe(SAVED));

    vi.useFakeTimers();
    vi.advanceTimersByTime(10 * 60 * 1000);
    vi.useRealTimers();
    expect(screen.getByTestId("definition-saved-topic-2").textContent).toBe(SAVED);

    // The next successful definition save elsewhere replaces it.
    openEditor("topic-1");
    type("topic-1", "Second");
    save("topic-1");
    await waitFor(() => expect(screen.getByTestId("definition-saved-topic-1").textContent).toBe(SAVED));
    expect(screen.queryByTestId("definition-saved-topic-2")).not.toBeInTheDocument();

    // The next action on that row (opening its editor) clears it.
    openEditor("topic-1");
    expect(screen.getByTestId("definition-saved-topic-1").textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Task 8.5 — beforeunload
// ---------------------------------------------------------------------------
describe("team definition — leave-page guard", () => {
  it("is armed while the definition is dirty and not while it is clean", async () => {
    installFetch();
    await renderLoaded();

    openEditor("topic-1");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    type("topic-1", "Unsaved");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    type("topic-1", "  Our build and deploy pipeline  ");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 8.6 — interlocks and visibility
// ---------------------------------------------------------------------------
describe("team definition — interlocks and visibility", () => {
  it("is disabled while the reorder draft is dirty, and the unsaved order survives", async () => {
    installFetch();
    await renderLoaded();

    fireEvent.click(screen.getByTestId("move-down-topic-1"));

    const edit = screen.getByTestId("edit-definition-topic-2") as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe(ORDER_REASON);
    expect(screen.getByTestId("reorder-locked-reason").textContent).toBe(ORDER_REASON);
    fireEvent.click(edit);
    expect(screen.queryByTestId("definition-input-topic-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("topic-position-topic-2").textContent).toBe("1.");
    expect(screen.getByTestId("topic-position-topic-1").textContent).toBe("2.");
  });

  it("while a definition is dirty, moves and every Remove and Restore are disabled with the reason", async () => {
    installFetch();
    await renderLoaded();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    openEditor("topic-1");
    type("topic-1", "Unsaved");

    expect(screen.getByTestId("definition-locked-reason").textContent).toBe(DEFINITION_REASON);
    for (const id of ["topic-1", "topic-2"]) {
      expect((screen.getByTestId(`remove-topic-${id}`) as HTMLButtonElement).disabled).toBe(true);
      for (const action of ["top", "up", "down", "bottom"]) {
        expect((screen.getByTestId(`move-${action}-${id}`) as HTMLButtonElement).disabled).toBe(true);
      }
    }
    const restore = screen.getByTestId("restore-topic-topic-old") as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.title).toBe(DEFINITION_REASON);
    expect(input("topic-1").value).toBe("Unsaved");
  });

  it("a clean editor closes when a move begins, and the move is applied", async () => {
    installFetch();
    await renderLoaded();

    openEditor("topic-2");
    fireEvent.click(screen.getByTestId("move-down-topic-1"));

    expect(screen.queryByTestId("definition-input-topic-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("topic-position-topic-1").textContent).toBe("2.");
  });

  it("a clean editor closes when a Remove dialog opens", async () => {
    installFetch();
    await renderLoaded();

    openEditor("topic-1");
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-topic-dialog")).toBeInTheDocument();
  });

  it("a clean editor closes when a Restore dialog opens", async () => {
    installFetch();
    await renderLoaded();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    openEditor("topic-1");
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));

    expect(screen.queryByTestId("definition-input-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("restore-topic-dialog")).toBeInTheDocument();
  });

  it("an editor whose row is archived by a refetch closes, arms nothing, and disables nothing", async () => {
    // Real path to an orphan: closing topic-1's editor after a 404 starts a
    // quiet refetch; before it lands the facilitator opens topic-2's editor
    // and types. The refetch shows topic-2 was archived elsewhere.
    let resolveRefetch: (response: Response) => void = () => undefined;
    const pendingRefetch = new Promise<Response>((resolve) => {
      resolveRefetch = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(mockFetchResponse({ error: { code: "TOPIC_NOT_FOUND", message: "Topic not found." } }, 404));
      }
      if (url.endsWith("/topics/all")) {
        return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/topics/all")).length === 1
          ? Promise.resolve(mockFetchResponse(makeTopics()))
          : pendingRefetch;
      }
      return Promise.resolve(mockFetchResponse({}, 500));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await renderLoaded();

    openEditor("topic-1");
    type("topic-1", "Dirty words");
    save("topic-1");
    await waitFor(() => screen.getByTestId("definition-error-topic-1"));
    fireEvent.click(screen.getByTestId("definition-cancel-topic-1"));

    openEditor("topic-2");
    type("topic-2", "Also dirty");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    expect(screen.getByTestId("definition-locked-reason")).toBeInTheDocument();

    resolveRefetch(
      mockFetchResponse(
        makeTopics({
          active: [makeTopics().active[0]!],
          archived: [archivedTopic(), archivedTopic({ topicId: "topic-2", name: "Codebase Health" })],
        }),
      ),
    );

    await waitFor(() => expect(screen.queryByTestId("topic-row-topic-2")).not.toBeInTheDocument());
    expect(screen.queryByTestId("definition-editor-topic-2")).not.toBeInTheDocument();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    expect(screen.queryByTestId("definition-locked-reason")).not.toBeInTheDocument();
    expect((screen.getByTestId("remove-topic-topic-1") as HTMLButtonElement).disabled).toBe(false);
    // The orphan is gone for good: topic-1 can be edited again.
    openEditor("topic-1");
    expect(screen.getByTestId("definition-input-topic-1")).toBeInTheDocument();
  });

  // design.md Decision 10 / implementation review S-1: an editor may not be
  // opened behind an open dialog, and the disabled button says why.
  it("definition editing is unavailable while a Remove dialog is open, with the reason", async () => {
    installFetch();
    await renderLoaded();

    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));

    const edit = screen.getByTestId("edit-definition-topic-2") as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe(DIALOG_REASON);
  });

  it("definition editing is unavailable while a Restore dialog is open, with the reason", async () => {
    installFetch();
    await renderLoaded();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));

    for (const id of ["topic-1", "topic-2"]) {
      const edit = screen.getByTestId(`edit-definition-${id}`) as HTMLButtonElement;
      expect(edit.disabled).toBe(true);
      expect(edit.title).toBe(DIALOG_REASON);
    }
  });

  it("Edit carries no dialog reason when no dialog is open", async () => {
    installFetch();
    await renderLoaded();

    const edit = screen.getByTestId("edit-definition-topic-2") as HTMLButtonElement;
    expect(edit.disabled).toBe(false);
    expect(edit.title).toBe("");
  });

  it("a locked team shows no definition controls and the exact full lock notice", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ isCustomizationLocked: true }))] });
    await renderLoaded();

    expect(screen.queryByTestId("edit-definition-topic-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-definition-topic-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-lock-notice").textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session.",
    );
  });

  it("an administrator (canEditAnnotations false) sees definitions read-only", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ canEditAnnotations: false }))] });
    await renderLoaded();

    expect(screen.getByTestId("team-definition-text-topic-1").textContent).toBe("Our build and deploy pipeline");
    expect(screen.getByTestId("team-definition-provenance-topic-1")).toBeInTheDocument();
    expect(screen.queryByText("Add team definition")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-definition-topic-1")).not.toBeInTheDocument();
  });
});
