import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import {
  activeTopic,
  addPosts,
  archivedTopic,
  deferred,
  dispatchBeforeUnload,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  postedBody,
  renderPage,
  topicsAllGets,
  unparseableResponse,
} from "./topicManagementTestUtils.js";
import type { FetchMock } from "./topicManagementTestUtils.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage — topic-add-form-and-empty-state, tasks.md sections
// 4-7: the "Add custom topic" heading trigger and inline form, dirty/discard,
// validation, the duplicate check, submit outcomes, and interlocks.
// (Empty-state entry: TopicManagementPage.empty.test.tsx.)
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

const WAIT_REASON = "Wait for the new topic to finish saving.";
const ORDER_REASON = "Save or discard your order changes first.";
const DEFINITION_REASON = "Save or cancel your definition changes first.";
const DIALOG_REASON = "Finish or cancel the open remove or restore first.";
const RETRY = "The topic couldn't be added. Try again.";
const ADDED = "Added 'Partner Integration' to the end of the list. Use the move buttons to change where it falls.";

const field = {
  name: () => screen.getByTestId("add-topic-name") as HTMLInputElement,
  prompt: () => screen.getByTestId("add-topic-prompt") as HTMLTextAreaElement,
  description: () => screen.getByTestId("add-topic-description") as HTMLTextAreaElement,
  vote: (value: "finger" | "roman" | "modified_roman") => screen.getByTestId(`add-topic-vote-type-${value}`) as HTMLInputElement,
};
const trigger = () => screen.queryByRole("button", { name: "Add custom topic" });
const submitButton = () => screen.getByTestId("add-topic-submit") as HTMLButtonElement;
const activeHeading = () => screen.getByRole("heading", { level: 2, name: /^Active Topics/ });

function openForm() {
  const button = trigger();
  if (!button) throw new Error("no add trigger");
  fireEvent.click(button);
}

function fill(values: { name?: string; prompt?: string; vote?: "finger" | "roman" | "modified_roman"; description?: string }) {
  if (values.name !== undefined) fireEvent.change(field.name(), { target: { value: values.name } });
  if (values.prompt !== undefined) fireEvent.change(field.prompt(), { target: { value: values.prompt } });
  if (values.vote !== undefined) fireEvent.click(field.vote(values.vote));
  if (values.description !== undefined) fireEvent.change(field.description(), { target: { value: values.description } });
}

const VALID = { name: "Partner Integration", prompt: "How is the partner integration going?", vote: "roman" as const };

