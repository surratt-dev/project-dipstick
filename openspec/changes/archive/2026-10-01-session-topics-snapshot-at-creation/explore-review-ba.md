# BA review: exploration notes for session-topics-snapshot-at-creation (#175)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-10-01)
**Method:** I checked every claim against `openspec/specs/`, `requirements/`, and `packages/backend/src/`. Where I could not confirm something, I say so.

---

## 0. Verdict

The diagnosis is accurate and well grounded. The notes are ready to become a proposal **once the items in Section 1 are decided**. Most of Section 4 is still phrased as questions. A proposal needs answers. Below I give the answer I recommend for each one, as a requirement with acceptance conditions.

**On the central question, I confirm Option B (snapshot on entry to `lobby`).** My reasoning is about traceability, not only about the ritual:

- FR-2.7 exists so the facilitator can change the order *before* the session is used. The draft window (UC "Create Session for Existing Team", Addendum step 9) exists so the facilitator can review history *before* the room opens. Option A would make the second requirement defeat the first.
- `reorder-topics` spec (line 184) already says normatively that the snapshot "belongs at the point the session reaches `lobby`". That is a shipped requirement. Option A would reverse it.
- One correction to the notes' argument. The notes say the contract's creation moment is `lobby`, so "creation" already means "the room opens". That holds for the contract and for `persistence-layer-mapping.md` ("Session Created ... enters the `lobby` state"). But **UC 02 main flow step 6 says "The application creates a new session record, in a `draft` status."** So the requirements themselves use "creation" for both moments. Rewording one spec is not enough. The proposal must **define a term** and use it in every document (see C1).

### Claims verified against code

| Claim | Result |
|---|---|
| Only `POST /draft` (~L359) and `POST /teams` (~L617) insert into `sessions`, and nothing in `src/` inserts into `session_topics` | Confirmed |
| `/advance` checks status outside the transaction, then runs an unconditional `UPDATE` | Confirmed (L740-L763). The non-draft rejection is **422**, not 409. |
| `/advance` does not enforce the 24h draft expiry | Confirmed. The expiry exists only in `team-content-access-helper.ts` (L50, L217). `/advance` never reads `created_at`. |
| Begin-voting reads `display_order = 1` and joins live `topics` for `first_session_description` | Confirmed (~L1200). The line number in the notes is close but not exact. The handler starts at L1114. |
| R5: `current_topic_id` is written as a `topics.id` but joined as a `session_topics.id` in `session-registration-snapshot.ts:51-52` | Confirmed. This is a real defect and it becomes reachable as soon as this change ships. |
| `POST /teams` copies default topics from the template team in the same transaction, before the session insert | Confirmed (~L605-L624). The snapshot can read those rows inside the same transaction. |
| Redis `session:{id}:snapshot` / topic queue (from `persistence-layer-mapping.md`) | No Redis session-state code exists in `src/`. The proposal should say plainly that Redis is out of scope, so nobody adds it "to match the mapping doc". |

---

## 1. Clarifications needed (each must be decided before or in the proposal)

**C1. Define the snapshot moment as a named term.** Proposed term: **"room open"**, meaning the moment a session's status first becomes `lobby`, whether by `/advance` or by `POST /teams`. Every document that now says "at session creation" for topic purposes changes to "at room open". The full list is in Section 4. Without one shared term, the next change will reopen the ambiguity.

**C2. R5: fix it here, or block on it.** The notes leave this open. I don't think it can stay open. Success criterion 2 for this project is that a facilitator can run a complete session. If reconnect/registration returns `has_locked_in = false` for everyone once a topic is active, the session is not runnable even with the snapshot fixed. My recommendation is to **fix it in this change**: one id-space, with the registration snapshot resolving `current_topic_id` as a `topics.id` through `(session_id, topic_id)`. The other option is to file it as a blocker before this change merges, and the e2e must then explicitly not assert reconnect state. "Probably exposed by the e2e" is not an acceptable state for a proposal. Engineering picks the fix. I need the scope call written down.

**C3. Expired drafts.** Should `/advance` refuse a draft older than 24h? The notes say "check whether it enforces expiry today". It does not. Before adding the refusal, note one consequence. The non-terminal partial unique index (`session-creation` spec) counts an expired `draft` as blocking. If `/advance` refuses it, the facilitator has a draft they can neither open nor replace. Either (a) leave expiry out of scope here and file it, or (b) make the refusal also mark the draft `abandoned` so the facilitator can create a new one. I lean toward (a), because this change is already wide. Whichever we choose, it must be stated.

**C4. `openSessionCreatedAt` under B (R7).** This needs a decision, not "consider". The `reorder-topics` requirement promises the facilitator a hint about which session keeps the old order. Under B that hint must show **the room-open time**, not `sessions.created_at`. Otherwise the hint is wrong for every draft-advanced session. Proposed: add `sessions.room_opened_at` (or `topics_snapshotted_at`), set it in the same statement as the `lobby` transition, and have `openSessionCreatedAt` read it. The spec's field name can stay for compatibility, but its definition changes. This is a `reorder-topics` spec delta, so the notes' "confirm it, no change needed under B" in Section 7 is wrong.

