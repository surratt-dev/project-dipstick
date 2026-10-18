// ---------------------------------------------------------------------------
// restoreDefaultTopics -- bulk-restore-default-topics (#218) task 5.0: the
// client for POST /api/v1/teams/:teamId/topics/restore-defaults (shared type:
// RestoreDefaultsResponse). Follows assignDefaults.ts: no body and no
// Content-Type header (the server never reads a body), never throws.
//
// Statuses are folded into the outcomes the Topic Management screen acts on:
//
//   restored      200. `body` is the server's own account of what happened
//                 (restored and skipped), never a prediction. An empty
//                 `restored` is a successful "nothing to restore".
//   forbidden     403 (NOT_A_FACILITATOR, FACILITATOR_IS_TEAM_MEMBER).
//   not_found     404.
//   locked        409 TOPIC_CUSTOMIZATION_LOCKED.
//   paused        429 or the limiter's own 503: `message` is the rate-limit
//                 copy (topicWriteErrorMessage).
//   failed        everything else: 500, other 409/503, a non-JSON body, a
//                 network error, or a 200 whose body is unusable.
// ---------------------------------------------------------------------------

import type { RestoreDefaultsResponse } from "@dipstick/shared";
import { isTopicWritePause, topicWriteErrorMessage } from "./topicWriteRateLimit.js";

export type RestoreDefaultsOutcome =
  | { kind: "restored"; body: RestoreDefaultsResponse }
  | { kind: "forbidden"; message: string | null }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "paused"; message: string }
  | { kind: "failed" };

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function isRestoreBody(body: unknown): body is RestoreDefaultsResponse {
  if (typeof body !== "object" || body === null) return false;
  const { restored, skipped } = body as Partial<RestoreDefaultsResponse>;
  return (
    Array.isArray(restored) &&
    Array.isArray(skipped) &&
    restored.every((r) => typeof r?.topicId === "string" && typeof r.name === "string") &&
    skipped.every((s) => typeof s?.topicId === "string" && typeof s.name === "string")
  );
}

export async function restoreDefaultTopics(teamId: string): Promise<RestoreDefaultsOutcome> {
  try {
    const res = await fetch(`/api/v1/teams/${teamId}/topics/restore-defaults`, {
      method: "POST",
      credentials: "include",
    });
    const body: unknown = await res.json().catch(() => null);
    const errorBody = (typeof body === "object" ? body : null) as ErrorBody | null;
    const code = errorBody?.error?.code;

    if (res.status === 200) return isRestoreBody(body) ? { kind: "restored", body } : { kind: "failed" };
    if (res.status === 403) {
      const message = errorBody?.error?.message;
      return { kind: "forbidden", message: typeof message === "string" ? message : null };
    }
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 409 && code === "TOPIC_CUSTOMIZATION_LOCKED") return { kind: "locked" };
    if (isTopicWritePause(res.status, errorBody)) {
      return { kind: "paused", message: topicWriteErrorMessage(res, errorBody, "Too many topic changes. Try again later.") };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
