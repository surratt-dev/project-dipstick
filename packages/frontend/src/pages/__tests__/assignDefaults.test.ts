import { describe, it, expect, vi, afterEach } from "vitest";
import { assignDefaultTopics } from "../assignDefaults.js";
import { mockFetchResponse } from "./topicManagementTestUtils.js";

// zero-topic-team-recovery (#200) tasks.md 6.1: the client for
// POST /api/v1/teams/:teamId/topics/assign-defaults and its mapping of the
// server's machine-readable codes to the four outcomes the screen acts on.

const TEAM = "11111111-1111-4111-8111-111111111111";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("assignDefaultTopics (#200 6.1)", () => {
  it("sends a body-less credentialed POST to the team's assign-defaults URL", async () => {
    const fetchMock = respond(201, { topicCount: 5 });

    await assignDefaultTopics(TEAM);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/teams/${TEAM}/topics/assign-defaults`, {
      method: "POST",
      credentials: "include",
    });
  });

  it.each([1, 5, 12])("201 with topicCount %i is 'assigned' with that count", async (topicCount) => {
    respond(201, { topicCount });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "assigned", topicCount });
  });

  it.each([[{}], [null], [{ topicCount: "5" }], [{ topicCount: -1 }], [{ topicCount: 1.5 }]])(
    "201 with an unusable body (%j) is still 'assigned', with no count (the screen reads the refetched list)",
    async (body) => {
      respond(201, body);
      await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "assigned", topicCount: null });
    },
  );

  it("409 TEAM_HAS_ACTIVE_TOPICS is 'already_has_topics'", async () => {
    respond(409, { error: { code: "TEAM_HAS_ACTIVE_TOPICS", message: "x" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "already_has_topics" });
  });

  it("500 DEFAULT_TOPICS_UNAVAILABLE is 'template_unavailable'", async () => {
    respond(500, { error: { code: "DEFAULT_TOPICS_UNAVAILABLE", message: "x" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "template_unavailable" });
  });

  it("500 ASSIGN_DEFAULTS_FAILED is a generic failure, never the template message", async () => {
    respond(500, { error: { code: "ASSIGN_DEFAULTS_FAILED", message: "x" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  // The architectural safeguard (design.md D2): the template-is-empty copy is
  // shown only for its own code, so an unknown or missing 500 code is generic.
  it.each([
    ["an unknown code", { error: { code: "SOMETHING_NEW", message: "x" } }],
    ["no code", { error: { message: "x" } }],
    ["a non-envelope body", { detail: "boom" }],
    ["an empty body", null],
    ["a code that only looks similar", { error: { code: "default_topics_unavailable" } }],
  ])("500 with %s is a generic failure", async (_label, body) => {
    respond(500, body);
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("a DEFAULT_TOPICS_UNAVAILABLE code on any other status is not trusted", async () => {
    respond(502, { error: { code: "DEFAULT_TOPICS_UNAVAILABLE" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("409 with another code (for example the lock) is a generic failure", async () => {
    respond(409, { error: { code: "TOPIC_CUSTOMIZATION_LOCKED" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it.each([403, 404, 429, 503, 502, 504, 400, 401])("%i is a generic failure", async (status) => {
    respond(status, { error: { code: "WHATEVER", message: "x" } });
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("a response whose body is not JSON is a generic failure, not a throw", async () => {
    const res = { ok: false, status: 500, json: () => Promise.reject(new SyntaxError("Unexpected token <")) } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("a network failure is a generic failure, not a throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("an aborted request (a timeout) is a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")));
    await expect(assignDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });
});
