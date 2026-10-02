# Proposal: session-topics-snapshot-at-creation (#175)

**Proposed by:** Devon Calloway (Internal Champion)
**Date:** 2026-10-01
**Inputs:** `exploration-notes.md` (decisions D1–D13), `explore-review-facilitator.md` (Priya Nair), `explore-review-ba.md` (Marcus Delgado), `propose-review-ba.md` (Marcus Delgado), `propose-review-exec.md` (Rachel Okonkwo)

## Why

No shipped route writes `session_topics`, the topic list a session runs on. Every real session therefore stops at begin-voting (`SESSION-005`) with "This session has no topics configured and cannot begin voting." Teams can build, reorder and annotate their topics, open a room, and run the action-item review, and then they hit a wall at the exact moment they should start voting. This is the main path, not an edge case. A team that hits it once will not give the tool a second session.

The ritual only works if the list a team walks into is fixed. That fixed list is what makes session N comparable with session N+1 on the trend dashboard. It is also what "topic flexibility within guardrails" means: teams adapt between sessions, never during one. This change puts that line in one well-defined place, **room open**, and makes it visible to the facilitator who crosses it.

## What Changes

- **Named moment "room open" (D1).** *Room open* is the moment a session's status first becomes `lobby`. That happens through `POST /teams/:teamId/sessions/:sessionId/advance` (draft to lobby) or `POST /teams` (new team, first session created directly in `lobby`), and through nothing else. Rows are written at room open and at no other time; the only exception is the operator backfill below, which runs only on a "Yes" answer and is never an endpoint. Every spec that says "at session creation" about the topic list now says "at room open". The draft window stays a preparation window. Reorders, archives, restores and annotation edits made during the draft reach the session.
- **Snapshot at room open (D2, D5, D7).** One `INSERT ... SELECT`, which takes the session id only and derives the source team from the session row, writes one `session_topics` row per active topic, in the same transaction as the `lobby` transition, under the team's advisory lock. `display_order` is renumbered densely from 1 to N. `topic_annotation` is written in the same statement. `first_session_description` stays the single field read live from `topics`.
- **Conditional transition and idempotent double-click (D6).** `draft → lobby` becomes `UPDATE ... WHERE status = 'draft'`. A second concurrent `/advance` gets today's `422` and writes nothing. The draft host refetches state on a 422 and treats a session that is now in `lobby` as a successful open.
- **Zero-active-topic guard (D4).** `/advance` returns `409 NO_ACTIVE_TOPICS` (`precondition_failed`, the house category for coded 409s) and the session stays in `draft`. No API sequence reaches zero active topics today (`TOPIC_LAST_ACTIVE`, the customization lock), so this is defence in depth against data drift. The draft host disables "Open the room" up front and links to Topic Management. A session not in `draft` always gets `422`, never `409`. If the template team has no defaults, `POST /teams` rolls back the whole transaction and returns `500` / `internal_error` with a fixed "contact an administrator" message and a `correlationId`, logged with the template team id and the same `correlationId`.
- **"Open the room" confirm states the lock-in, with the count (D3).** "Opening the room lets participants join immediately and locks in this session's **N topics** in their current order. Topic changes after this apply to your next session. This cannot be undone." The count is refetched when the facilitator clicks "Open the room", and the confirm appears only once the fresh count is back. The draft facilitator state gains `activeTopicCount`, which is omitted for every other status.
- **`sessions.room_opened_at` (D9).** New nullable column, set by `/advance` and `POST /teams`. `openSessionCreatedAt` (the field name is unchanged) now carries the room-open time. Topic Management copy changes to "Order saved. The session opened on {date} keeps its original order."
- **R5 fix: one id-space for `current_topic_id` (D8).** `sessions.current_topic_id` is a `topics.id`. The WebSocket registration snapshot resolves the current `session_topics` row through `(session_id, topic_id)`, so the readiness grid stays correct after a reconnect. `redis-session-model.md` is corrected to match.
- **Audit metadata (D12).** `session.state_changed` (draft to lobby) and `team.created_with_session` carry `topic_count` and `topic_ids` in snapshot order, and never topic names, prompts, or annotations. The emitted audit log event carries `topicCount` only.
- **Live facilitator role on `/advance` (security review S1).** `/advance` rejects a caller whose `global_role` is no longer `facilitator` with `403` and a `session.advance_denied_role` audit row. This was pre-existing, but opening the room now also fixes the team's voting list.
- **Document reconciliation (does not gate release).** BRD FR-2.7 (both phrases), UC 02, UC 08, `persistence-layer-mapping.md`, `redis-session-model.md`, the REST contract's `SESSION-001` note, and the `topic-skip-and-creation-time-confirmation` stub all adopt "room open". This must be done before archive, and may land as a fast follow after the code ships.
- **Standing full-ritual CI gate.** The existing-team e2e test (draft → open room → begin voting → every topic → `wrap_up`) sits with the existing backend `e2e-*` tests, so it runs in `integration.yml` on every PR with no new CI job, and it is never skipped.

