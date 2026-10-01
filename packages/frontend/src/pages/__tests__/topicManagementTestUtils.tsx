import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { TopicManagementRoute } from "../TopicManagementPage.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Shared fixtures for the topic-add-form-and-empty-state page suites
// (TopicManagementPage.add / .empty / .screen). Not a test file itself.
// ---------------------------------------------------------------------------

export type Active = GetAllTopicsResponse["active"][number];
export type Archived = GetAllTopicsResponse["archived"][number];

export function activeTopic(id: string, name: string, overrides: Partial<Active> = {}): Active {
  return {
    topicId: id,
    name,
    prompt: `Prompt for ${name}`,
    voteType: "finger",
    displayOrder: 0,
    isDefault: true,
    firstSessionDescription: null,
    teamAnnotation: null,
    annotationUpdatedAt: null,
    annotationUpdatedBy: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function archivedTopic(id: string, name: string, overrides: Partial<Archived> = {}): Archived {
  return {
    topicId: id,
    name,
    prompt: `Prompt for ${name}`,
    voteType: "finger",
    isDefault: true,
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

export function makeTopics(overrides: Partial<GetAllTopicsResponse> = {}): GetAllTopicsResponse {
  return {
    teamId: "team-1",
    teamName: "Platform Squad",
    isCustomizationLocked: false,
    canEditAnnotations: true,
    canAddTopics: true,
    active: [
      activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1, prompt: "How effective is pairing?" }),
      activeTopic("topic-2", "Pipeline", { displayOrder: 2, prompt: "Confidence in the pipeline" }),
    ],
    archived: [archivedTopic("topic-old", "Codebase Health", { prompt: "Is the codebase easy to work with?" })],
    defaultTopicsNotActive: [],
    ...overrides,
  };
}

export function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** A response whose body cannot be parsed as JSON (e.g. a proxy's HTML 502). */
export function unparseableResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    text: () => Promise.resolve("<html><body>Bad gateway</body></html>"),
  } as unknown as Response;
}

export function envelope(status: number, code: string, message: string, field?: string): Response {
  return mockFetchResponse({ error: { category: "x", code, message, correlationId: "c-1", ...(field ? { field } : {}) } }, status);
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Reply = Response | Error | Promise<Response>;

export interface FetchRoutes {
  // GET …/topics/all; the last entry repeats.
  gets?: Reply[];
  // POST …/topics (TOPIC-003)
  adds?: Reply[];
  // DELETE …/topics/:id (TOPIC-004)
  removes?: Reply[];
  // POST …/topics/:id/restore (TOPIC-005)
  restores?: Reply[];
}

function answer(reply: Reply | undefined): Promise<Response> {
  if (reply === undefined) return Promise.resolve(mockFetchResponse({}, 500));
  if (reply instanceof Error) return Promise.reject(reply);
  return Promise.resolve(reply);
}

/** Route-aware fetch mock. */
export function installFetch(routes: FetchRoutes = {}) {
  const gets = routes.gets ?? [mockFetchResponse(makeTopics())];
  const queues = { adds: [...(routes.adds ?? [])], removes: [...(routes.removes ?? [])], restores: [...(routes.restores ?? [])] };
  let getIndex = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.endsWith("/topics/all")) {
      return answer(gets[Math.min(getIndex++, gets.length - 1)]);
    }
    if (method === "POST" && url.endsWith("/restore")) return answer(queues.restores.shift());
    if (method === "POST" && /\/teams\/[^/]+\/topics$/.test(url)) return answer(queues.adds.shift());
    if (method === "DELETE") return answer(queues.removes.shift());
    return answer(undefined);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

export type FetchMock = ReturnType<typeof installFetch>;

export function addPosts(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && /\/teams\/[^/]+\/topics$/.test(String(url)));
}

export function topicsAllGets(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? "GET") === "GET" && String(url).endsWith("/topics/all"));
}

export function postedBody(fetchMock: FetchMock, index = 0): Record<string, unknown> {
  const call = addPosts(fetchMock)[index];
  if (!call) throw new Error(`no add POST at index ${index}`);
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

// A tiny in-test navigator so a suite can change the route's teamId.
function TeamSwitcher() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="switch-team" onClick={() => navigate("/team/team-2/topics")}>
      switch team
    </button>
  );
}

/** Renders the page through the same keyed route wrapper App.tsx uses. */
export async function renderPage(teamId = "team-1") {
  const result = render(
    <MemoryRouter initialEntries={[`/team/${teamId}/topics`]}>
      <TeamSwitcher />
      <Routes>
        <Route path="/team/:teamId/topics" element={<TopicManagementRoute />} />
        <Route path="/team/:teamId" element={<div>Team Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByTestId("topic-management-view"));
  return result;
}

export function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}