**C5. Backfill (Q7).** The notes want an operator view first. That is fine, but the proposal still needs a default. Proposed default: **no backfill migration.** Release notes tell operators that any session already in `lobby` or `pre_session` with zero `session_topics` rows cannot begin voting and should be abandoned and re-created. Ask the operator one closed question: "Is any environment other than dev/CI holding lobby/pre_session sessions you need to keep?" If no, the default stands.

**C6. Room-open copy (Q1).** This is a decision for the facilitator persona, not for me. But the option on the table needs to be specific. My proposed sentence, appended to the existing `confirming` copy: *"The topic list and order are locked in for this session when the room opens."* The "last look" list stays in the `topic-skip-and-creation-time-confirmation` stub. If the sentence is accepted, it is one acceptance condition (A9). If not, record that it was considered and deferred.

**C7. Zero-active-topics on `POST /teams`.** Q5 covers the `/advance` path. For `POST /teams`, zero topics means the template team has no defaults. Proposed: the whole team-plus-session transaction rolls back with a 500-class "configuration" error that is logged and audited, because this is an operator fault and not something the user can act on. Please confirm this is not a calm 409 like the `/advance` case.

---

## 2. Vague areas and suggested rewrites

| # | Notes say | Problem | Suggested rewrite (requirement language) |
|---|---|---|---|
| V1 | "Snapshot on `lobby` entry ... with every snapshot column" | "Every column" is not testable. `session_topics` has columns that are *not* copied (`status`, `revealed_at`, ...). | "At room open, the application SHALL insert exactly one `session_topics` row per topic with `status = 'active'` for the team, and no others, with `topic_id`, `topic_name ← name`, `topic_prompt ← prompt`, `vote_type`, `topic_annotation ← team_annotation`, `display_order ← row_number() OVER (ORDER BY display_order, id)`, and `status = 'waiting'`, in a single statement." |
| V2 | "A test must cover a team with an archived topic in the middle and one at position 1" (R1) | This is a test idea, not a requirement. | "The rows' `display_order` values SHALL be exactly 1..N in the team's active order, regardless of gaps in `topics.display_order`." Scenarios: active orders {1,3,4} give {1,2,3}; active orders {2,3} (position 1 archived) give {1,2}. |
| V3 | "Should the snapshot take the same lock ... the engineer should decide" (Q3) | The behaviour can be specified even if the mechanism is left to engineering. | "The snapshot SHALL reflect the team's committed active topic list at a single instant. It SHALL never contain a mix of a reorder's before and after states, and it SHALL never contain negative `display_order` values." The mechanism (advisory lock or a single statement) goes in design.md. |
| V4 | "If the snapshot fails, the room must not open" (Q4) | Correct, but it needs an observable form. | "If the snapshot insert fails or inserts zero rows, `sessions.status` SHALL remain `draft`, and no `session.state_changed` audit row and no `session_state_change` event SHALL be produced." |
| V5 | "Refuse to open the room (409, calm copy)" (Q5) | No code or copy is given. | "If the team has zero active topics at room open, `/advance` SHALL return `409` with `error.code: "NO_ACTIVE_TOPICS"` and message *"This team has no active topics. Add or restore a topic before opening the room."* The session stays in `draft`." Reuse the begin-voting tone. The exact copy is for the facilitator persona to approve. |
| V6 | "a clean 409/422, not a 500" (Q6) | Pick one. The existing code returns 422 for non-draft. | "A second concurrent `/advance` for the same session SHALL return the same `422` as advancing a non-draft session today. It SHALL write no audit row and no `session_topics` rows, and it SHALL NOT return 5xx." |
| V7 | "Leaving it live is acceptable. Write that down." (Q8) | The notes say to write it down but don't say where. | Add to `session-topic-lifecycle`: "`first_session_description` is the one topic field not snapshotted. It is read from live `topics` because it is administrator-maintained default copy, and it is stable for a team's first session under the customization lock. No other in-session topic field SHALL be read from `topics`." |
| V8 | "Should the snapshot be recorded ... on the audit row?" (Q10) | Still a question. | Decide yes. "The `session.state_changed` (draft to lobby) and `team.created_with_session` audit metadata SHALL include `topic_count` and `topic_ids` (in snapshot order)." This costs nothing and answers the "why 9 topics?" question during support. |
| V9 | "Not widen responses" (Q9) | Fine, but it should be a stated non-goal. | Non-goals: "`/advance` and `POST /teams` response shapes are unchanged. The contract's `SESSION-001 topics[]` remains unimplemented." |
| V10 | "Rows are copies, so this holds by construction" (Q2) | "By construction" is not a test. | Scenario: "WHEN a session is in `lobby` and the facilitator reorders, archives, adds, restores, or re-annotates a topic, THEN that session's `session_topics` rows are byte-for-byte unchanged, AND the next session for the team reflects the edit." |
| V11 | "Snapshot or live must never become a setting" (R8) | This is a principle. It needs a home. | One sentence in `session-topic-lifecycle`'s Purpose: "The session topic snapshot is not configurable." No scenario is needed. |
| V12 | e2e "create draft → ... → wrap_up" (Section 7) | It does not cover the `POST /teams` path, which is the **first-session** path and the one every new team hits first. | Two e2e flows: (a) existing team: draft → reorder/archive/annotate → advance → start → begin-voting → advance through all → wrap_up; (b) new team: `POST /teams` → start → begin-voting → advance through all defaults in canonical order → wrap_up. |

