// ---------------------------------------------------------------------------
// auth-events-audit-log-coverage: design.md Decision D2.
//
// Extracted, unchanged, from session-invalidation-audit.ts so that the
// fail-open write path (fail-open-audit-write.ts) and the original
// auth.session_invalidated write path both share one timeout mechanism
// instead of a second hand-copied implementation. session-invalidation-audit.ts
// now imports these from here rather than defining them locally -- this is a
// pure extraction, no behavior change.
// ---------------------------------------------------------------------------

/** Not read from environment or any admin-facing setting -- see the precedent's Decision D5. */
export const AUDIT_WRITE_TIMEOUT_MS = 500;

/**
 * Dedicated sentinel type (not a message-string comparison) so callers can
 * distinguish "the timer won" from "the DB call itself rejected" with a
 * plain `instanceof` check.
 */
export class AuditWriteTimeoutError extends Error {}

/**
 * Races `promise` against a timer of `ms` milliseconds. Throws
 * `AuditWriteTimeoutError` if the timer wins. Always clears its own timer,
 * and always attaches a no-op `.catch` to `promise` so that a query which
 * eventually rejects *after* the race is already decided doesn't surface as
 * an unhandled-rejection warning.
 *
 * This stops the *caller* from waiting -- it does not cancel `promise`
 * itself. See the precedent's design.md Decision D5's "What withTimeout does
 * not do."
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuditWriteTimeoutError()), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
    promise.catch(() => {
      // Intentionally ignored: if `promise` loses the race and rejects
      // later, this prevents an unhandled-rejection warning. The rejection
      // itself was already handled (or not) by whichever branch won the race.
    });
  }
}
