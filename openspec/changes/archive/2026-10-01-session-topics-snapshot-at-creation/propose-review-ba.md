# BA review: proposal for session-topics-snapshot-at-creation (#175)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `proposal.md` and the six delta specs under `specs/`, with `design.md` and `tasks.md` for cross-reference
**Checked against:** `openspec/specs/` (session-topic-lifecycle, session-creation, reorder-topics, topic-management-screen, vote-compose-recovery, restore-topic), `requirements/BRD.md`, `requirements/use cases/02` and `08`, `requirements/design/REST API Contract.md`, and `packages/backend/src/routes/facilitator-sessions.ts` / `topics.ts`

---

## 0. Verdict

**Approve with changes.** This proposal answers every clarification from my exploration review (C1–C7, V1–V12, G1–G4). Nearly every capability now has explicit WHEN/THEN acceptance criteria with concrete values: counts, `display_order` sets, exact copy, error codes, and audit fields. The term "room open" is defined once and used throughout. That was the most important fix.

I checked the deltas against the live specs. Each MODIFIED requirement keeps every scenario from its original (some reworded, none dropped), and each requirement header matches the live spec exactly, so the archive merge will be clean. I also confirmed the code facts the proposal relies on: `/advance` returns 422 for a non-draft session before its transaction (L740), it runs an unconditional `UPDATE` (L765), `POST /teams` inserts directly in `lobby` (L619), the audit action names are correct, the Topic Management route is `/team/:teamId/topics`, and `first_session_description` is read live only by begin-voting (L1200).

The open items are small: one internal contradiction, one frontend behavior that exists only in design.md, two places where the spec language is vague, and one requirements document whose reconciliation is incomplete. Section 1 must be fixed before the spec is approved. Section 2 should be fixed. Section 3 is optional.

---

## 1. Must fix before approval

### M1. "At no other time" contradicts the operator backfill

`session-topic-lifecycle`, "Room open is the single moment...": *"The application SHALL write a session's `session_topics` rows at room open and at no other time."* But the proposal's D11 "Yes" branch, and design.md Migration Plan step 3, run a one-off script that writes rows for sessions that are **already** in `lobby`/`pre_session`, which is after their room opened. As written, the script breaks a normative SHALL. A future reviewer could also cite this sentence to block the script.

**Suggested rewrite:** "...at room open and at no other time. The single exception is the one-off pre-release operator backfill (design.md, Migration Plan), which may write rows only for a session that is in `lobby` or `pre_session`, has zero `session_topics` rows, and opened before this change shipped, using the same snapshot statement. No application endpoint performs that backfill."

### M2. The `409 NO_ACTIVE_TOPICS` UI behavior is in design and tasks, not in the spec

Design Decision 7 and task 7.3 say: on a 409 `NO_ACTIVE_TOPICS`, show the server message inline, refetch so the disabled state takes over, and show no retry button. The `session-creation` draft-landing requirement covers only 422 and "any other failure", and "any other failure" shows **a retry action**. So the spec as written requires a retry button for this case, and the design says there should be none. The spec is what gets tested.

This is the race a facilitator can actually hit: the confirm shows N ≥ 1, someone archives the last topic in another tab, and then the facilitator confirms.

**Add to the requirement:** "If the advance returns `409` with `error.code: "NO_ACTIVE_TOPICS"`, the view SHALL show the response message inline, SHALL refetch facilitator state, and SHALL show no retry action. The zero-topic disabled state then applies."
**Scenario:** WHEN the confirm was opened with `activeTopicCount: 1` and the advance returns `409 NO_ACTIVE_TOPICS`, THEN the session remains `draft`, the message is shown, there is no retry action, and after the refetch "Open the room" is disabled with the Topic Management link.

Also change "On any other failure" to "On any other failure (not 422, not `409 NO_ACTIVE_TOPICS`)".

### M3. The `POST /teams` empty-template error is "500-class": not testable

"A 500-class configuration error" leaves the status code, the body, and the log content open. A test cannot assert "500-class". Design Decision 4 already gives most of the answer, so put it in the spec.

**Suggested:** "the response SHALL be `500` with `error.category: "server_error"` and a fixed message (proposed: "Team creation is unavailable because the default topic set is not configured. Contact an administrator."), and an error-level log line SHALL include the template team id." Update the scenario "An empty default-topic template rolls back the whole request" to assert the exact status and category. Priya should approve the copy. No facilitator can fix this, so the copy should send them to someone who can.

### M4. FR-2.7 reconciliation misses half the sentence

FR-2.7 (BRD L229) says *"...set the order in which a session's topics are presented **before that session is created**... The order in effect **when a session is created** is the order that session uses."* Task 9.1 rewrites only the second phrase. If the first is left as is, the BRD still says reordering must happen before the draft exists, which is the Option A reading this change rejects.

