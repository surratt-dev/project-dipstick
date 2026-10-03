import type { FastifyReply, FastifyRequest } from "fastify";
import {
  TOPIC_WRITE_BURST_LIMIT_EXCEEDED,
  TOPIC_WRITE_DAILY_LIMIT_EXCEEDED,
  TOPIC_WRITE_RATE_LIMIT_MESSAGES,
  TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE,
  TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE_MESSAGE,
} from "@dipstick/shared";
import { emitAuditEvent } from "../auth/audit-logger.js";
// withTimeout is the generic bounded-wait helper. Despite its name,
// AuditWriteTimeoutError here just means "the timer won": on this path it is
// the limiter's Redis call that timed out (architect implementation review N2).
import { AuditWriteTimeoutError, withTimeout } from "../auth/audit-write-timeout.js";
import { writeFailOpenAuditRow } from "../auth/fail-open-audit-write.js";
import {
  admitConditionalDualWindow,
  retryAfterSeconds,
  type DualWindowKeys,
  type DualWindowResult,
} from "../auth/sliding-window-limiter.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import { buildErrorEnvelope } from "./error-envelope.js";
import type { TopicWriteDenialContext } from "./topic-write-context.js";

// ---------------------------------------------------------------------------
// Topic-write rate limiter — harden-topic-write-endpoints (#184 F5)
//
// One per-actor budget shared by the five topic-write routes (TOPIC-003 add,
// 004 archive incl. its pre-flight, 005 restore, 006 reorder, 007
// annotation). Not a Fastify route plugin and NOT a plugin-wide preHandler
// (design.md Decision 2): each handler calls enforceTopicWriteRateLimit()
// explicitly, immediately after identity/role authorization and before
// checkWritableTeam. That placement is what keeps
//   - a 403-bound caller from consuming budget or ever seeing a 429, and
//   - the 429 identical for an existing, a missing and the template team
//     (the check makes no DB query and depends only on the actor's history).
//
// Counting (Decision 4): every request that reaches this check and is
// admitted is counted -- including ones that later fail 404/409/422 and the
// archive pre-flight. 429s are never counted. A 503 from a Redis error is not
// counted; a 503 from the 500 ms timeout MAY be counted later if Redis runs
// the queued command (best effort; fails safe by over-counting).
//
// Fail closed (Decision 6): a Redis error or a call slower than 500 ms gives
// 503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE. This module must NEVER be imported
// by session, voting or WebSocket runtime code (Decision 8; enforced by
// topic-write-rate-limit-structural.test.ts): its only non-test importer is
// routes/topics.ts.
// ---------------------------------------------------------------------------

/**
 * The topic-write thresholds -- normative, defined only here (spec "The five
 * topic-write endpoints share one per-actor rate-limit budget").
 *
 * RITUAL FLOOR: burst must stay >= 100 per 10 minutes and daily >= 200 per 24
 * hours. Traced to use case 08 and Feature Sets.md §8: a facilitator
 * restoring the default baseline on two teams in one sitting sends 90
 * requests (burst floor = 90 + ~10%), and the tailoring-plus-pre-session
 * fixture is 78. Do not tighten below the floor without revisiting those.
 * Do not loosen on the belief that "restore can recover it": annotation and
 * definition overwrites (TOPIC-007) cannot be undone without a DB restore
 * (design.md Decision 5).
 */
export const TOPIC_WRITE_LIMITS = {
  burst: { limit: 120, windowMs: 10 * 60 * 1000 },
  daily: { limit: 400, windowMs: 24 * 60 * 60 * 1000 },
} as const;

/** Bound on the limiter's Redis call; redis.ts sets no commandTimeout. */
export const TOPIC_WRITE_RATE_LIMIT_REDIS_TIMEOUT_MS = 500;