function created(topicId = "topic-new", name = "Partner Integration") {
  return mockFetchResponse(
    {
      topicId,
      name,
      prompt: "How is the partner integration going?",
      voteType: "roman",
      displayOrder: 3,
      isDefault: false,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    201,
  );
}

function withNewTopic(base: GetAllTopicsResponse = makeTopics(), topicId = "topic-new", name = "Partner Integration") {
  return makeTopics({
    ...base,
    active: [...base.active, activeTopic(topicId, name, { isDefault: false, displayOrder: 3, prompt: VALID.prompt })],
  });
}

const fetchMock = () => global.fetch as unknown as FetchMock;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Task 4.4 — trigger and fields
// ---------------------------------------------------------------------------
describe("the add trigger", () => {
  it("is shown to an eligible facilitator on an unlocked team, beside (not inside) the Active heading", async () => {
    installFetch();
    await renderPage();

    const button = trigger();
    expect(button).toBeInTheDocument();
    const heading = activeHeading();
    expect(heading).toHaveAccessibleName("Active Topics (2)");
    expect(heading.contains(button)).toBe(false);
    expect(heading.parentElement?.contains(button)).toBe(true);
  });

  it("is absent, not disabled, on a locked team, where the lock notice is shown", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ isCustomizationLocked: true }))] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-lock-notice")).toBeInTheDocument();
  });

  it("is absent for canAddTopics: false, with no message about adding topics", async () => {
    installFetch({ gets: [mockFetchResponse(makeTopics({ canAddTopics: false }))] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
    expect(screen.queryByText(/add/i, { selector: "p, div" })).not.toBeInTheDocument();
  });

  it("is absent when the response has no canAddTopics field (fails closed)", async () => {
    const withoutFlag: Partial<GetAllTopicsResponse> = makeTopics();
    delete withoutFlag.canAddTopics;
    installFetch({ gets: [mockFetchResponse(withoutFlag)] });
    await renderPage();
    expect(trigger()).not.toBeInTheDocument();
  });

  it("opens the form under the heading, focuses Name, and hides the trigger", async () => {
    installFetch();
    await renderPage();
    openForm();

    expect(screen.getByTestId("add-topic-form")).toBeInTheDocument();
    expect(field.name()).toHaveFocus();
    expect(trigger()).not.toBeInTheDocument();
    expect(
      activeHeading().compareDocumentPosition(screen.getByTestId("add-topic-form")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Cancel on a clean form closes without asking and returns focus to the trigger", async () => {
    installFetch();
    await renderPage();
    openForm();
    fireEvent.click(screen.getByTestId("add-topic-cancel"));

    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(screen.queryByText("Discard this topic?")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("opening the form clears a screen message", async () => {
    installFetch({
      gets: [mockFetchResponse(makeTopics({ active: [...makeTopics().active, activeTopic("topic-3", "Deploys")] })), mockFetchResponse({}, 500)],
      removes: [mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" })],
    });
    await renderPage();
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));
    await waitFor(() => expect(screen.getByTestId("screen-message")).toBeInTheDocument());

    openForm();
    expect(screen.queryByTestId("screen-message")).not.toBeInTheDocument();
  });
});

describe("the add form's fields", () => {
  it("has no vote type preselected, with the group helper above the options", async () => {
    installFetch();
    await renderPage();
    openForm();

    for (const value of ["finger", "roman", "modified_roman"] as const) {
      expect(field.vote(value)).not.toBeChecked();
    }
    const helper = screen.getByText(
      "You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend.",
    );
    expect(helper.compareDocumentPosition(field.vote("finger")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the exact labels, helpers, and option explanations, in spec order", async () => {
    installFetch();
    await renderPage();
    openForm();
    const form = screen.getByTestId("add-topic-form");

    expect(within(form).getByLabelText(/^Name/)).toBe(field.name());
    expect(within(form).getByLabelText(/^Prompt/)).toBe(field.prompt());
    expect(within(form).getByLabelText("Description (optional, shown on this screen only)")).toBe(field.description());
    expect(within(form).getByText("A short label for this screen and trend views.")).toBeInTheDocument();
    expect(within(form).getByText("The question you'll read aloud for people to vote on.")).toBeInTheDocument();
    expect(
      within(form).getByText(
        "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for this team.",
      ),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText("Finger Voting")).toBe(field.vote("finger"));
    expect(within(form).getByLabelText("Roman Voting")).toBe(field.vote("roman"));
    expect(within(form).getByLabelText("Modified Roman Voting")).toBe(field.vote("modified_roman"));
    expect(
      within(form).getByText(
        "Everyone shows 1 to 4 fingers, where 1 is poor and 4 is good. There's no middle option, so people have to lean one way.",
      ),
    ).toBeInTheDocument();
    expect(within(form).getByText("Thumbs up or thumbs down. Use it for yes-or-no questions.")).toBeInTheDocument();
    expect(
      within(form).getByText(
        "Thumbs up, sideways, or down. Use it for whether something is getting better, staying the same, or getting worse.",
      ),
    ).toBeInTheDocument();

    // Required / optional markers and limits.
    expect(field.name()).toHaveAttribute("aria-required", "true");
    expect(field.prompt()).toHaveAttribute("aria-required", "true");
    expect(within(form).getByText("Vote type")).toBeInTheDocument();
    expect(field.description()).not.toHaveAttribute("aria-required");
    expect(field.name()).toHaveAttribute("maxLength", "100");
    expect(field.prompt()).toHaveAttribute("maxLength", "500");
    expect(field.description()).toHaveAttribute("maxLength", "500");

    // Field order: Name, Prompt, Vote type, Description.
    const order = [field.name(), field.prompt(), field.vote("finger"), field.description()];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows a counter at 80% of the limit ('80 / 100'), not as a live region, referenced by aria-describedby", async () => {
    installFetch();
    await renderPage();
    openForm();

    fill({ name: "x".repeat(79) });
    expect(screen.queryByTestId("add-topic-name-counter")).not.toBeInTheDocument();
    expect(field.name().getAttribute("aria-describedby")).not.toContain("add-topic-name-counter");

    fill({ name: "x".repeat(80) });
    const counter = screen.getByTestId("add-topic-name-counter");
    expect(counter).toHaveTextContent("80 / 100");
    expect(counter).not.toHaveAttribute("aria-live");
    expect(counter).not.toHaveAttribute("role");
    expect(field.name().getAttribute("aria-describedby")).toContain("add-topic-name-counter");

    fill({ prompt: "y".repeat(400) });
    expect(screen.getByTestId("add-topic-prompt-counter")).toHaveTextContent("400 / 500");
  });

  it("allows identical name and prompt", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())] });
    await renderPage();
    openForm();
    fill({ name: "Same text", prompt: "Same text", vote: "finger" });
    fireEvent.click(submitButton());

    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(1));
  });
});