**Fix:** task 9.1 (and the proposal's "Document reconciliation" bullet) must cover both phrases: "...before that session's room is opened... The order in effect when a session's room is opened is the order that session uses." UC 08 L337 ("In sessions created after the save, ...") has the same problem. Task 9.3's general instruction covers it, but list it explicitly so it is not missed.

---

## 2. Should fix: vague or implicit criteria

### S1. Confirm-open refetch: the outcomes are not specified

The spec says the host "SHALL refetch facilitator state when the confirmation opens, so N is current". It says nothing about what happens when the refetch returns something other than a draft with N ≥ 1. Three outcomes need a defined behavior:

| Refetch result | Suggested behavior |
|---|---|
| `activeTopicCount: 0` | Do not show the confirm. Show the zero-topic disabled state. |
| Status is no longer `draft` (opened from another tab) | Update to the live participant-readiness view with no error, the same as the 422 path. |
| Refetch fails (network/5xx) | Do not show the confirm with a stale N. Show the existing inline retryable error. |

Also say whether the confirm shows a loading state while the refetch is in flight, or appears only after it returns. Pick one. I recommend appearing only after it returns, so N is never stale.

### S2. The "Opening the room fails" scenario is a double negative

The scenario's WHEN clause, *"fails with an error other than a `422` whose refetch shows the session out of `draft`"*, takes two readings to parse, and nobody can write a test from it with confidence. Split it into concrete scenarios:

- WHEN the advance fails with a network error or 5xx, THEN the session stays in `draft`, there is an inline error, and there is a retry action.
- WHEN the advance returns `422` and the refetch shows `draft`, THEN there is an inline error and a retry action.
- WHEN the advance returns `422` and the refetch itself fails, THEN there is an inline error and a retry action. (This case is not covered today.)

### S3. The order of the 422 and 409 checks is not stated

What does `/advance` return for a session that is not in `draft` **and** belongs to a team with zero active topics? Design step 3 (the conditional update before the snapshot) and the existing pre-transaction check both give 422. The spec does not say so. Add one sentence: "A session not in `draft` SHALL receive `422` whatever the team's topic count." The double-click requirement depends on this ordering.

### S4. How the concurrency scenarios are verified

Three scenarios depend on real concurrency: double `/advance`, a reorder racing room open, and "exactly one success". The live `session-topic-lifecycle` Purpose says plainly that earlier concurrency scenarios were verified "by tests asserting the code issues the correct conditional `UPDATE`... not by a test exercising two genuinely concurrent transactions", because no live-database concurrency lane existed. Tasks 3.4 and 3.5 now say "a concurrent double `/advance`" without saying which kind of test. State which method is the acceptance bar: two real concurrent transactions against Postgres (preferred, since the integration suite now runs against a real database), or verification of the mechanism by inspection plus a recorded gap. Do not leave this to be found at review time.

### S5. `activeTopicCount` outside `draft`

The spec says the field is included "when the session is in `draft`". Design says the field is optional and absent otherwise. Make the absence normative ("SHALL be omitted for any other status") and add a scenario for it. Otherwise a frontend that defaults `undefined` to 0 could show the disabled state in the wrong place.

### S6. Draft for a team still under the customization lock

FR-2.7's last sentence says a first session always uses the canonical default order. `POST /teams` is covered. But a team whose first session was abandoned can create a **draft** first session while still locked. That path goes through `/advance`, not `POST /teams`, and no scenario covers it. Add one: WHEN a team with no completed session advances a draft, THEN its `session_topics` are the canonical defaults in canonical order, numbered 1..N. Under the lock, the "Add or restore a topic on Topic Management" copy cannot be reached, because archiving is blocked. That is fine, but it should be noted.

---

## 3. Minor / optional

- **N1. Fallback date wording.** For a session that opened before this change, `openSessionCreatedAt` falls back to `created_at`, and the copy then says "The session **opened** on {created date}". This is accurate for `POST /teams` sessions and may be off by a day or more for draft-advanced ones. It is acceptable as a transitional edge case. Say so in the reorder-topics requirement, so the mismatch is not later reported as a bug.
- **N2. Invariant scenario.** Design's Risk 1 mitigation ("every `lobby` session created through either route has at least one row") is a useful invariant. Make it a scenario in `session-topic-lifecycle` so it is tested, not only mentioned.
- **N3. Same definition for both audit rows.** `topic_ids` is defined as "`topic_id` values in snapshot `display_order`" on the `/advance` row. Repeat that definition on the `team.created_with_session` row, so both audit rows are defined the same way.
- **N4. Begin-voting backstop copy.** Priya (O4) asked for actionable copy on the backstop 409. The proposal lists this as a non-goal. I accept that, because the case is reachable only by pre-change sessions. Please make sure the follow-up list in task 10.2 includes it, so it is not lost.
- **N5. UC unblock list.** L151 and L526 in UC 08 are listed as unblocked, but neither line mentions #175 directly (the other six do). Confirm that they really depend on this change before ticking them at archive.

---

## 4. Acceptance-condition coverage (from my exploration review)

| Condition | Where it lands | Status |
|---|---|---|
| A1 N rows, 1..N, active order | lifecycle "exactly the team's active topics"; session-creation "successful open" | Covered |
| A2 `POST /teams` canonical order | session-creation, lifecycle "new team's first session" | Covered |
| A3 gap renumbering {1,3,4}, {2,3} | lifecycle | Covered |
| A4 edits after open isolated; draft edits reach the session | lifecycle, reorder-topics, restore-topic | Covered |
| A5 failed or zero snapshot leaves the draft; 409 code | session-creation | Covered (UI side: M2) |
| A6 double advance 422, no 5xx | session-creation | Covered (verification: S4) |
| A7 single statement including annotation | lifecycle | Covered |
| A8 audit `topic_count`/`topic_ids` | session-creation, both rows | Covered (N3) |
| A9 confirm lock-in copy | session-creation, with count and singular | Covered (S1) |
| A10 two e2e flows, reconnect | tasks 8.1/8.2, vote-compose-recovery | Covered |
| A11 `openSessionCreatedAt` = room-open time | reorder-topics | Covered |
| G1 locked first session via draft | (none) | **Gap: S6** |
