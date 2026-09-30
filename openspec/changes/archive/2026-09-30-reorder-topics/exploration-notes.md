# Exploration Notes: Reorder Topics (TOPIC-006, GitHub #52)

**Explored by:** Devon Calloway (Internal Champion / founding advisor)
**Date:** 2026-09-30
**Mode:** `opsx:explore`. These are notes for thinking, not a proposal. Nothing here is decided until a proposal/design says so.
**Revised:** 2026-09-30, after reviews by Priya Nair (`explore-review-facilitator.md`) and Marcus Delgado (`explore-review-ba.md`). See §8 for review disposition.

---

## 1. Where things stand now (the issue is out of date)

Issue #52 says "no persistence route or UI control exists." Half of that is still true. The page it assumed was missing has since been built:

| Piece | State today | Where |
|---|---|---|
| `topics.display_order` column | Exists, `integer NOT NULL DEFAULT 0` | `migrations/2_create_tables.sql:51` |
| Uniqueness | `CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status)`, **not deferrable** | `2_create_tables.sql:58` |
| Default seed ordering | 1-based (1..N), copied as-is into each new team | `11_default_topics_correction.sql`, `facilitator-sessions.ts:~600` |
| Add Custom Topic (TOPIC-003) | Appends at `MAX(active display_order)+1` under a per-team advisory lock | `routes/topics.ts` POST |
| Remove Topic (TOPIC-004) | Soft-archive. **Leaves `display_order` alone**, so active topics end up with gaps | `routes/topics.ts` DELETE |
| Re-Add Topic (TOPIC-005) | Appends at `MAX(active)+1`. The old position is not restored | `routes/topics.ts` POST `/restore` |
| Topic Management screen | Built. Shows active list in `display_order` with Remove, plus an archived list with Restore | `packages/frontend/src/pages/TopicManagementPage.tsx`, spec `topic-management-screen` |
| Reorder endpoint (TOPIC-006) | **Missing.** Drafted in the contract as `PUT /api/v1/teams/:teamId/topics/order` | `REST API Contract.md:863` |
| Reorder UI control | **Missing.** No drag-and-drop library in the frontend deps | — |
| Add Custom Topic UI | Not on the screen either (endpoint only). Side note, not in scope here | — |

So this change is a new write endpoint plus a new control on a screen that already exists. It is not a new screen.

---

## 2. What the ritual needs (Devon's read)

### Does order matter to the ritual?

Yes, but only a little. The Health Check has no mechanic that depends on sequence. Every topic gets the same treatment: simultaneous vote, reveal, discuss. Order still shapes how the conversation feels, though. Teams usually want a warm-up topic first and the heavy "how are we really doing" topics once people have loosened up, or the reverse if the heavy ones tend to get skipped at the end. The use case's own goal says it: *"progress through topics in the most effective order for the team."* That is a fair thing to want. It is a team-level preference, not a protective constraint.

**So reorder is flexibility, not a guardrail.** I don't need it hardened the way the no-manager rule is. What I do need is for it to **not weaken the guardrails around it**:

1. **The first-session lock must cover reorder.** The use case says the lock applies to "adding, removing, reordering, and annotating." The first session runs the canonical set in the canonical order, and that order is part of the baseline. No exceptions and no bypass. This endpoint has to call the same `hasCompletedFirstSession` gate, return the same `409 TOPIC_CUSTOMIZATION_LOCKED`, and write the same `topic.write_denied_locked` audit row (`attempted_operation: "topic.reordered"`). It must not grow a lock-check path of its own.
2. **Order must never reach into a session that already exists.** The use case says "topic order is fixed at session start." The `session-topic-lifecycle` spec (`:139`) is stricter: the list is snapshotted into `session_topics` at session **creation**. Reorder writes only to `topics`, so it cannot touch a live or lobby session's sequence as long as that snapshot exists. This is the right model and it matches what Remove Topic already promises ("An in-progress session is unaffected by a concurrent archive"). **Reorder should not be blocked while a session is live.** Blocking it would add a coupling between topic config and session state that we don't need. It should carry the same explicit "no effect on existing sessions" scenario, written testably (per BA review V1):
   - *Reorder does not affect a created session:* GIVEN an unlocked team with a session in `lobby` or `in_progress`, WHEN the facilitator saves a new order, THEN that session's `session_topics.display_order` values are unchanged AND the save succeeds.
   - *Reorder does not rewrite history:* GIVEN completed sessions, WHEN a new order is saved, THEN no `session_topics` row for any completed session is modified.
   - Until #175 populates `session_topics`, the executable form is "the reorder transaction writes no `session_topics` row"; the rest goes under Known Limitations.