No breaking API changes. `/advance` and `POST /teams` success response shapes are unchanged. The additions are `activeTopicCount` on the draft facilitator state, and the new `409` and live-role `403` on `/advance`.

## Constraints that must be preserved

- **The snapshot is not configurable.** "Snapshot or live" never becomes a setting.
- **No live topic reads in-session**, except `first_session_description`. Annotation stays snapshot-only (`topic-annotation`).
- **Nothing assumes `topics.display_order` is dense.** Gaps from archive, add, or restore are normal (`reorder-topics` design).
- **`POST /teams` locks the list immediately, and that is intended.** A new team's first session uses the canonical defaults with no draft window. That fits the first-session customization lock. Do not "fix" it by adding a draft step.
- **History is untouched.** Archived topics' past `session_topics` rows remain in history and trends (FR-8.3). Topic edits never modify an existing session's rows.
- **Server authority.** `activeTopicCount` is a hint for the UI. The `/advance` guard decides.

## Non-Goals (D10, D13)

- Refusing or auto-abandoning expired (24h+) drafts at `/advance`. The 24h expiry governs history access, not topic freshness. Filed as a follow-up.
- Returning `topics[]` from `/advance` or `POST /teams`. The contract's `SESSION-001 topics[]` stays unimplemented.
- Redis session state. No Redis session code exists, and none is added "to match the mapping doc".
- Showing the topic list or annotation on screen during a session (#56/#57), a "last look" list in the confirm or the lobby (owned by `topic-skip-and-creation-time-confirmation`), "won't apply to today's session" hints on archive, add, restore or annotate (new issue), and new copy for begin-voting's backstop 409.

## Capabilities

### New Capabilities

None. This change gives existing capabilities their missing behavior.

### Modified Capabilities

- `session-topic-lifecycle`: defines room open. The mid-session-skip requirement moves its snapshot moment from "creation (`SESSION-001`)" to room open. The pending annotation-snapshot requirement becomes normative, with #175's decision recorded. Adds the snapshot contents (dense renumbering, single statement, live-read exception), atomicity, single-instant consistency, edit isolation, the begin-voting backstop, and the not-configurable rule.
- `session-creation`: the draft-landing requirement gains the confirm copy with the count, the zero-topic disabled state, and double-click absorption. New requirements cover the `/advance` snapshot, the conditional transition, the `NO_ACTIVE_TOPICS` guard, `room_opened_at`, and audit metadata. `POST /teams` gains the snapshot and rollback on an empty template.
- `reorder-topics`: `openSessionCreatedAt` is redefined as the room-open time. "Created session" wording becomes "session whose room is open". The #175-blocked scenario becomes executable.
- `topic-management-screen`: the reorder copy changes from "created" to "opened" ("Order saved. The session opened on {date} keeps its original order.").
- `vote-compose-recovery`: the registration snapshot resolves `current_topic_id` as a `topics.id` through `(session_id, topic_id)` and returns that row's `session_topics.id` as `sessionTopicId`.
- `restore-topic`: the snapshot-eligibility scenario is no longer blocked. A topic restored during the draft is in the room-open snapshot at its appended position.

## Impact

- **Backend:** `routes/facilitator-sessions.ts` (`/advance`, `POST /teams`, facilitator-state), `routes/topics.ts` (`readOpenSessionCreatedAt`, lock sites moved to the shared `lockTeamTopics`), new `sessions/session-topic-snapshot.ts` and `routes/error-envelope.ts`, `auth/audit-logger.ts` (metadata contracts), `realtime/session-registration-snapshot.ts`. CI: `REQUIRE_DB` in `integration.yml`. One additive migration: `20_sessions_room_opened_at.sql`.
- **Shared types:** `activeTopicCount` on the draft facilitator-state response.
- **Frontend:** `DraftSessionHost.tsx` (confirm copy, disabled state with link, 422 refetch), `TopicManagementPage.tsx` (hint copy).
- **Docs:** BRD FR-2.7, UC 02, UC 08 (and its #175 blockers), `persistence-layer-mapping.md`, `redis-session-model.md`, REST contract, `topic-skip-and-creation-time-confirmation/README.md`.
- **Unblocks:** UC 08 L151, L292, L337, L420, L518, L526, L537, L539, and the `restore-topic` snapshot scenario. Some of these are also gated on #56/#57. Tick only the parts this change delivers.

## Deploy / operator note: backfill (D11)

No backfill migration ships. `draft` sessions need nothing, because they are snapshotted when their room opens. `active`, `wrap_up`, or `complete` sessions cannot hold real votes, because begin-voting has always failed.

**Before release, the operator answers one closed yes/no question:** *"Does any environment other than dev/CI hold `lobby` or `pre_session` sessions with zero `session_topics` rows that a team still needs?"* Record the answer in the release notes.

- **No (expected):** release notes say that such sessions cannot begin voting and should be abandoned and re-created.
- **Yes:** only then is the script written. Run a one-off operator script (not a schema migration) that snapshots those sessions from the team's current active topics, using the same statement as room open, with the controls in design.md Migration Plan step 3 (session-id input only, re-check under the lock, an audit row per session, dry-run by default). Nobody has voted in them, and today's list is almost certainly what the facilitator meant.

This is a deploy gate, not engineering work. It does not block implementation, and on "No" nothing is built.

## Verification before release

A facilitator walkthrough on dev with Priya Nair: draft → reorder and annotate → open the room → begin voting → advance through every topic → wrap_up. This is the first time the full ritual can run end to end. It gates release. During it, Priya reads the confirm copy as a first-time facilitator would and approves the `POST /teams` empty-template message. This is a copy check, not a redesign.

The concurrency scenarios (double `/advance`, reorder racing room open) are verified with two genuinely concurrent transactions against the integration lane's real Postgres, not by inspection only.

**Human follow-ups, not tasks:** scheduling the Priya walkthrough, and putting a real team's first-session pilot on the calendar soon after it passes. Rachel (exec review) owns this. It does not appear in `tasks.md`.

## Proposal feedback disposition

Reviews: `propose-review-ba.md` (Marcus Delgado, approve with changes) and `propose-review-exec.md` (Rachel Okonkwo, approve).

### BA must-fix

| Item | Disposition | Where |
|---|---|---|
| M1 "at no other time" contradicts the backfill | **Accepted.** The exception is now normative and narrow: Yes-answer only, `lobby`/`pre_session` sessions with zero rows that opened before the ship, the same statement, and never an endpoint. | `session-topic-lifecycle` "Room open is the single moment…", design Migration Plan step 3 |
| M2 `409 NO_ACTIVE_TOPICS` UI only in design | **Accepted.** Inline message, refetch, no retry action, then the disabled state. "Any other failure" now excludes 422 and this 409. Race scenario added. | `session-creation` draft-landing requirement |
| M3 "500-class" untestable | **Accepted.** `500`, `server_error` (later corrected to the house `internal_error` category in the design review; see design.md "Design feedback disposition"), a fixed "Contact an administrator" message, and an error log with the template team id. Priya approves the copy in the walkthrough. | `session-creation` `POST /teams`, design Decision 4, tasks 4.2/4.4/10.4 |
| M4 FR-2.7 half-reconciled | **Accepted.** Task 9.1 covers both phrases. UC 08 L337 is listed explicitly in 9.3. | tasks 9.1, 9.3 |

### BA should-fix

| Item | Disposition |
|---|---|
| S1 refetch outcomes | **Accepted.** The confirm appears only after the refetch returns, with a pending state on the button. Four outcomes are defined, each with a scenario. A stale N in front of a facilitator is exactly the kind of quiet lie this lock-in moment must not tell. |
| S2 double-negative scenario | **Accepted.** Split into three scenarios: network/5xx, 422 still `draft`, and 422 with a failed refetch. |
| S3 422 vs 409 ordering | **Accepted.** A non-draft session gets `422` whatever its topic count. Scenario added, and design Decision 3 states it. |
| S4 concurrency verification bar | **Accepted, preferred option.** The integration lane runs against real Postgres on every PR, so two genuinely concurrent transactions are the acceptance bar, normative in both specs. No recorded gap. |
| S5 `activeTopicCount` outside draft | **Accepted.** Omission is normative, and clients must not read absent as zero. Scenario added. |
| S6 locked first session via draft | **Accepted.** Scenario added: canonical defaults, canonical order, 1..N. The note on the lock making the no-topics copy unreachable is included. |

### BA minor

N1 accepted (the fallback date mismatch is documented as transitional in `reorder-topics`). N2 accepted (invariant scenario in `session-topic-lifecycle`). N3 accepted (both audit rows use the same `topic_ids` definition). N4 accepted (backstop copy is added to the follow-up list in 10.6a). N5 accepted (task 9.3 requires confirming L151/L526 before ticking them).

### Exec conditions

| Ask | Disposition |
|---|---|
| Docs must not gate release | **Accepted.** Section 9 gates archive, not release, and may be a fast follow. |
| R5 stays one fix, no Redis work | **Accepted, unchanged.** It is still a single reader query plus one doc correction. The Redis Non-Goal stands. |
| Backfill stays an operator question | **Accepted.** It is now a yes/no gate. On "No" nothing is built, and the script is written only on "Yes" (tasks 10.3a–10.3c). |
| Standing full-ritual e2e CI gate | **Accepted, because it is cheap.** Task 8.1's test goes alongside the existing `e2e-*` backend tests, which `integration.yml` already runs on every PR. It needs no new job, and it may never be skipped. |
| Walkthrough as release gate; pilot on the calendar | **Walkthrough accepted** as a release gate (moved from "before archive"). **Scheduling and the pilot** are human follow-ups that Rachel owns, not tasks. |
| First-timer copy check on the confirm | **Accepted as a copy check within the walkthrough.** **Partly pushed back:** "locks in" and "This cannot be undone" stay. The confirm is the one place the ritual's "adapt between sessions, never during one" rule becomes visible at the moment it applies. Softening it to be less alarming would make the guardrail quiet, and quiet guardrails get worked around. Priya may adjust tone and punctuation. She may not remove the lock-in statement or the irreversibility statement. Calm styling (no warning icon, no error colour) already handles the "scary" concern. |
| Snapshot stays non-configurable | **Agreed.** This is already normative in `session-topic-lifecycle`. |

### Not adopted

Nothing in either review was rejected outright. The one limit is the confirm-copy boundary above.
