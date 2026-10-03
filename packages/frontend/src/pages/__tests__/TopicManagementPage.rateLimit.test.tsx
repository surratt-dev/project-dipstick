import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import {
  TOPIC_WRITE_BURST_LIMIT_EXCEEDED,
  TOPIC_WRITE_RATE_LIMIT_MESSAGES,
  TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE,
} from "@dipstick/shared";
import {
  activeTopic,
  archivedTopic,
  addPosts,
  envelope,
  installFetch,
  makeTopics,
  mockFetchResponse,
  renderPage,
  topicsAllGets,
} from "./topicManagementTestUtils.js";
import type { FetchMock } from "./topicManagementTestUtils.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) tasks 6.3-6.5 — a 429 or 503 on a topic
// write reads as a pause: the message goes in that control's existing error
// region, typed input survives, nothing is retried, and there is no
// page-wide banner. Spec: topic-management-screen.
// ---------------------------------------------------------------------------

const BURST = TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst;
const BURST_5_MIN =
  "You've made a lot of topic changes in a short time. Changes so far are saved. Please wait about 5 minutes and try again.";
const UNAVAILABLE =
  "Topic changes are temporarily unavailable. This change wasn't saved; changes you made earlier are kept. Please try again shortly.";

const burst429 = (headers?: Record<string, string>) =>
  envelope(429, TOPIC_WRITE_BURST_LIMIT_EXCEEDED, BURST, undefined, headers);
const unavailable503 = () => envelope(503, TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE, UNAVAILABLE, undefined, { "Retry-After": "30" });

const CASES = [
  { label: "429 with Retry-After", reply: () => burst429({ "Retry-After": "290" }), shown: BURST_5_MIN },
  { label: "429 without Retry-After", reply: () => burst429(), shown: BURST },
  { label: "503", reply: unavailable503, shown: UNAVAILABLE },
] as const;

function writeCalls(fetchMock: FetchMock, method: string, suffix: RegExp) {
  return fetchMock.mock.calls.filter(([url, init]) => init?.method === method && suffix.test(String(url)));
}