/** Retry-After on the fail-closed 503. */
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/**
 * The actor's four keys. Same house prefix as TEAM-006 (one SCAN finds every
 * limiter key) but a distinct namespace, so the two budgets cannot collide.
 * The {userId} hash tag keeps all four in one slot, so the multi-key EVAL
 * stays legal if Redis is ever clustered.
 */
export function topicWriteRateLimitKeys(userId: string): DualWindowKeys {
  const base = `dipstick:ratelimit:topic-write:{${userId}}`;
  return {
    burst: `${base}:burst`,
    daily: `${base}:daily`,
    burstMarker: `${base}:breach-audited:burst`,
    dailyMarker: `${base}:breach-audited:daily`,
  };
}

type Window = "burst" | "daily";

export interface TopicWriteBreach {
  limit: Window;
  code: typeof TOPIC_WRITE_BURST_LIMIT_EXCEEDED | typeof TOPIC_WRITE_DAILY_LIMIT_EXCEEDED;
  message: string;
  retryAfterSeconds: number;
  observedCount: number;
  suppressedCount: number;
  /** Windows whose breach episode began with this request. */
  newEpisodeWindows: Window[];
}

/**
 * Decision 7a: of the windows at their limit, report the one with the LONGER
 * wait (daily on a tie); Retry-After is that wait. Lua returns mechanism
 * only; this is the policy.
 */
export function classifyTopicWriteBreach(result: DualWindowResult, nowMs: number): TopicWriteBreach {
  const { burst, daily } = TOPIC_WRITE_LIMITS;
  const burstWait =
    result.burstCount >= burst.limit
      ? retryAfterSeconds({ count: result.burstCount, oldestEntryMs: result.burstOldestMs }, nowMs, burst.windowMs)
      : 0;
  const dailyWait =
    result.dailyCount >= daily.limit
      ? retryAfterSeconds({ count: result.dailyCount, oldestEntryMs: result.dailyOldestMs }, nowMs, daily.windowMs)
      : 0;

  const newEpisodeWindows: Window[] = [];
  if (result.burstEpisodeNew) newEpisodeWindows.push("burst");
  if (result.dailyEpisodeNew) newEpisodeWindows.push("daily");

  if (dailyWait > 0 && dailyWait >= burstWait) {
    return {
      limit: "daily",
      code: TOPIC_WRITE_DAILY_LIMIT_EXCEEDED,
      message: TOPIC_WRITE_RATE_LIMIT_MESSAGES.daily,
      retryAfterSeconds: dailyWait,
      observedCount: result.dailyCount,
      suppressedCount: result.dailySuppressed,
      newEpisodeWindows,
    };
  }
  return {
    limit: "burst",
    code: TOPIC_WRITE_BURST_LIMIT_EXCEEDED,
    message: TOPIC_WRITE_RATE_LIMIT_MESSAGES.burst,
    retryAfterSeconds: Math.max(1, burstWait),
    observedCount: result.burstCount,
    suppressedCount: result.burstSuppressed,
    newEpisodeWindows,
  };
}

export type TopicWriteBudgetDecision =
  | { admitted: true; result: DualWindowResult }
  | { admitted: false; result: DualWindowResult; breach: TopicWriteBreach };

/**
 * The limiter decision itself, with no HTTP, timeout or timing floor: one
 * atomic EVAL against the actor's windows (recording the request if
 * admitted) plus the Decision 7a classification of a breach. Rejects if
 * Redis errors. enforceTopicWriteRateLimit() is the only production caller;
 * counting tests call this directly with an injected nowMs (Decision 13).
 */
export async function checkTopicWriteBudget(
  userId: string,
  nowMs: number = Date.now(),
): Promise<TopicWriteBudgetDecision> {
  const result = await admitConditionalDualWindow(
    topicWriteRateLimitKeys(userId),
    {
      burstLimit: TOPIC_WRITE_LIMITS.burst.limit,
      burstWindowMs: TOPIC_WRITE_LIMITS.burst.windowMs,
      dailyLimit: TOPIC_WRITE_LIMITS.daily.limit,
      dailyWindowMs: TOPIC_WRITE_LIMITS.daily.windowMs,
    },
    nowMs,
  );
  return result.admitted
    ? { admitted: true, result }
    : { admitted: false, result, breach: classifyTopicWriteBreach(result, nowMs) };
}