// ---------------------------------------------------------------------------
// Task 5.2 — dirty state and discard
// ---------------------------------------------------------------------------
describe("discarding a dirty add form", () => {
  it("Cancel asks first; Keep editing keeps the values", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Partner" });
    fireEvent.click(screen.getByTestId("add-topic-cancel"));

    expect(screen.getByText("Discard this topic?")).toBeInTheDocument();
    expect(within(screen.getByTestId("add-topic-form")).getByRole("button", { name: "Discard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByText("Discard this topic?")).not.toBeInTheDocument();
    expect(field.name()).toHaveValue("Partner");
  });

  it("Discard closes and resets the form and returns focus to the heading trigger", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Partner", vote: "finger" });
    fireEvent.click(screen.getByTestId("add-topic-cancel"));
    fireEvent.click(within(screen.getByTestId("add-topic-form")).getByRole("button", { name: "Discard" }));

    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    openForm();
    expect(field.name()).toHaveValue("");
    expect(field.vote("finger")).not.toBeChecked();
  });

  it("a dirty form arms beforeunload; a clean one does not", async () => {
    installFetch();
    await renderPage();
    openForm();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    fill({ vote: "finger" });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("a dirty add form survives a failed post-Remove refetch with its values intact", async () => {
    installFetch({
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse({}, 500)],
      removes: [mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-10-01T00:00:00.000Z" })],
    });
    await renderPage();
    openForm();
    fill({ name: "Partner Integration", prompt: "Draft prompt" });

    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() =>
      expect(screen.getByTestId("screen-message")).toHaveTextContent(
        "Archived 'Pairing Effectiveness', but the list couldn't be refreshed. Reload the page to see it.",
      ),
    );
    expect(field.name()).toHaveValue("Partner Integration");
    expect(field.prompt()).toHaveValue("Draft prompt");
  });
});

// ---------------------------------------------------------------------------
// Task 6.1 — client validation and payload
// ---------------------------------------------------------------------------
describe("client validation", () => {
  it("blank required fields block submission, each with its message, focusing the first", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "   ", prompt: "A prompt" });
    fireEvent.click(submitButton());

    expect(addPosts(fetchMock())).toHaveLength(0);
    expect(screen.getByTestId("add-topic-name-error")).toHaveTextContent("Enter a topic name.");
    expect(screen.getByTestId("add-topic-vote-type-error")).toHaveTextContent("Choose a vote type.");
    expect(screen.queryByTestId("add-topic-prompt-error")).not.toBeInTheDocument();
    expect(field.name()).toHaveFocus();
    expect(field.prompt()).toHaveValue("A prompt");
  });

  it("an empty prompt shows 'Enter a prompt.'", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Name", vote: "finger" });
    fireEvent.click(submitButton());
    expect(screen.getByTestId("add-topic-prompt-error")).toHaveTextContent("Enter a prompt.");
    expect(field.prompt()).toHaveFocus();
  });

  it("sends trimmed values and a whitespace-only description as null", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())] });
    await renderPage();
    openForm();
    fill({ name: "  Partner Integration  ", prompt: "  How is it going?  ", vote: "roman", description: "    " });
    fireEvent.click(submitButton());

    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(1));
    expect(postedBody(fetchMock())).toEqual({
      name: "Partner Integration",
      prompt: "How is it going?",
      voteType: "roman",
      firstSessionDescription: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Task 6.2 — duplicate check
// ---------------------------------------------------------------------------
describe("the duplicate check", () => {
  const ARCHIVED_WARNING = "This team has an archived topic called 'Codebase Health'. Restoring it keeps its history in one trend.";

  it("retyping an archived topic's question (spaces, case) offers the archived topic first", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Code quality", prompt: "  is the codebase easy to work with?  ", vote: "finger" });
    fireEvent.click(submitButton());

    expect(addPosts(fetchMock())).toHaveLength(0);
    const warning = screen.getByTestId("add-duplicate-warning");
    expect(warning).toHaveTextContent(ARCHIVED_WARNING);
    expect(within(warning).getByRole("button", { name: "Show it in Archived topics" })).toBeInTheDocument();
    expect(within(warning).getByRole("button", { name: "Add as a new topic anyway" })).toBeInTheDocument();
  });

  it("'Show it in Archived topics' expands Archived, focuses the row heading, keeps the form, restores nothing", async () => {
    const fetch = installFetch();
    await renderPage();
    openForm();
    fill({ name: "codebase health", prompt: "Something new", vote: "finger" });
    fireEvent.click(submitButton());
    fireEvent.click(screen.getByRole("button", { name: "Show it in Archived topics" }));

    expect(screen.getByTestId("archived-topic-heading-topic-old")).toHaveFocus();
    expect(field.name()).toHaveValue("codebase health");
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/restore"))).toBe(false);
  });

  it("several archived matches resolve to the first in display order", async () => {
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({
            archived: [
              archivedTopic("arch-dep", "Deployment", { prompt: "How confident are deploys?" }),
              archivedTopic("arch-cb", "Codebase Health", { prompt: "Is the codebase easy to work with?" }),
            ],
          }),
        ),
      ],
    });
    await renderPage();
    openForm();
    fill({ name: "Codebase Health", prompt: "how confident are deploys?", vote: "finger" });
    fireEvent.click(submitButton());

    expect(screen.getByTestId("add-duplicate-warning")).toHaveTextContent("called 'Deployment'");
    fireEvent.click(screen.getByRole("button", { name: "Show it in Archived topics" }));
    expect(screen.getByTestId("archived-topic-heading-arch-dep")).toHaveFocus();
  });

  it("internal whitespace differences are not a match", async () => {
    installFetch({
      adds: [created()],
      gets: [mockFetchResponse(makeTopics({ active: [activeTopic("t1", "Codebase Health"), activeTopic("t2", "Pipeline")] })), mockFetchResponse(withNewTopic())],
    });
    await renderPage();
    openForm();
    fill({ name: "Codebase  Health", prompt: "Matches nothing", vote: "finger" });
    fireEvent.click(submitButton());

    expect(screen.queryByTestId("add-duplicate-warning")).not.toBeInTheDocument();
    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(1));
  });

  it("an active name match warns, and 'Add anyway' sends the entered values", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())] });
    await renderPage();
    openForm();
    fill({ name: "pipeline", prompt: "Brand new question", vote: "roman" });
    fireEvent.click(submitButton());

    expect(addPosts(fetchMock())).toHaveLength(0);
    expect(screen.getByTestId("add-duplicate-warning")).toHaveTextContent(
      "This team already has an active topic called 'Pipeline'. Two topics with the same name or question can confuse people during the vote.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));

    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(1));
    expect(postedBody(fetchMock())).toMatchObject({ name: "pipeline", prompt: "Brand new question", voteType: "roman" });
  });

  it("the archived message wins when both an active and an archived topic match", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Pipeline", prompt: "Is the codebase easy to work with?", vote: "finger" });
    fireEvent.click(submitButton());
    expect(screen.getByTestId("add-duplicate-warning")).toHaveTextContent(ARCHIVED_WARNING);
  });

  it("editing Prompt dismisses a name-match warning", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Pipeline", prompt: "Something", vote: "finger" });
    fireEvent.click(submitButton());
    expect(screen.getByTestId("add-duplicate-warning")).toBeInTheDocument();

    fill({ prompt: "Something else" });
    expect(screen.queryByTestId("add-duplicate-warning")).not.toBeInTheDocument();
  });

  it("an override is not asked again on retry, until Name or Prompt is edited", async () => {
    installFetch({ adds: [new Error("offline"), envelope(500, "INTERNAL", "boom")] });
    await renderPage();
    openForm();
    fill({ name: "Pipeline", prompt: "Something", vote: "finger" });
    fireEvent.click(submitButton());
    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(RETRY));

    fireEvent.click(submitButton());
    expect(screen.queryByTestId("add-duplicate-warning")).not.toBeInTheDocument();
    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(2));
    await waitFor(() => expect(submitButton()).toHaveTextContent("Submit"));

    fill({ name: "PIPELINE" });
    fireEvent.click(submitButton());
    expect(screen.getByTestId("add-duplicate-warning")).toBeInTheDocument();
    expect(addPosts(fetchMock())).toHaveLength(2);
  });

  // Security implementation review N-2: the duplicate warning is the third
  // sink for server-supplied topic text.
  it("shows a matched topic's name as literal text, creating no element from it", async () => {
    const name = "<img src=x onerror=alert(1)>";
    installFetch({ gets: [mockFetchResponse(makeTopics({ archived: [archivedTopic("arch-x", name)] }))] });
    await renderPage();
    openForm();
    fill({ name, prompt: "Something new", vote: "finger" });
    fireEvent.click(submitButton());

    expect(screen.getByTestId("add-duplicate-warning")).toHaveTextContent(`called '${name}'`);
    expect(document.querySelector("img")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 6.3 — "add submitting" disables everything else
// ---------------------------------------------------------------------------
describe("while an add request is in flight", () => {
  async function startInFlightAdd() {
    const pending = deferred<Response>();
    installFetch({ adds: [pending.promise] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(addPosts(fetchMock())).toHaveLength(1));
    return pending;
  }

  it("every move control is disabled with the in-flight reason", async () => {
    await startInFlightAdd();
    for (const id of ["move-down-topic-1", "move-bottom-topic-1", "move-up-topic-2", "move-top-topic-2"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", WAIT_REASON);
    }
  });

  it("Save order is disabled with the in-flight reason", async () => {
    await startInFlightAdd();
    expect(screen.getByTestId("reorder-save")).toBeDisabled();
    expect(screen.getByTestId("reorder-save")).toHaveAttribute("title", WAIT_REASON);
  });

  it("every Remove is disabled with the in-flight reason", async () => {
    await startInFlightAdd();
    for (const id of ["remove-topic-topic-1", "remove-topic-topic-2"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", WAIT_REASON);
    }
  });

  it("every Restore is disabled with the in-flight reason", async () => {
    await startInFlightAdd();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    expect(screen.getByTestId("restore-topic-topic-old")).toBeDisabled();
    expect(screen.getByTestId("restore-topic-topic-old")).toHaveAttribute("title", WAIT_REASON);
  });

  it("every definition add/edit control is disabled with the in-flight reason", async () => {
    await startInFlightAdd();
    for (const id of ["edit-definition-topic-1", "edit-definition-topic-2"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", WAIT_REASON);
    }
  });

  it("shows only the in-flight reason as visible text", async () => {
    await startInFlightAdd();
    expect(screen.getAllByTestId("add-submitting-reason")).toHaveLength(1);
    expect(screen.getByTestId("add-submitting-reason")).toHaveTextContent(WAIT_REASON);
    expect(screen.queryByTestId("reorder-locked-reason")).not.toBeInTheDocument();
    expect(screen.queryByTestId("definition-locked-reason")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-topic-submit-reason")).not.toBeInTheDocument();
  });

  it("sending closes a clean open definition editor, leaving no definition Save", async () => {
    const pending = deferred<Response>();
    installFetch({ adds: [pending.promise] });
    await renderPage();
    fireEvent.click(screen.getByTestId("edit-definition-topic-2"));
    openForm();
    fill(VALID);
    expect(screen.getByTestId("definition-editor-topic-2")).toBeInTheDocument();

    fireEvent.click(submitButton());
    expect(screen.queryByTestId("definition-editor-topic-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("definition-save-topic-2")).not.toBeInTheDocument();
  });

  // Task 6.4
  it("Submit reads 'Adding…' and is disabled, fields are read-only, and nothing double-posts", async () => {
    await startInFlightAdd();
    expect(submitButton()).toHaveTextContent("Adding…");
    expect(submitButton()).toBeDisabled();
    expect(field.name()).toHaveAttribute("readonly");
    expect(field.prompt()).toHaveAttribute("readonly");
    expect(field.description()).toHaveAttribute("readonly");
    expect(field.vote("roman")).toBeDisabled();

    fireEvent.click(submitButton());
    fireEvent.submit(screen.getByTestId("add-topic-form"));
    expect(addPosts(fetchMock())).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task 6.5 — success paths
// ---------------------------------------------------------------------------
describe("a successful add", () => {
  it("appends, announces, closes the form, and focuses the new row's heading", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument());
    const rows = screen.getAllByTestId(/^topic-row-/);
    expect(rows[rows.length - 1]).toHaveAttribute("data-testid", "topic-row-topic-new");
    const message = screen.getByTestId("screen-message");
    expect(message).toHaveAttribute("role", "status");
    expect(message).toHaveTextContent(ADDED);
    expect(screen.getByTestId("topic-heading-topic-new")).toHaveFocus();
    expect(activeHeading()).toHaveAccessibleName("Active Topics (3)");
  });

  it("focus falls back to the Active heading when the new topic is not in the refreshed list", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics())] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument());
    expect(activeHeading()).toHaveFocus();
    expect(screen.getByTestId("screen-message")).toHaveTextContent(ADDED);
  });

  it("a refetch failure after the add says the topic was added, as an alert, focus on the heading", async () => {
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), mockFetchResponse({}, 503)] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("screen-message")).toHaveTextContent(
        "Added 'Partner Integration', but the list couldn't be refreshed. Reload the page to see it.",
      ),
    );
    expect(screen.getByTestId("screen-message")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(activeHeading()).toHaveFocus();
    expect(screen.getAllByTestId(/^topic-row-/)).toHaveLength(2);
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
  });

  it("an unreadable 201 body still says the topic was added and focuses the heading", async () => {
    installFetch({
      adds: [{ ...unparseableResponse(201), ok: true } as Response],
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())],
    });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("screen-message")).toHaveTextContent(ADDED));
    expect(screen.queryByText(RETRY)).not.toBeInTheDocument();
    expect(activeHeading()).toHaveFocus();
  });

  it("keeps other controls locked until the post-add refetch settles", async () => {
    const refetch = deferred<Response>();
    installFetch({ adds: [created()], gets: [mockFetchResponse(makeTopics()), refetch.promise] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(topicsAllGets(fetchMock())).toHaveLength(2));

    expect(submitButton()).toHaveTextContent("Adding…");
    expect(screen.getByTestId("move-down-topic-1")).toBeDisabled();
    expect(screen.getByTestId("move-down-topic-1")).toHaveAttribute("title", WAIT_REASON);

    await act(async () => {
      refetch.resolve(mockFetchResponse(withNewTopic()));
    });
    await waitFor(() => expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument());
    expect(screen.getByTestId("move-down-topic-1")).toBeEnabled();
  });

  it("shows topic text as literal text, creating no element from it", async () => {
    const name = "<img src=x onerror=alert(1)>";
    installFetch({
      adds: [created("topic-x", name)],
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic(makeTopics(), "topic-x", name))],
    });
    await renderPage();
    openForm();
    fill({ ...VALID, name });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("screen-message")).toHaveTextContent(
        `Added '${name}' to the end of the list. Use the move buttons to change where it falls.`,
      ),
    );
    expect(screen.getByTestId("topic-heading-topic-x")).toHaveTextContent(name);
    expect(document.querySelector("img")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 6.6 — failure paths
// ---------------------------------------------------------------------------
describe("a failed add", () => {
  it.each([
    [403, "NOT_A_FACILITATOR", "Only facilitators can add topics."],
    [403, "FACILITATOR_IS_TEAM_MEMBER", "You are a member of this team and cannot add its topics."],
    [404, "TEAM_NOT_FOUND", "Team not found."],
  ])("%s %s keeps the form and values and shows the server message", async (status, code, message) => {
    installFetch({ adds: [envelope(status, code, message)] });
    await renderPage();
    openForm();
    fill({ ...VALID, description: "A note" });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(message));
    expect(screen.getByTestId("add-form-error")).toHaveAttribute("role", "alert");
    expect(field.name()).toHaveValue(VALID.name);
    expect(field.prompt()).toHaveValue(VALID.prompt);
    expect(field.vote("roman")).toBeChecked();
    expect(field.description()).toHaveValue("A note");
    expect(submitButton()).toHaveTextContent("Submit");
    expect(submitButton()).toBeEnabled();
    expect(field.name()).not.toHaveAttribute("readonly");
    expect(field.vote("roman")).toBeEnabled();
  });

  it("a form-level alert is cleared by the next Submit", async () => {
    const second = deferred<Response>();
    installFetch({ adds: [envelope(403, "NOT_A_FACILITATOR", "Only facilitators can add topics."), second.promise] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByTestId("add-form-error")).toBeInTheDocument());

    fireEvent.click(submitButton());
    expect(screen.queryByTestId("add-form-error")).not.toBeInTheDocument();
  });

  it("a 422 field error lands on its field with the screen's own copy", async () => {
    installFetch({ adds: [envelope(422, "VALIDATION_FAILED", "prompt is required, must be non-empty…", "prompt")] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("add-topic-prompt-error")).toHaveTextContent("Enter a prompt of up to 500 characters."),
    );
    expect(field.prompt()).toHaveFocus();
    expect(screen.queryByText(/prompt is required/)).not.toBeInTheDocument();
    expect(field.name()).toHaveValue(VALID.name);
    expect(field.prompt()).toHaveValue(VALID.prompt);
  });

  it.each([
    ["name", "Enter a topic name of up to 100 characters."],
    ["firstSessionDescription", "Keep the description to 500 characters or fewer."],
  ])("a 422 on %s shows the screen's message", async (fieldName, message) => {
    installFetch({ adds: [envelope(422, "VALIDATION_FAILED", "developer text", fieldName)] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByText("developer text")).not.toBeInTheDocument();
  });

  it.each([undefined, "teamId"])("a 422 with field %s shows the fixed form-level message", async (fieldName) => {
    installFetch({ adds: [envelope(422, "VALIDATION_FAILED", "developer text", fieldName)] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("add-form-error")).toHaveTextContent(
        "The topic couldn't be added. Check each field and try again.",
      ),
    );
    expect(screen.queryByText("developer text")).not.toBeInTheDocument();
  });

  it("a 409 lock conflict refetches, closes the form, alerts, and removes the control when locked", async () => {
    installFetch({
      adds: [envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "Locked.")],
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse(makeTopics({ isCustomizationLocked: true }))],
    });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("screen-message")).toHaveTextContent("Topics can't be added to this team right now."),
    );
    expect(screen.getByTestId("screen-message")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-lock-notice")).toBeInTheDocument();
    expect(trigger()).not.toBeInTheDocument();
    expect(activeHeading()).toHaveFocus();
  });

  it("a 409 whose refetch reports the team unlocked leaves the add control shown, values discarded", async () => {
    installFetch({ adds: [envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "Locked.")] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument());
    expect(trigger()).toBeInTheDocument();
    openForm();
    expect(field.name()).toHaveValue("");
  });

  it("a 409 whose refetch fails keeps the screen with the reload variant", async () => {
    installFetch({
      adds: [envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "Locked.")],
      gets: [mockFetchResponse(makeTopics()), new Error("offline")],
    });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByTestId("screen-message")).toHaveTextContent(
        "Topics can't be added to this team right now. Reload the page to see the current state.",
      ),
    );
    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topic-management-error")).not.toBeInTheDocument();
  });

  // Architect implementation review N4: like the 201 path, the 409 and
  // network/5xx outcomes hold the lock until their refetch settles.
  it("a 409 keeps other controls locked until its refetch settles", async () => {
    const refetch = deferred<Response>();
    installFetch({ adds: [envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "Locked.")], gets: [mockFetchResponse(makeTopics()), refetch.promise] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(topicsAllGets(fetchMock())).toHaveLength(2));

    expect(submitButton()).toHaveTextContent("Adding…");
    expect(screen.getByTestId("move-down-topic-1")).toBeDisabled();
    expect(screen.getByTestId("move-down-topic-1")).toHaveAttribute("title", WAIT_REASON);

    await act(async () => {
      refetch.resolve(mockFetchResponse(makeTopics()));
    });
    await waitFor(() => expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument());
    expect(screen.getByTestId("move-down-topic-1")).toBeEnabled();
  });

  it.each([
    ["a network failure", () => new Error("offline")],
    ["a 5xx", () => unparseableResponse(502)],
  ])("%s keeps other controls locked until its refetch settles", async (_label, reply) => {
    const refetch = deferred<Response>();
    installFetch({ adds: [reply()], gets: [mockFetchResponse(makeTopics()), refetch.promise] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());
    await waitFor(() => expect(topicsAllGets(fetchMock())).toHaveLength(2));

    expect(submitButton()).toHaveTextContent("Adding…");
    expect(screen.getByTestId("move-down-topic-1")).toBeDisabled();
    expect(screen.queryByTestId("add-form-error")).not.toBeInTheDocument();

    await act(async () => {
      refetch.resolve(mockFetchResponse(makeTopics()));
    });
    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(RETRY));
    expect(submitButton()).toHaveTextContent("Submit");
    expect(screen.getByTestId("move-down-topic-1")).toBeEnabled();
  });

  it("a network failure keeps the values for a retry", async () => {
    installFetch({ adds: [new Error("offline")] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(RETRY));
    expect(field.name()).toHaveValue(VALID.name);
    expect(submitButton()).toHaveTextContent("Submit");
    expect(submitButton()).toBeEnabled();
    expect(field.prompt()).not.toHaveAttribute("readonly");
  });

  it("a 502 with an HTML body uses the fixed retry message and shows none of the body", async () => {
    installFetch({ adds: [unparseableResponse(502)] });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(RETRY));
    expect(screen.queryByText(/Bad gateway/)).not.toBeInTheDocument();
    expect(field.name()).toHaveValue(VALID.name);
  });

  it("a network failure refreshes the lists, so a retry's duplicate check sees the created topic", async () => {
    installFetch({
      adds: [new Error("offline")],
      gets: [mockFetchResponse(makeTopics()), mockFetchResponse(withNewTopic())],
    });
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("add-form-error")).toHaveTextContent(RETRY));
    expect(screen.getByTestId("topic-row-topic-new")).toBeInTheDocument();
    expect(field.name()).toHaveValue(VALID.name);

    fireEvent.click(submitButton());
    expect(screen.getByTestId("add-duplicate-warning")).toHaveTextContent(
      "This team already has an active topic called 'Partner Integration'.",
    );
    expect(addPosts(fetchMock())).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task 7.2 — Submit gated by other busy states
