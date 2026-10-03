import {
  TOPIC_WRITE_BURST_LIMIT_EXCEEDED,
  TOPIC_WRITE_BURST_WAIT_PHRASE,
  TOPIC_WRITE_RATE_LIMIT_MESSAGES,
  TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Rate-limit copy for the Topic Management screen — harden-topic-write-
// endpoints (#184) design.md Decision 12, specs/topic-management-screen.
//
// Copy is chosen by error.code, never by matching text in the server's
// message. For a burst 429 with a parseable Retry-After, the shared burst
// message (the same constant the backend sends) is shown with "a few
// minutes" replaced by "about N minute(s)", N = ceil(seconds / 60), minimum
// 1. Anything else -- a daily 429, a missing or unparseable Retry-After --
// shows the server's message unchanged. Raw seconds are never shown.
//
// Call this ONLY for a 429 (engineer review M5): a 503's message is shown as
// is. The header is read defensively because test doubles (and some
// proxies' responses) have no `headers`.
// ---------------------------------------------------------------------------

interface ResponseLike {
  headers?: { get?: (name: string) => string | null } | null;
}

interface ErrorBodyLike {
  error?: { code?: unknown; message?: unknown };
}

/** Whole seconds from a delta-seconds Retry-After, or null when absent or not a number of seconds. */
function retryAfterSeconds(res: ResponseLike): number | null {
  const raw = res.headers?.get?.("Retry-After");
  if (typeof raw !== "string" || !/^\s*\d+\s*$/.test(raw)) return null;
  return Number(raw.trim());
}

export function waitPhrase(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The message to show for a topic-write 429. `fallback` is used only when
 * the body carries no string message.
 */
export function rateLimitMessage(res: ResponseLike, body: ErrorBodyLike | null | undefined, fallback: string): string {
  const serverMessage = typeof body?.error?.message === "string" ? body.error.message : fallback;
  if (body?.error?.code !== TOPIC_WRITE_BURST_LIMIT_EXCEEDED) return serverMessage;
  const seconds = retryAfterSeconds(res);
  if (seconds === null) return serverMessage;
  return TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst.replace(TOPIC_WRITE_BURST_WAIT_PHRASE, waitPhrase(seconds));
}

/**
 * The message for any non-OK topic-write response: rate-limit copy for a
 * 429, otherwise the server's message (or `fallback`).
 */
export function topicWriteErrorMessage(
  res: ResponseLike & { status: number },
  body: ErrorBodyLike | null | undefined,
  fallback: string,
): string {
  if (res.status === 429) return rateLimitMessage(res, body, fallback);
  return typeof body?.error?.message === "string" ? body.error.message : fallback;
}

/**
 * A 429, or a 503 that the topic-write limiter itself sent (by error.code):
 * a pause, not a failure. A 503 from a proxy or gateway is not treated as one
 * (architect implementation review N4).
 */
export function isTopicWritePause(status: number, body: ErrorBodyLike | null | undefined): boolean {
  return status === 429 || (status === 503 && body?.error?.code === TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE);
}
