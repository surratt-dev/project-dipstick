import { withTimeout } from "./audit-write-timeout.js";
import { recordAndCountSlidingWindow } from "./sliding-window-limiter.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) design.md D9 ("Bounding denial writes",
// security S3): a per-actor bound on the DENIAL-AUDIT WRITE only, separate
// from the topic-write limiter.
//
// Why it exists: assign-defaults writes a topic.defaults_assign_denied row for
// every 403 NOT_AN_ADMIN, before the topic-write limiter is consulted (so a
// 403-bound caller never spends write budget). Without a bound, any
// authenticated non-admin could insert unlimited audit_log rows with an
// attacker-chosen team_id (there is no foreign key), flooding the table and
// burying a real probe. This caps the table's worst case at DENIAL_AUDIT_LIMIT
// rows per actor per window. Beyond it the response is still 403; only the
// row is skipped.
//
// It never changes a response: callers treat "not allowed" and a store error
// alike as "write no row". It uses the shared sliding-window mechanism
// (auth/sliding-window-limiter.ts, TEAM-006's record-then-count script, so
// suppressed denials keep counting, which keeps a continuous prober
// suppressed), under its own key namespace so it cannot collide with the
// topic-write budget. Adoption by TOPIC-002 is a recorded follow-up (#200
// tasks.md 8.4), not done here.
// ---------------------------------------------------------------------------

/** Normative default: 10 denial rows per actor per minute (design D9). */
export const DENIAL_AUDIT_LIMIT = { limit: 10, windowMs: 60_000 } as const;

/** Bound on the limiter's Redis call; same as the topic-write limiter's. */
export const DENIAL_AUDIT_REDIS_TIMEOUT_MS = 500;

/** The actor's one key. {userId} is a hash tag, as for the other limiters. */
export function denialAuditKey(userId: string): string {
  return `dipstick:ratelimit:topic-denial-audit:{${userId}}`;
}

export type DenialAuditAdmission =
  | { allowed: true }
  /** Over the bound. `count` is this actor's count in the window, including this denial. */
  | { allowed: false; reason: "limit"; count: number; firstSuppressed: boolean }
  /** The store errored or timed out: skip the row, log-only. */
  | { allowed: false; reason: "limiter_error" };

/**
 * Counts this denial and says whether its audit row may be written.
 * `firstSuppressed` is true for exactly one denial per window (the one that
 * crosses the bound), so the caller can emit its log-only suppression event
 * once per window instead of recreating the flood in the logs.
 */
export async function admitDenialAudit(userId: string, nowMs: number = Date.now()): Promise<DenialAuditAdmission> {
  try {
    const { count } = await withTimeout(
      recordAndCountSlidingWindow(denialAuditKey(userId), nowMs, DENIAL_AUDIT_LIMIT.windowMs),
      DENIAL_AUDIT_REDIS_TIMEOUT_MS,
    );
    if (count <= DENIAL_AUDIT_LIMIT.limit) return { allowed: true };
    return { allowed: false, reason: "limit", count, firstSuppressed: count === DENIAL_AUDIT_LIMIT.limit + 1 };
  } catch {
    // A Redis error and withTimeout's timeout sentinel fail the same way: no row.
    return { allowed: false, reason: "limiter_error" };
  }
}
