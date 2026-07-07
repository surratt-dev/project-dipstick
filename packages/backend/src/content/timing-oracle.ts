// ---------------------------------------------------------------------------
// Timing Oracle — constant minimum response time floor
//
// Design Decision 7 (enforce-access-control-on-team-content):
//   Because the authorization check returns before the resource lookup for
//   unauthorized callers, denied responses may be detectably faster than
//   authorized responses. An attacker who can observe response time distributions
//   can statistically distinguish "exists, unauthorized" from "does not exist" —
//   even when both return 403 with identical bodies.
//
//   This is a BLOCKING design requirement. All content endpoint responses —
//   both authorized and denied — must apply a constant minimum response time
//   floor equal to or greater than the p95/p99 of authorized-request latency
//   under realistic database load.
//
// Measurement requirement (Task 6.1):
//   The floor value below MUST be updated after measuring p95/p99 latency of
//   authorized requests to the highest-latency content endpoint under realistic
//   database load. The value here is a development-time placeholder.
//
//   Required before production deployment:
//   1. Measure p95/p99 authorized-request latency under realistic DB load.
//   2. Update TIMING_FLOOR_MS to the measured p95 or p99 value.
//   3. Document the measurements in the operations runbook.
//   4. The test in __tests__/timing-oracle.test.ts verifies the floor holds.
//
// Operations runbook entry (Task 6.3):
//   Floor measurement date: [PENDING — must be completed before production]
//   Measured p95 latency: [PENDING]
//   Measured p99 latency: [PENDING]
//   Selected floor value: [PENDING — must be >= p95 or p99]
//   Implementation: constant minimum applied to all responses (not dynamic mean)
//   Floor source file: packages/backend/src/content/timing-oracle.ts
//
// Shortening the floor (operational note):
//   If the floor is set too high (e.g., a query plan change reduces authorized
//   latency), update TIMING_FLOOR_MS and re-measure. The floor should track
//   the CURRENT p95/p99, not a historical baseline.
// ---------------------------------------------------------------------------

/**
 * Minimum response time floor in milliseconds.
 *
 * PLACEHOLDER: 150ms is a development-time default. This MUST be replaced with
 * the measured p95/p99 authorized-request latency before any content endpoint
 * is deployed to production.
 *
 * The floor applies to ALL content endpoint responses:
 *   - Authorized (member, EM, facilitator grant) — floor pads short responses
 *   - Denied (null grant, admin grant on content) — floor prevents timing oracle
 */
const TIMING_FLOOR_MS = 150;

/**
 * Apply the constant minimum response time floor.
 *
 * Call this before sending any response from a content endpoint:
 *
 *   const startTime = Date.now();
 *   // ... authorization check and data retrieval ...
 *   await applyTimingFloor(startTime);
 *   return reply.send(responseBody);
 *
 * The floor guarantees that every response takes at least TIMING_FLOOR_MS from
 * the time the handler started processing the request. If the handler completes
 * faster than the floor, the remaining time is slept. If it takes longer, no
 * additional delay is added.
 *
 * Task 6.4: The test in __tests__/timing-oracle.test.ts verifies that denied
 * responses are not detectably faster than authorized responses at the floor.
 */
export async function applyTimingFloor(startTimeMs: number): Promise<void> {
  const elapsed = Date.now() - startTimeMs;
  const remaining = TIMING_FLOOR_MS - elapsed;
  if (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}

/** Exposed for tests that need to know the current floor value. */
export const CONTENT_TIMING_FLOOR_MS = TIMING_FLOOR_MS;