3. **No automatic reordering, ever.** That includes "sort by lowest score" or "put flagged topics first." The use case rules it out. Automatic reordering by score would quietly turn a conversation tool into a metric-optimizing tool, and that is exactly the drift I worry about. If someone proposes it later, it needs a full design review, not a toggle. (Per BA review V10: this goes in design.md as a **non-goal with rationale**, not a spec scenario, since "never happens" isn't meaningfully testable.)
4. **Trend continuity.** Trend and EM views group by `topic_id` and sort within each session by that session's own `session_topics.display_order` (`em-views.ts:195`, `content.ts:787`). Reordering changes neither history nor topic identity. Good. The trend dashboard's row order will follow the current order or topic identity, not "the order it was voted in back then." That seems fine, but it is worth a scenario so nobody later decides to rewrite historical `session_topics.display_order`.

### Is "restore default order" in scope?

FR-8.6 says the canonical default *set* must remain visible and restorable. The contract note at `REST API Contract.md:856` already reads FR-8.6 as being about the set, not about ordering. I agree. I want teams to be able to experiment without losing the baseline, but a lost order is cheap to rebuild by hand, and a lost topic is not. **Recommend: out of scope.** Note it as a possible follow-up. ~~If it's cheap, a read-only hint on the screen showing each default topic's canonical position would be enough.~~ Per BA review V11: the canonical-position hint is **out of scope for this change** too, recorded as a follow-up idea only.

---

## 3. Hidden complexity found in the code

### 3a. The unique constraint blocks a naive renumber

`UNIQUE (team_id, display_order, status)` is a plain, non-deferrable constraint. Postgres checks it **row by row during the UPDATE**. A single `UPDATE ... FROM (VALUES ...)` that swaps positions 2 and 3 can fail partway with `23505`. Workable options:

- **Two-phase write in one transaction:** first move every active row to a scratch range (e.g. `display_order = -display_order`, or `+ 100000`), then write the final 1..N. Simple, and needs no migration.
- **Migrate the constraint to `DEFERRABLE INITIALLY DEFERRED`:** cleaner writes, but this is a schema change on a hot table, and a partial unique index can't be deferrable.

### 3b. Latent bug: archived rows can collide with each other (exists today, and reorder makes it much more common)

Because `status` is part of the unique key, **two archived topics on the same team can't share a `display_order`.** Archive never renumbers. Reproduction that works today, without reorder:

```
active: 1..11          archive #11     -> archived {11}
add custom topic       -> MAX(active)=10 -> new topic gets 11 (active)
archive that custom    -> (team, 11, 'archived') already exists -> 23505 -> 500
```

Reorder renumbers the actives to 1..N, which puts them on the same numbers archived rows already hold. After that, archiving almost any topic could hit this. **The fix has to land with or before reorder.** Candidate fixes:

- Replace the constraint with a **partial unique index `ON topics (team_id, display_order) WHERE status = 'active'`**. Archived rows' positions don't matter: the archived list has no meaningful order, and restore re-appends anyway. This is the fix I'd lean toward, because it states what we actually intend.
- Or have archive move the row to a guaranteed-unique value. That is hackier and hides the intent.

This needs its own spec scenario and a migration with a rollback note, matching migrations 16 and 17.

### 3c. Gaps versus contiguity

Active topics have gaps today (archive leaves holes, and restore uses `MAX+1`). `topics` can live with gaps. But `session_topics` **can't**: begin-voting looks up `display_order = 1` (`facilitator-sessions.ts:1190`) and advance looks up `display_order + 1` (`:1853`). Whoever builds the snapshot (#175) will have to renumber densely no matter what reorder does. Reorder **writes dense 1..N**, and it must use **1-based numbering to match the seed**. Testable form (BA review V2): *after a successful reorder, the team's active topics have `display_order` exactly `1..N` (N = active count) in the submitted order, and `GET /topics` and `GET /topics/all` return them in that order.* Archived rows' `display_order` is **not meaningful and not maintained** (the archived list sorts by `archived_at DESC`); reorder leaves it untouched. The contract's "0-indexed or 1-indexed, consistent" is too vague and should be pinned to 1-based. Note also that Add (`COALESCE(MAX,-1)+1`) and Restore (`COALESCE(MAX,0)+1`) use different empty-set bases. It's harmless today because the last-active guard means an active topic always exists, but the inconsistency is worth noting.

### 3d. "Used in all subsequent sessions" can't be demonstrated end to end yet

Issue **#175 (open)**: nothing populates `session_topics` at session creation. The acceptance criterion "After saving, the new order is used in all subsequent sessions" is therefore unsatisfiable end to end. This is the same inherited gap Restore Topic documented (`restore-topic/spec.md:38`). Reorder should state the same known limitation. It can only prove that `topics.display_order` is persisted and that `GET /topics` and `GET /topics/all` return the new order.

### 3e. Contract drift in the TOPIC-006 draft

The draft (`REST API Contract.md:863-918`) predates three corrections made since:

| Draft says | Current reality / precedent |
|---|---|
| Authorization: facilitator AND not a member | FR-8.2 [HARD] says "facilitator **or Application Administrator** shall be able to ... reorder." TOPIC-004/005 were corrected to admit `application_admin` via `checkStandingFacilitatorOrAdminAuthorization`. TOPIC-006 should do the same from day one, not repeat the bug. |
| Lock active → `403` | Lock is `409 TOPIC_CUSTOMIZATION_LOCKED` (`topic-customization-lock` spec, Decision 2). |
| 404 when any provided `topicId` does not exist | This mixes up 404 and 422. Unknown, archived, or other-team IDs, duplicates, missing IDs, and an empty array are all "the list doesn't equal the active set." **Revised:** a well-formed list that doesn't equal the current active set (missing, extra, archived, other-team, unknown IDs) is `409 TOPIC_ORDER_STALE`, one code for all of them, so the endpoint is not an existence oracle. Only structural failures are `422` (not an array, non-UUID, duplicates, empty, over the length cap). 404 is only for the team. |
| No error envelope | Standard `{ error: { category, code, message, correlationId } }`. |
| — | Fixed check cascade and `applyTimingFloor` on every exit, matching TOPIC-003/4/5. |
| — | Success audit row `topic.reordered` in the same transaction, plus the `emitAuditEvent` counterpart and a new `AuditEventName` union member. |

---

## 4. Rough shape (for the proposal to confirm or reject)

```
PUT /api/v1/teams/:teamId/topics/order   { orderedTopicIds: uuid[] }

 1. identity/role  -> 403 NOT_A_FACILITATOR | FACILITATOR_IS_TEAM_MEMBER   (admin allowed)
 2. team exists    -> 404
 3. lock           -> 409 TOPIC_CUSTOMIZATION_LOCKED  (+ topic.write_denied_locked audit)
 4. body shape     -> 422 (not an array / not uuids / duplicates / empty / over cap, e.g. 200)
 5. BEGIN; pg_advisory_xact_lock(hashtext(teamId))     <- same lock as add/archive/restore
 6. set-equality vs current active IDs (inside lock)   -> 409 TOPIC_ORDER_STALE
 7. no-op? (submitted == current order)                -> 200 current list, NO audit row
 8. two-phase renumber to 1..N
 9. INSERT audit_log topic.reordered {previous_order: uuid[], new_order: uuid[]}  (IDs only)
    COMMIT -> 200 { topics: [{topicId, name, displayOrder}] }
 applyTimingFloor on every exit.
```

Steps 1-4 match the TOPIC-003 cascade exactly (verified: `routes/topics.ts:29-34`, identity -> team -> lock -> body 422), so a locked team gets 409 regardless of body. The length cap is checked in step 4, before the advisory lock and DB read. design.md should write this out as an ordered list.

Why the set-equality check has to run **inside** the advisory lock: the full-list design doubles as optimistic concurrency **for set changes**. If another facilitator (or the same one in another tab) archived, restored, or added a topic since the page loaded, the submitted list no longer matches, and the save should fail cleanly rather than silently drop the new topic to the bottom. A distinct code (or a `409 TOPIC_ORDER_STALE`) lets the UI say "the topic list changed; reload" instead of showing a generic error. **Resolved:** 409 `TOPIC_ORDER_STALE` for stale, 422 for malformed.

**Correction (BA review C3):** I overstated this as "free concurrency." It catches set changes, not order changes. Two facilitators reordering the *same* active set concurrently both pass set-equality, and the second save overwrites the first. **Decision: last-writer-wins for pure reorders, stated explicitly in design.md.** No version token in v1. It's rare, and the audit row's before/after arrays make it recoverable by hand.

**Audit (resolved):** success row `topic.reordered` with `{ previous_order: uuid[], new_order: uuid[] }` plus the standard actor/team/correlation ID. IDs only, no names (names change; the topic record resolves them). A locked denial uses the existing `topic.write_denied_locked` shape with `attempted_operation: "topic.reordered"` and no order payload. A no-op writes nothing. This lets someone answer "who moved our warm-up topic to last" without asking me, which is the point.

---

## 5. UI considerations

```
Active topics
  Order changes apply to sessions created after you save.
  Sessions already created keep their order.
┌──────────────────────────────────────────────────────────────────────┐
│  1. Production Code — Adding Features   [⤒] [↑] [↓] [⤓]   Remove     │
│  2. Production Code — Reasoning         [⤒] [↑] [↓] [⤓]   Remove     │
│  3. ...                                                              │
└──────────────────────────────────────────────────────────────────────┘
┌ sticky ─────────────────────────────────────────────────────────────┐
│ Unsaved order changes                     [ Save order ] [ Discard ] │
└──────────────────────────────────────────────────────────────────────┘
```

**Controls**
- **Per-row Move up / Move down plus Move to top / Move to bottom buttons.** Buttons only for v1: no DnD dependency. Top/bottom were added after Priya's review (O1): with 11 tall rows on a tablet, the common edits ("warm-up first", "pull the heavy one up from the end") are exactly the long jumps, and 10 taps while chasing a moving row is how people get it wrong. Four buttons cost nothing in dependencies. A position-number input is not included. DnD is a follow-up and, if added, must meet the same keyboard/screen-reader bar and be open-source.
- **Visible 1-based position numbers** on active rows are part of the spec, not mockup decoration (O2). They're how facilitators check and talk about the order.
- **Hidden vs. disabled (BA V7):** locked team -> reorder controls **hidden** (matches the existing locked treatment that hides Remove). Fewer than 2 active topics -> **hidden**. Row 1's up/top and row N's down/bottom -> **disabled**, not hidden, so the layout doesn't shift.
- **Accessibility (design note):** after a move, keyboard focus stays on the moved row's corresponding button; each move is announced via an `aria-live` region ("Deployment moved to position 3 of 11").

**Draft and save**
- Reordering is a local draft until "Save order". No confirmation dialog; it's low stakes and reversible.
- **Dirty means "differs from saved,"** not "was touched." Moving down and back up leaves it clean. Save is disabled when clean.
- **Discard** reverts immediately, no confirmation.
- **Successful save** shows a transient, non-modal "Order saved" confirmation.
- The Save/Discard bar stays reachable on a long list and at tablet width (sticky).
- **Remove/Restore are disabled while dirty, with the reason shown** ("Save or discard your order changes first"), and re-enabled after Save or Discard.
- **Navigate-away:** in scope for v1. In-app route changes prompt to confirm discarding (confirm discards, cancel keeps the draft). A browser `beforeunload` prompt for close/refresh is also in scope; it's one listener, and losing a five-minute arrangement to a stray refresh is the same failure.

**Failures**
- **Stale (`409 TOPIC_ORDER_STALE`):** show "The topic list was changed elsewhere since you opened this page." The draft is **not wiped before the facilitator has read the message**; they choose "Reload", which replaces the draft with the current saved order. Nothing partial is persisted. Re-applying the draft's relative order onto the new list is a follow-up, not v1 (see §8).
- **Locked (`409 TOPIC_CUSTOMIZATION_LOCKED`):** only reachable from stale page state or a crafted request. Generic error treatment ("Topics can't be customized until the first session is complete") plus reload. No special dialog.
- **`5xx` / network:** error shown, persisted order unchanged, **draft retained and still marked unsaved** so they can retry. Deliberately the opposite of stale: a transient failure shouldn't cost the user their work.

**Copy (pinned so it can be asserted):** "Order changes apply to sessions created after you save. Sessions already created keep their order." Use "created," not "started."

**Already-created session warning (O3):** a static line is easy to miss when the facilitator's real sequence is "open lobby -> notice order -> reorder -> go back." If the team has a session that is created but not completed, the save confirmation should say so directly ("Saved. The session already created on <date> keeps its original order."). Accepted in principle; whether the frontend can learn this cheaply is open for design (§7).

**Out of the session, always (O9):** reorder is a between-sessions tool. It never appears on the live-session facilitator surface. Mid-session "skip" is the skip feature's job, not reorder's. This goes in design.md as a guardrail.

- **Engineers never see this screen.** Already enforced by the screen's access gate and server-side auth.

---

## 6. What could go wrong if the design drifts

- **Reorder quietly skips the lock** (e.g. someone treats it as "just cosmetic"). Then the first session no longer runs the canonical order, and the lock has a hole. *Guard:* spec scenario plus shared gate plus audit.
- **Reorder leaks into a created or live session**, e.g. someone "fixes" #175 by building the snapshot lazily at start instead of at creation, or reads `topics.display_order` at advance time. Then mid-session order changes are possible, and the spec explicitly forbids that. *Guard:* a scenario asserting that existing sessions are unaffected, and a note linking to #175.
- **An archive after reorder returns a 500** (§3b). A reorder that ships alone would turn a rare latent bug into a common one.
- **Partial-list semantics creep in** ("just send the ones you moved"). That brings back ambiguity about topics the request didn't list and loses the set-change (stale) check. Keep full-list.
- **Auto-ordering by score** gets proposed as a "smart" feature. No.
- **FR-2.7 [PREF] ("re-order the default topic queue before starting the session")** could be read as a per-session reorder that bypasses the first-session lock. Per-session reorder of a *first* session conflicts directly with the lock. For later sessions it is already covered by "reorder the team config, then create the session." **Resolved with the BA:** FR-2.7 is **restated, not retired** (Marcus owns the BRD edit, at the requirements stage, not in this exploration): the facilitator sets order by reordering the team config before a session is created; the first session always uses canonical order; there is no separate per-session reorder path. design.md records "no endpoint accepts a topic order scoped to a session" as a decision. **Residual gap on record, not solved here:** once a session is created (lobby), its order can't be changed. That belongs to the `topic-skip-and-creation-time-confirmation` stub; reorder must not reach into lobby sessions to "help".

---

## 7. Questions: resolved and still open

### Resolved in review

| # | Question | Resolution |
|---|---|---|
| 1 | Archived-row collision fix | **In this change, first task group, own migration with rollback note.** Partial unique index `ON topics (team_id, display_order) WHERE status = 'active'`. Own scenario: GIVEN an archived topic at `display_order = k` and an active topic at `k`, WHEN the active one is archived, THEN it succeeds (no 500). |
| 2 | Stale status code | `409 TOPIC_ORDER_STALE` for set mismatch (all causes collapsed); `422` for malformed body. |
| 3 | Renumber approach | Two-phase renumber in one transaction (constraint is being replaced anyway). Requirement: no partial order is ever persisted. |
| 4 | DnD vs. buttons | Buttons only for v1, **including move-to-top/bottom**. DnD is a follow-up. |
| 5 | Dirty draft vs. Remove/Restore | Disable, with visible reason. |
| 6 | Navigate-away warning | In scope: in-app route prompt plus `beforeunload`. |
| 7 | Audit metadata | Full before/after ID arrays, IDs only. No row for no-op. |
| 8 | Contract update | Yes, in this change: admin branch, 409 lock, envelope, cascade, timing floor, 1-based, 404 team-only, 409 stale / 422 malformed, length cap, response shape. |
| 9 | FR-2.7 | Restate (BA owns the edit at the requirements stage). |
| 10 | #175 dependency | Accept as a Known Limitation, Restore Topic wording pattern. Proven: dense `topics.display_order`, `GET /topics` and `/topics/all` reflect it, no `session_topics` row touched. |
| C3 | Concurrent pure reorders | Last-writer-wins, stated explicitly; audit is the recovery path. |
| C4 | No-op save | `200` with current list, no audit row. |
| C5 | Cascade order | Matches TOPIC-003 (verified in code). Written as an ordered list in design.md. |
| C6 | Length cap | 422 above a fixed cap (e.g. 200), checked before the advisory lock. |
| C7 | Archived `display_order` | Not meaningful, not maintained. |
| C8 | Admin authorization | Reuse `checkStandingFacilitatorOrAdminAuthorization` unchanged. The proposal lists the known inconsistency: Add (TOPIC-003) is still facilitator-only. |

### Still open (for proposal/design)

- **O-1. Created-but-not-completed session signal.** Can the frontend find out cheaply (an existing endpoint or a field on the topics response) whether the team has a created, not-yet-completed session, so the save confirmation can name it? If it needs a new endpoint, design decides whether it's worth it for v1 or whether the pinned static copy is enough until the skip/creation-time stub lands.
- **O-2. Compact list while reordering.** Priya asks whether rows collapse to name plus position during a draft (or behind a "Reorder" toggle) so all 11 fit on a tablet. Plausible, but it's a layout call I'd rather see on a tablet than decide on paper. Design decides; the tablet session below should inform it.
- **O-3. Exact length cap value** (200 is a placeholder).
- **O-4. Tablet usability check.** Priya has offered a 15-minute tablet run of the interaction before merge. I want it scheduled as a pre-merge task, not an afterthought.

### Follow-ups (explicitly not this change)

- "Order last changed by <name> on <date>" on the screen, sourced from the `topic.reordered` audit row.
- Re-applying a stale draft's relative order onto the refreshed list.
- Drag-and-drop.
- Restore default *order* / canonical-position hint.

---

## 8. Review disposition

**Accepted**
- *Facilitator:* move-to-top/bottom (O1, Q1); visible position numbers (O2); dirty = differs-from-saved, Save disabled when clean, transient "Order saved", immediate Discard (O4); disabled Remove/Restore **with a reason**, sticky Save bar (O5); quiet lock-error handling (O7); focus retention and `aria-live` announcements (Q3); `beforeunload` in addition to in-app prompt (Q5); "reorder never on the live-session surface" as a design guardrail (O9); tablet usability check before merge. O10 needed no action.
- *BA:* FR-2.7 restate-not-retire and the no-per-session-path decision (§1); C1-C9 as tabled in §7; testable rewrites V1, V2, V4, V7, V8; V10 (non-goal, not scenario); V11 (canonical-position hint out of scope). I also accept the correction that full-list gives set-change detection only, not free concurrency.

**Adapted**
- *Stale-save behavior (Priya O6 vs. Marcus V3).* They conflict. Marcus: discard and reload. Priya: keep the draft and re-apply relative order. I took the middle: the draft is not wiped until the facilitator has read the message and chosen Reload; then it resets to server order. Re-applying relative order onto a changed set is real merge logic with its own edge cases (where do added topics go?) and isn't worth it for a rare path in v1. Follow-up.
- *Already-created-session warning (O3).* Accepted in intent. Whether it's v1 depends on whether the signal is cheap (open item O-1). The pinned static copy is the floor either way.
- *"Order last changed by" (O8).* Good idea, and it's exactly the "carry knowledge without me" goal. But it's new read surface, not reorder. Follow-up; the audit payload is shaped to support it.
- *BA's navigate-away scope (V6: in-app only, `beforeunload` optional).* Went with Priya: both. Negligible cost.

**Rejected**
- *Compact mode as a v1 commitment (Q2).* Not rejected outright, but I won't spec it from an exploration note; left to design, informed by the tablet check.
- *Position-number input for long moves.* Top/bottom covers the common cases without a free-text field to validate.

Nothing in either review asked to weaken the lock, the snapshot-at-creation rule, or the ban on automatic ordering, so there was nothing to push back on there. The guardrails stand as written in §2.

**Deferred to later stages (not edited here):** BRD FR-2.7 restatement, Reorder Topics use case wording ("start" -> "creation", postcondition, #175 annotation on the AC, navigate-away decision, FR-2.7 dependency link), Validation Report `:27` note. Marcus owns these.