---

## 3. Gaps the notes don't mention

- **G1. Locked first session.** For a team that has not completed a session, topic writes are rejected by `topic-customization-lock`. So under B, the draft-to-lobby edits the notes describe only apply after the first session. That is correct, but it should be stated so the e2e in V12(a) uses a team that has a completed session. It also means the snapshot of a first session must equal the canonical default order (FR-2.7, last sentence). Add a scenario for this.
- **G2. Archive during the draft window.** If the facilitator archives a topic during the draft and later restores it before opening the room, it must be in the snapshot at its restored position (appended at the end). This follows from V1, but it is the scenario a facilitator will actually hit. Add it.
- **G3. Use case acceptance criteria already blocked on #175.** UC 08 line 420 (Re-Add Removed Topic) is marked "Blocked today on #175". The proposal should list every UC/spec checkbox it unblocks so they can be ticked at archive. Search `requirements/use cases/` for "#175".
- **G4. FR-8.3 history.** The notes rely on `topic_id` for history. Add one scenario: an archived topic's past `session_topics` rows still appear in history/trends after this change, and the new snapshot excludes that topic.

---

## 4. Documents to reconcile (corrects Section 7's list)

| Document | Change |
|---|---|
| `openspec/specs/session-topic-lifecycle/spec.md` | "Mid-session topic-skipping": "at session creation (`SESSION-001`)" becomes "at room open". Promote "A session topic snapshot copies the topic's annotation..." from pending to normative and delete its last sentence. Add V1-V7, V10, V11. |
| `openspec/specs/reorder-topics/spec.md` | **This does change** (contrary to Section 7). `openSessionCreatedAt` is redefined to the room-open time (C4). The draft exclusion stays. |
| `openspec/specs/session-creation/spec.md` | `/advance` requirement: snapshot, zero-topic guard, conditional transition, audit metadata. `POST /teams`: snapshot and C7. |
| `openspec/changes/topic-skip-and-creation-time-confirmation/README.md` | "`SESSION-001` snapshots ... at creation" becomes "at room open". The "last look" signal moves to the "Open the room" confirm, not to draft creation. |
| `requirements/BRD.md` FR-2.7 | "The order in effect when a session is created" becomes "...when a session's room is opened". |
| `requirements/use cases/02 - Session Setup` | Step 9 / Addendum: note that the topic list is locked at room open. |
| `requirements/use cases/08 - Topic Management` | L244 and L298 "at session creation" become "at room open". L420: unblock. |
| `requirements/design/persistence-layer-mapping.md` "Session Created" | Add `display_order` (renumbered) and `topic_annotation` to the snapshot columns. Note that the draft-to-lobby event also performs this insert. |
| Contract `SESSION-001` note | Same wording fix. |

---

## 5. Acceptance conditions I would carry into the proposal

- **A1.** After `/advance` succeeds, the session has N `session_topics` rows, where N is the team's active topic count, with `display_order` 1..N in active order (V1, V2).
- **A2.** After `POST /teams` succeeds, the new session has one row per default topic in canonical order (G1).
- **A3.** Gaps renumber correctly: active {1,3,4} gives {1,2,3}, and active {2,3} gives {1,2} (V2).
- **A4.** Edits after room open do not reach the session. Edits made during the draft do reach it (V10, G2).
- **A5.** A failed or zero-row snapshot leaves the session in `draft`, with no audit row and no event (V4). Zero active topics returns 409 `NO_ACTIVE_TOPICS` (V5).
- **A6.** A concurrent double `/advance` gives one success and one 422, with no 5xx and no duplicate rows (V6).
- **A7.** Every column, `topic_annotation` included, is written by one statement (V1, the pinned annotation requirement).
- **A8.** Audit metadata carries `topic_count` and `topic_ids` (V8).
- **A9 (if C6 accepted).** The "Open the room" confirm shows the lock-in sentence.
- **A10.** Both e2e flows in V12 reach `wrap_up`. If R5 is fixed here (C2), a reconnect mid-topic shows the correct `has_locked_in`.
- **A11.** `openSessionCreatedAt` equals the room-open time for a draft-advanced session (C4).