function expectNoPageBanner() {
  expect(screen.queryByTestId("screen-message")).toBeNull();
  expect(screen.getByTestId("topic-management-view")).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(CASES)("Topic Management on a $label (#184 6.3)", ({ reply, shown }) => {
  it("add: the form stays open with every field and shows the message in its error area", async () => {
    const fetchMock = installFetch({ adds: [reply()] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add custom topic" }));
    fireEvent.change(screen.getByTestId("add-topic-name"), { target: { value: "Partner Integration" } });
    fireEvent.change(screen.getByTestId("add-topic-prompt"), { target: { value: "How smooth are partner hand-offs?" } });
    fireEvent.click(screen.getByTestId("add-topic-vote-type-roman"));
    fireEvent.change(screen.getByTestId("add-topic-description"), { target: { value: "Our partner work" } });
    const getsBefore = topicsAllGets(fetchMock).length;

    fireEvent.click(screen.getByTestId("add-topic-submit"));

    await waitFor(() => expect(screen.getByTestId("add-form-error").textContent).toBe(shown));
    expect((screen.getByTestId("add-topic-name") as HTMLInputElement).value).toBe("Partner Integration");
    expect((screen.getByTestId("add-topic-prompt") as HTMLTextAreaElement).value).toBe("How smooth are partner hand-offs?");
    expect((screen.getByTestId("add-topic-vote-type-roman") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("add-topic-description") as HTMLTextAreaElement).value).toBe("Our partner work");
    expect(addPosts(fetchMock)).toHaveLength(1);
    expect(topicsAllGets(fetchMock)).toHaveLength(getsBefore);
    expectNoPageBanner();
  });

  it("reorder: the draft stays, marked unsaved, Save order stays enabled, and the save-error region shows the message", async () => {
    const fetchMock = installFetch({ reorders: [reply()] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Move to top: Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(screen.getByTestId("reorder-save-error").textContent).toBe(shown));
    const order = screen.getAllByTestId(/^topic-row-/).map((row) => row.getAttribute("data-testid"));
    expect(order).toEqual(["topic-row-topic-2", "topic-row-topic-1"]);
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
    expect(writeCalls(fetchMock, "PUT", /\/topics\/order$/)).toHaveLength(1);
    expectNoPageBanner();
  });

  it("definition: the editor stays open with the typed text and shows the message", async () => {
    const fetchMock = installFetch({ annotations: [reply()] });
    await renderPage();
    fireEvent.click(screen.getByTestId("edit-definition-topic-1"));
    fireEvent.change(screen.getByTestId("definition-input-topic-1"), { target: { value: "Pairing, as we mean it" } });
    fireEvent.click(screen.getByTestId("definition-save-topic-1"));

    await waitFor(() => expect(screen.getByTestId("definition-error-topic-1").textContent).toBe(shown));
    expect((screen.getByTestId("definition-input-topic-1") as HTMLTextAreaElement).value).toBe("Pairing, as we mean it");
    expect(writeCalls(fetchMock, "PUT", /\/annotation$/)).toHaveLength(1);
    expectNoPageBanner();
  });

  it("restore: the restore's error area shows the message; nothing is retried or refetched", async () => {
    const fetchMock = installFetch({ restores: [reply()] });
    await renderPage();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
    const getsBefore = topicsAllGets(fetchMock).length;
    fireEvent.click(screen.getByTestId("confirm-restore-topic-old"));

    await waitFor(() => expect(screen.getByTestId("restore-error-topic-old").textContent).toBe(shown));
    expect(writeCalls(fetchMock, "POST", /\/restore$/)).toHaveLength(1);
    expect(topicsAllGets(fetchMock)).toHaveLength(getsBefore);
    expectNoPageBanner();
  });

  it("archive pre-flight: the remove error area shows the message", async () => {
    const fetchMock = installFetch({ removes: [reply()] });
    await renderPage();
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() => expect(screen.getByTestId("remove-error-topic-1").textContent).toBe(shown));
    expect(writeCalls(fetchMock, "DELETE", /\/topics\/topic-1$/)).toHaveLength(1);
    expectNoPageBanner();
  });

  it("archive confirm: the escalated confirmation stays open with its list, shows the message, and Archive anyway stays enabled (6.5)", async () => {
    const fetchMock = installFetch({
      removes: [
        mockFetchResponse({
          requiresConfirmation: true,
          reason: "openActionItems",
          openActionItemCount: 1,
          openActionItems: [{ actionItemId: "ai-1", description: "Fix the flaky test" }],
          message: "1 open action item will stay open, but nothing will remind anyone about them going forward.",
        }),
        reply(),
      ],
    });
    await renderPage();
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));
    await waitFor(() => screen.getByTestId("confirm-archive-anyway-topic-1"));

    fireEvent.click(screen.getByTestId("confirm-archive-anyway-topic-1"));

    await waitFor(() => expect(screen.getByTestId("open-items-confirm-error-topic-1").textContent).toBe(shown));
    const list = screen.getByTestId("open-action-items-list-topic-1");
    expect(within(list).getByText("Fix the flaky test")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-archive-anyway-topic-1")).toBeEnabled();
    expect(screen.queryByTestId("remove-error-topic-1")).toBeNull();
    const deletes = writeCalls(fetchMock, "DELETE", /\/topics\/topic-1(\?confirm=true)?$/);
    expect(deletes.map(([url]) => String(url).endsWith("?confirm=true"))).toEqual([false, true]);
    expectNoPageBanner();
  });
});

describe("a series of single restores limited part-way (#184 6.4)", () => {
  it("k-1 restores succeed and refetch; the k-th 429 shows in its own error area and the earlier ones stay restored", async () => {
    const a = archivedTopic("arch-a", "Alpha");
    const b = archivedTopic("arch-b", "Bravo");
    const c = archivedTopic("arch-c", "Charlie");
    const base = makeTopics({ archived: [a, b, c] });
    const afterA = makeTopics({
      active: [...base.active, activeTopic("arch-a", "Alpha", { displayOrder: 3 })],
      archived: [b, c],
    });
    const afterB = makeTopics({
      active: [...afterA.active, activeTopic("arch-b", "Bravo", { displayOrder: 4 })],
      archived: [c],
    });
    const fetchMock = installFetch({
      gets: [mockFetchResponse(base), mockFetchResponse(afterA), mockFetchResponse(afterB)],
      restores: [
        mockFetchResponse({ topicId: "arch-a", name: "Alpha", status: "active", displayOrder: 3, restoredAt: "2026-10-01T00:00:00.000Z" }),
        mockFetchResponse({ topicId: "arch-b", name: "Bravo", status: "active", displayOrder: 4, restoredAt: "2026-10-01T00:00:00.000Z" }),
        burst429({ "Retry-After": "290" }),
      ],
    });
    await renderPage();
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    for (const id of ["arch-a", "arch-b"]) {
      fireEvent.click(screen.getByTestId(`restore-topic-${id}`));
      fireEvent.click(screen.getByTestId(`confirm-restore-${id}`));
      await waitFor(() => expect(screen.getByTestId(`topic-row-${id}`)).toBeInTheDocument());
      await waitFor(() => expect(screen.queryByTestId("restore-topic-dialog")).toBeNull());
    }
    const getsBefore = topicsAllGets(fetchMock).length;

    fireEvent.click(screen.getByTestId("restore-topic-arch-c"));
    fireEvent.click(screen.getByTestId("confirm-restore-arch-c"));

    await waitFor(() => expect(screen.getByTestId("restore-error-arch-c").textContent).toBe(BURST_5_MIN));
    expect(screen.getByTestId("restore-error-arch-c").textContent).toContain("Changes so far are saved.");
    expect(screen.getByTestId("topic-row-arch-a")).toBeInTheDocument();
    expect(screen.getByTestId("topic-row-arch-b")).toBeInTheDocument();
    expect(screen.queryByTestId("archived-topic-row-arch-a")).toBeNull();
    expect(screen.queryByTestId("archived-topic-row-arch-b")).toBeNull();
    expect(topicsAllGets(fetchMock)).toHaveLength(getsBefore);
    expect(writeCalls(fetchMock, "POST", /\/restore$/)).toHaveLength(3);
  });
});