// ---------------------------------------------------------------------------
describe("Submit is gated by other busy states", () => {
  it("is disabled while the reorder draft is dirty; fields stay editable", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(screen.getByTestId("move-down-topic-1"));

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute("title", ORDER_REASON);
    expect(screen.getByTestId("add-topic-submit-reason")).toHaveTextContent(ORDER_REASON);
    fill({ name: "Still editable" });
    expect(field.name()).toHaveValue("Still editable");
  });

  it("is disabled while a definition is dirty", async () => {
    installFetch();
    await renderPage();
    fireEvent.click(screen.getByTestId("edit-definition-topic-2"));
    fireEvent.change(screen.getByTestId("definition-input-topic-2"), { target: { value: "Our meaning" } });
    openForm();
    fill(VALID);

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute("title", DEFINITION_REASON);
  });

  it("is disabled while a Remove confirmation is open", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute("title", DIALOG_REASON);
  });

  it("is disabled while a Restore confirmation is open", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill(VALID);
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute("title", DIALOG_REASON);
  });

  it("'Add anyway' is gated like Submit while the reorder draft is dirty", async () => {
    installFetch();
    await renderPage();
    openForm();
    fill({ name: "Pipeline", prompt: "New question", vote: "finger" });
    fireEvent.click(submitButton());
    fireEvent.click(screen.getByTestId("move-down-topic-1"));

    const addAnyway = screen.getByRole("button", { name: "Add anyway" });
    expect(addAnyway).toBeDisabled();
    expect(addAnyway).toHaveAttribute("title", ORDER_REASON);
    fireEvent.click(addAnyway);
    expect(addPosts(fetchMock())).toHaveLength(0);
  });

  it("the heading trigger still opens the form while a reorder draft is dirty", async () => {
    installFetch();
    await renderPage();
    fireEvent.click(screen.getByTestId("move-down-topic-1"));
    openForm();
    expect(screen.getByTestId("add-topic-form")).toBeInTheDocument();
    expect(field.name()).toHaveFocus();
  });

  it.each([
    ["clean", {}],
    ["dirty", { name: "Typed name", prompt: "Typed prompt" }],
  ])("a %s idle add form locks nothing", async (_label, values) => {
    installFetch();
    await renderPage();
    openForm();
    fill(values);

    expect(screen.getByTestId("move-down-topic-1")).toBeEnabled();
    expect(screen.getByTestId("move-up-topic-2")).toBeEnabled();
    expect(screen.getByTestId("remove-topic-topic-1")).toBeEnabled();
    expect(screen.getByTestId("edit-definition-topic-1")).toBeEnabled();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    expect(screen.getByTestId("restore-topic-topic-old")).toBeEnabled();
    expect(screen.queryByTestId("add-submitting-reason")).not.toBeInTheDocument();
  });

  it("a team change discards an open add form, and no add request is sent for either team", async () => {
    const fetch = installFetch();
    await renderPage();
    openForm();
    fill({ name: "Typed for team one" });

    fireEvent.click(screen.getByTestId("switch-team"));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/teams/team-2/"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("topic-management-view")).toBeInTheDocument());

    expect(screen.queryByTestId("add-topic-form")).not.toBeInTheDocument();
    expect(addPosts(fetch)).toHaveLength(0);
  });
});
