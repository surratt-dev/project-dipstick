import type { SessionStatus, SessionTopicStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// voteDraft — client-local persistence/restore of a composed-but-unsubmitted
// vote draft (GitHub issue #31 / vote-compose-recovery).
//
// See openspec/changes/vote-compose-recovery/{design.md,specs/vote-compose-recovery/spec.md}
// for the full requirements this module implements: design.md Decisions
// D1-D7, spec.md's four Requirements.
//
// Governing principle (design.md Context, carried forward without
// softening): a stale restore — the wrong topic's answer silently
// reappearing as if it belonged to the current one — is categorically worse
// than the mechanism not existing at all. Every branch in restoreDraft below
// defaults to discard; restoration requires the full, explicit positive
// case (topic matches, status is "voting", no existing lock-in) with
// nothing left as "anything else restores."
//
// This module does NOT wire itself to a compose UI or to
// useConnectionHealth's registration flow — that wiring is tasks.md task
// 8.1, tracked as a follow-up against the compose UI's own change, since
// that UI does not exist yet. This file is the standalone, unit-testable
// contract task 8.1 will eventually call.
// ---------------------------------------------------------------------------

/**
 * D5: persisted record's vote-value type. Illustrative, not binding
 * (design.md Open Questions) — typed `number` here to match the existing
 * lock-in submission payload's `voteValue: number` (packages/backend/src/routes/sessions.ts).
 * A future compose UI implementer is free to change this module's local
 * VoteValue type if its actual representation differs; doing so does not
 * change any of this module's restore/discard logic, only the type this
 * value flows through.
 */
export type VoteValue = number;

/** D5: the persisted record shape. */
export interface VoteDraft {
  sessionId: string;
  sessionTopicId: string;
  value: VoteValue;
  /** ISO 8601. Not read by any restore/discard check today (no age-based
   * cutoff — design.md Non-Goals) but retained on the record per D5's
   * shape, for whoever eventually adds error-reporting/RUM tooling context
   * (design.md Risks). */
  composedAt: string;
}

/**
 * D1.2: the single sessionStorage key this module owns. No other module in
 * this codebase may read or write this key — confirmed at the time this
 * module was written by `grep -r sessionStorage packages/frontend/src`
 * returning only this file and its test.
 */
const VOTE_DRAFT_STORAGE_KEY = "dipstick:vote-draft";

/**
 * task 4.1: a locally-defined structural type matching the wire shape
 * design.md D3a describes for the backend's `SessionRegistrationSnapshotPayload`
 * (packages/shared/src/types/realtime.ts, built in tasks.md Group 7).
 * Deliberately NOT imported from `@dipstick/shared` here — Group 7 is not a
 * dependency of this module (Group 4), and building Groups 1-6 before
 * Group 7 is a supported order per tasks.md. TypeScript's structural typing
 * means any drift between this local shape and Group 7's canonical payload
 * type surfaces as a compile error once the two are wired together
 * (task 8.1), without this module needing to import anything from Group 7.
 *
 * `SessionStatus`/`SessionTopicStatus` themselves are pre-existing shared
 * enum types (packages/shared/src/types/session.ts), independent of this
 * change's own Group 7 additions — importing them here does not create the
 * dependency task 4.1 warns against.
 */
export interface RegistrationSnapshotForRestore {
  sessionId: string;
  sessionStatus: SessionStatus;
  currentTopic: { sessionTopicId: string; status: SessionTopicStatus } | null;
  /** This connection's own lock-in status only — see design.md D3d. */
  hasLockedInVote: boolean;
}

// ---------------------------------------------------------------------------
// 2. Persist-on-change (design.md D1, spec.md Requirement 1)
// ---------------------------------------------------------------------------

/**
 * Writes the full draft record to this module's sessionStorage key on every
 * call — D1: no debounce, no navigation/unload hook, fired on every
 * compose-value change. Overwrites any previously-persisted record (one
 * entry is sufficient per D5 — a participant has at most one active
 * session/current-topic per tab at a time). Never makes a network call,
 * never touches any storage key besides VOTE_DRAFT_STORAGE_KEY.
 */
export function persistDraft(sessionId: string, sessionTopicId: string, value: VoteValue): void {
  const record: VoteDraft = {
    sessionId,
    sessionTopicId,
    value,
    composedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(VOTE_DRAFT_STORAGE_KEY, JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// 3. Restore-once-per-load gate (design.md D2, spec.md Requirement 2)
// ---------------------------------------------------------------------------

/**
 * D2: module-scope flag, initialized once and reset only by an actual page
 * load — a fresh page load re-evaluates this module from scratch under
 * normal ESM/bundler semantics, which is what re-arms this gate. Consulted
 * at the very top of restoreDraft, before any sessionStorage read, so a
 * second registration within the same page load (an ordinary in-tab
 * reconnect) never re-attempts a restore and never reads storage.
 */
let restoreAttempted = false;

// ---------------------------------------------------------------------------
// 4. Restore decision logic (design.md D3/D4, spec.md Requirements 3 and 4)
// ---------------------------------------------------------------------------

/**
 * Consumes a fresh registration payload and returns the persisted draft's
 * value if — and only if — every positive condition holds; returns `null`
 * (discard) in every other case, always silently (spec.md Requirement 5 —
 * no toast, banner, sound, or console message from this module).
 *
 * Ordering (task 4.4): `payload` is a required parameter with no default —
 * there is no code path in this module that can produce a value, or that a
 * caller could apply to UI state, before a registration payload exists.
 * There is no optimistic/default value path.
 *
 * Once-per-load (D2): a call after the first (within the same page load) is
 * a no-op that returns `null` immediately, without touching storage.
 *
 * Clear-after-one-attempt (D2): the stored entry is read and removed in the
 * same step, before any discard/restore branch runs, so it is cleared
 * exactly once regardless of the eventual outcome. This is the ONLY point
 * in this module that clears storage.
 *
 * Discard conditions (D4, evaluated in this order — order does not change
 * the result since each is independently sufficient to discard, but lock-in
 * precedence (D3) is deliberately checked LAST so it always wins even if
 * every other check would have passed):
 *   (iv) sessionId no longer matches
 *   (iii) no current topic at all (covers wrap_up-with-no-topic, and
 *         lobby/pre_session, both represented as `currentTopic: null` per
 *         design.md D3a)
 *   (i)   current topic's sessionTopicId differs from the draft's
 *   (ii)  current topic matches but its status is not "voting"
 *   D3    the payload reports an existing lock-in for the current topic
 */
export function restoreDraft(payload: RegistrationSnapshotForRestore): VoteValue | null {
  // Defensive guard, not the real enforcement mechanism: `payload` is a
  // required parameter at the type level, so no call site in this codebase
  // can compile without supplying one (task 4.4's actual ordering
  // guarantee). This only protects against a hypothetical runtime bypass
  // (e.g. via `any`) degrading to a silent discard rather than a thrown
  // error — consistent with this module's discard-by-default posture. It
  // deliberately does NOT consume the once-per-load gate below, since a
  // malformed call like this is not a legitimate restore attempt.
  if (payload == null) {
    return null;
  }

  if (restoreAttempted) {
    return null;
  }
  restoreAttempted = true;

  const raw = window.sessionStorage.getItem(VOTE_DRAFT_STORAGE_KEY);
  window.sessionStorage.removeItem(VOTE_DRAFT_STORAGE_KEY);

  if (raw === null) {
    return null;
  }

  let draft: VoteDraft;
  try {
    draft = JSON.parse(raw) as VoteDraft;
  } catch {
    // Malformed record (should not occur since this module is the only
    // writer of this key) — discard rather than risk applying garbage.
    return null;
  }

  // D4 (iv): sessionId mismatch — defensive/race condition, see design.md D4.
  if (draft.sessionId !== payload.sessionId) {
    return null;
  }

  // D4 (iii): no current topic at all — wrap_up with current_topic_id
  // cleared, or lobby/pre_session before voting has started.
  if (payload.currentTopic === null) {
    return null;
  }

  // D4 (i): topic advanced.
  if (draft.sessionTopicId !== payload.currentTopic.sessionTopicId) {
    return null;
  }

  // D4 (ii): topic matches but is no longer accepting votes (revealed/complete).
  if (payload.currentTopic.status !== "voting") {
    return null;
  }

  // D3: lock-in precedence — server-reported lock-in always wins, checked
  // last so it overrides regardless of what the checks above computed.
  if (payload.hasLockedInVote) {
    return null;
  }

  return draft.value;
}
