// ---------------------------------------------------------------------------
// Topic-write rate limit — the copy and error codes shared by the backend
// limiter (routes/topic-write-rate-limit.ts) and the Topic Management screen.
//
// harden-topic-write-endpoints (#184) design.md Decision 12 / engineer review
// S5: the messages live ONCE, here. The backend sends them; the frontend
// selects copy by error.code (never by matching message text) and, for a
// burst 429 with a parseable Retry-After, replaces "a few minutes" with
// "about N minute(s)". The messages never name a team or contain a number.
// ---------------------------------------------------------------------------

export const TOPIC_WRITE_BURST_LIMIT_EXCEEDED = "TOPIC_WRITE_BURST_LIMIT_EXCEEDED";
export const TOPIC_WRITE_DAILY_LIMIT_EXCEEDED = "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED";
export const TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE = "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE";

export type TopicWriteRateLimitCode =
  | typeof TOPIC_WRITE_BURST_LIMIT_EXCEEDED
  | typeof TOPIC_WRITE_DAILY_LIMIT_EXCEEDED;

/** The phrase the frontend replaces with "about N minute(s)" on a burst 429. */
export const TOPIC_WRITE_BURST_WAIT_PHRASE = "a few minutes";

export const TOPIC_WRITE_RATE_LIMIT_MESSAGES = {
  burst:
    "You've made a lot of topic changes in a short time. Changes so far are saved. " +
    `Please wait ${TOPIC_WRITE_BURST_WAIT_PHRASE} and try again.`,
  daily: "You've reached today's limit for topic changes. Changes so far are saved. You can continue tomorrow.",
} as const;

/** The fail-closed 503's message (the limiter's Redis errored or was slow). */
export const TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Topic changes are temporarily unavailable. This change wasn't saved; changes you made earlier are kept. " +
  "Please try again shortly.";
