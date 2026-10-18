import { describe, it, expect, vi, afterEach } from "vitest";
import { restoreDefaultTopics } from "../restoreDefaults.js";
import { envelope, mockFetchResponse, unparseableResponse } from "./topicManagementTestUtils.js";

// bulk-restore-default-topics (#218) task 5.0: the client for
// POST /api/v1/teams/:teamId/topics/restore-defaults.

const TEAM = "11111111-1111-4111-8111-111111111111";

function respond(res: Response | Error) {
  const fetchMock = res instanceof Error ? vi.fn().mockRejectedValue(res) : vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("restoreDefaultTopics", () => {
  it("sends a body-less, header-less credentialed POST", async () => {
    const fetchMock = respond(mockFetchResponse({ restored: [], skipped: [] }));
    await restoreDefaultTopics(TEAM);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/teams/${TEAM}/topics/restore-defaults`, {
      method: "POST",
      credentials: "include",
    });
  });

  it("200 maps to restored, carrying the body (including a reason the client does not know)", async () => {
    const body = {
      restored: [{ topicId: "a", name: "A", displayOrder: 3 }],
      skipped: [{ topicId: "b", name: "B", reason: "SOMETHING_NEW" }],
    };
    respond(mockFetchResponse(body));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "restored", body });
  });

  it("200 with an empty restored list is still restored", async () => {
    respond(mockFetchResponse({ restored: [], skipped: [] }));
    await expect(restoreDefaultTopics(TEAM)).resolves.toMatchObject({ kind: "restored" });
  });

  it.each([[{}], [null], [{ restored: "x", skipped: [] }]])("200 with an unusable body (%j) is failed", async (body) => {
    respond(mockFetchResponse(body));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("403 maps to forbidden with the server's message", async () => {
    respond(envelope(403, "FACILITATOR_IS_TEAM_MEMBER", "A facilitator cannot restore."));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "forbidden", message: "A facilitator cannot restore." });
  });

  it("404 maps to not_found", async () => {
    respond(envelope(404, "TEAM_NOT_FOUND", "Team not found."));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "not_found" });
  });

  it("409 TOPIC_CUSTOMIZATION_LOCKED maps to locked; another 409 is failed", async () => {
    respond(envelope(409, "TOPIC_CUSTOMIZATION_LOCKED", "locked"));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "locked" });
    respond(envelope(409, "OTHER", "x"));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("429 maps to paused with the rate-limit message", async () => {
    respond(envelope(429, "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED", "Daily limit reached."));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "paused", message: "Daily limit reached." });
  });

  it("the limiter's 503 maps to paused; a gateway 503 is failed", async () => {
    respond(envelope(503, "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE", "Try again shortly."));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "paused", message: "Try again shortly." });
    respond(unparseableResponse(503));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });

  it("500, a non-JSON body and a network error are failed and never throw", async () => {
    respond(envelope(500, "INTERNAL_ERROR", "boom"));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
    respond(unparseableResponse(500));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
    respond(new TypeError("network"));
    await expect(restoreDefaultTopics(TEAM)).resolves.toEqual({ kind: "failed" });
  });
});