/**
 * Admits the request against the actor's topic-write budget, or sends the
 * 429/503 itself (timing floor, no-store, and -- on the first 429 of a breach
 * episode -- one durable audit row written before the response).
 *
 * Returns "allowed" when the caller should continue its cascade, and
 * "rejected" when a response has already been sent. `nowMs` is injectable
 * for tests; production uses the app server's clock.
 */
export async function enforceTopicWriteRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TopicWriteDenialContext,
  startTime: number,
  nowMs: number = Date.now(),
): Promise<"allowed" | "rejected"> {
  const eventBase = {
    actorUserId: ctx.actorUserId,
    actorGlobalRole: ctx.actorGlobalRole,
    actorIp: request.ip,
    teamId: ctx.teamId,
    endpoint: ctx.endpoint,
  };

  let decision: TopicWriteBudgetDecision;
  try {
    decision = await withTimeout(checkTopicWriteBudget(ctx.actorUserId, nowMs), TOPIC_WRITE_RATE_LIMIT_REDIS_TIMEOUT_MS);
  } catch (err) {
    // Fail closed (Decision 6). No DB write of any kind on this path. The raw
    // Redis error is not logged: only whether it timed out.
    const envelope = buildErrorEnvelope(
      "service_unavailable",
      TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE,
    );
    emitAuditEvent(request.log, "topic.write_rate_limit_check_failed", {
      ...eventBase,
      failureMode: err instanceof AuditWriteTimeoutError ? "timeout" : "error",
      correlationId: envelope.error.correlationId,
    });
    await applyTimingFloor(startTime);
    await reply
      .code(503)
      .header("Retry-After", String(UNAVAILABLE_RETRY_AFTER_SECONDS))
      .header("Cache-Control", "no-store")
      .send(envelope);
    return "rejected";
  }

  if (decision.admitted) {
    return "allowed";
  }

  const { breach } = decision;
  const envelope = buildErrorEnvelope("rate_limited", breach.message, breach.code);

  // Decision 7 / security C1: one durable row per breach episode, written
  // before the response through the fail-open path (bounded by
  // AUDIT_WRITE_TIMEOUT_MS; auth.audit_write_failed on failure; never a 5xx).
  // team_id is the lowercase path value and was never checked against teams.
  if (breach.newEpisodeWindows.length > 0) {
    await writeFailOpenAuditRow({
      operation: "topic.write_rate_limited",
      userId: ctx.actorUserId,
      actorGlobalRole: ctx.actorGlobalRole,
      actorIp: request.ip,
      teamId: ctx.teamId,
      metadata: {
        limit: breach.limit,
        windows: breach.newEpisodeWindows,
        observedCount: breach.observedCount,
        endpoint: ctx.endpoint,
        team_verified: false,
      },
      log: request.log,
      failureAuditFields: {
        userId: ctx.actorUserId,
        reason: "topic.write_rate_limited",
        correlationId: envelope.error.correlationId,
      },
    });
  }

  emitAuditEvent(request.log, "topic.write_rate_limit_exceeded", {
    ...eventBase,
    limit: breach.limit,
    observedCount: breach.observedCount,
    retryAfterSeconds: breach.retryAfterSeconds,
    episodeStarted: breach.newEpisodeWindows.length > 0,
    suppressedCount: breach.suppressedCount,
    correlationId: envelope.error.correlationId,
  });

  await applyTimingFloor(startTime);
  await reply
    .code(429)
    .header("Retry-After", String(breach.retryAfterSeconds))
    .header("Cache-Control", "no-store")
    .send(envelope);
  return "rejected";
}
