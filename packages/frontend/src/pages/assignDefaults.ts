// ---------------------------------------------------------------------------
// assignDefaultTopics -- zero-topic-team-recovery (#200) design.md D2/D7: the
// client for POST /api/v1/teams/:teamId/topics/assign-defaults (shared type:
// AssignDefaultsResponse). The request has no body; the server decides
// everything from the session and the team's state.
//
// The server's machine-readable error codes are folded into the four
// outcomes the Topic Management screen acts on, here at the client boundary,
// so the page never inspects a status or a code itself:
//
//   assigned            201. topicCount is the server's count, or null when
//                       the body is unusable (the screen then reads the
//                       count off the refetched list, never invents one).
//   already_has_topics  409 TEAM_HAS_ACTIVE_TOPICS: the screen refetches and
//                       the list is the message.
//   template_unavailable  500 DEFAULT_TOPICS_UNAVAILABLE ONLY. The "template
//                       is empty" copy must never be shown for an unrelated
//                       fault, so this is the one code on the one status
//                       that earns it.
//   failed              everything else: 403, 404, 429, 503, 500
//                       ASSIGN_DEFAULTS_FAILED, any other 500 code or none,
//                       a non-JSON body, a network error or an abort. An
//                       unknown 500 code is deliberately generic.
//
// Never throws: a failed fetch or an unparseable body is "failed". There is
// no retry here and no timeout of its own; the browser's apply.
// ---------------------------------------------------------------------------

import type { AssignDefaultsResponse } from "@dipstick/shared";

export type AssignDefaultsOutcome =
  | { kind: "assigned"; topicCount: number | null }
  | { kind: "already_has_topics" }
  | { kind: "template_unavailable" }
  | { kind: "failed" };

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function topicCountOf(body: unknown): number | null {
  const count = (body as Partial<AssignDefaultsResponse> | null)?.topicCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

export async function assignDefaultTopics(teamId: string): Promise<AssignDefaultsOutcome> {
  try {
    const res = await fetch(`/api/v1/teams/${teamId}/topics/assign-defaults`, {
      method: "POST",
      credentials: "include",
    });
    const body: unknown = await res.json().catch(() => null);

    if (res.status === 201) return { kind: "assigned", topicCount: topicCountOf(body) };
    if (res.status === 409 && errorCodeOf(body) === "TEAM_HAS_ACTIVE_TOPICS") return { kind: "already_has_topics" };
    if (res.status === 500 && errorCodeOf(body) === "DEFAULT_TOPICS_UNAVAILABLE") return { kind: "template_unavailable" };
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
