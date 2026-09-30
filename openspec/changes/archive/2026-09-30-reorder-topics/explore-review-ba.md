# BA Review: Reorder Topics Exploration Notes (TOPIC-006, #52)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Date:** 2026-09-30
**Reviewed:** `openspec/changes/reorder-topics/exploration-notes.md`
**Sources checked:** `requirements/use cases/08 - Topic Management - Use Cases.md` (Reorder Topics, Enforce Lock), `requirements/BRD.md` (FR-2.7, FR-8.2, FR-8.6), `requirements/design/REST API Contract.md` (TOPIC-004/005/006), `REST API Contract - Validation Report.md:27`, `packages/backend/src/routes/content.ts` (topic list queries)

---

## Overall verdict

Devon's notes are strong and mostly proposal-ready. The code findings (§3a–3e) are concrete and verified. The gaps are on the requirements side: a few behaviours are described as intent ("should fail cleanly", "tidy", "cheap") rather than as testable conditions, a couple of edge cases are unaddressed, and the use case itself carries wording that is now wrong against the snapshot-at-creation rule. None of it blocks a proposal. All of it should be settled in the proposal and not left to implementation.

---

## 1. FR-2.7 vs. the first-session lock: analysis and recommended resolution

### The conflict

- **FR-2.7 [PREF]:** "The application should allow the facilitator to re-order the default topic queue before starting the session."
- **FR-8.2 [HARD]:** add/remove/reorder is available only *after* the team's first session.
- **Enforce Topic Customization Lock use case:** the lock covers reordering. No bypass or override is defined (explicitly out of scope).

Read literally, FR-2.7 says "the default topic queue" and "the session", with no qualification. The default queue is exactly what a *first* session runs. So the literal reading is a per-session reorder that applies to first sessions, and that contradicts a [HARD] requirement. When a [PREF] and a [HARD] conflict, the [HARD] one wins. That was never in question. The real risk is that someone builds a second, session-scoped ordering path to satisfy FR-2.7. That path would hit the lock hole and the #175 snapshot problem at the same time.

### Why FR-2.7 exists

FR-2.7 sits in the session-flow section (FR-2.x) and predates the topic-management section (FR-8.x). It was written from the facilitator's point of view in the room: "before we start, let me put the warm-up topic first." The need behind it is **a facilitator can control the order a session runs in before it runs**. TOPIC-006 plus snapshot-at-creation meets that need for every session except the first. For the first session, the lock deliberately withholds it: the baseline runs in canonical order.

The Validation Report (`:27`) already maps FR-2.7 to TOPIC-006 and marks it "Covered", so the team has implicitly accepted this reading. It just was never written down against the lock.

### Recommendation: restate FR-2.7. Do not retire it, and do not build it as a separate path.

Retiring it would lose the traceability of a real facilitator need. Restate it as follows:

> **FR-2.7** [PREF] The application should allow the facilitator to set the order in which a session's topics are presented before that session is created, by reordering the team's topic configuration (TOPIC-006). The order in effect when a session is created is the order that session uses. This does not apply to a team's first session, which always uses the canonical default order (FR-8.2 customization lock). The application does not provide a separate per-session reorder path.

I will make this BRD edit, plus a note in the Reorder Topics use case under Dependencies ("Satisfies FR-2.7 as restated"). The proposal should cite the restated FR-2.7 and include a negative scenario: *no endpoint accepts a topic order scoped to a session*. That is a design constraint, not a test, so it belongs in design.md as a decision.

**Residual gap I want on record, not solved here:** once a session is created (lobby), the facilitator cannot change its order. "Created, not started" is a real window where a facilitator may notice they wanted a different order. This belongs to the `topic-skip-and-creation-time-confirmation` stub, not to this change. Reorder must not try to reach into lobby sessions to "help" with it.

---

## 2. Clarifications needed (decisions the proposal must make)

| # | Question | My recommendation |
|---|---|---|
| C1 | Archived-row collision fix: in this change or a prerequisite? | **In this change, as the first task group, in its own migration.** See §4, Q1. |
| C2 | Stale list: 409 or 422? | **409 `TOPIC_ORDER_STALE` for set mismatch against current active topics. 422 for malformed body.** See §4, Q2. |
| C3 | Pure-reorder race: two facilitators both reorder the *same* active set concurrently. Set-equality passes for both, so the second save silently overwrites the first. The notes present full-list as "free concurrency", but it only catches set changes, not order changes. | **Accept last-writer-wins for pure reorders**, and state it explicitly as a decision. The audit row (with before/after) is the recovery path. Do not add a version token in v1. Two facilitators reordering one team at the same minute is rare, and the damage is recoverable by hand. |
| C4 | No-op save (submitted order equals current order). | Return `200` with the current list. **Write no audit row** (nothing changed). The UI disables "Save order" when the draft equals the saved order, so this only arrives via the API. |
| C5 | Is the check cascade order fixed? The notes' sketch puts body-shape validation (step 4) **after** the lock (step 3). | Confirm it matches the TOPIC-003/4/5 precedent exactly, so a locked team returns 409 regardless of body. Write it down as an ordered list in design.md. |
| C6 | Upper bound on `orderedTopicIds` length. | Reject arrays over a fixed cap (e.g. 200) with 422 before taking the advisory lock. The set-equality check catches oversize lists anyway, but only after lock acquisition and a DB read. |
| C7 | Where do archived rows' `display_order` values go after the partial-index fix? | Leave them untouched. The archived list is sorted by `archived_at DESC` (`content.ts` archived query), so archived positions carry no meaning. State in the spec that **archived `display_order` is not meaningful and is not maintained.** |
| C8 | Does reorder need an `application_admin` who is also a team member? | Follow `checkStandingFacilitatorOrAdminAuthorization` exactly. No new branch. Also note that TOPIC-003 (Add) is still facilitator-only (deferred follow-up), so after this change the topic screen will have admin-capable Remove/Restore/Reorder and facilitator-only Add. That inconsistency is known, so it does not need solving here, but the proposal should list it. |
| C9 | Tablet: are move up/down buttons enough, or is touch drag required? | Buttons alone satisfy the use case note ("an alternative ... may be needed"). **Buttons only for v1**, DnD as a follow-up. See §4, Q4. |

---

## 3. Vague areas and suggested rewrites

### V1. "Order must never reach into a session that already exists" (§2.2)
The intent is clear, but it has no acceptance condition. Rewrite as scenarios:

> **Scenario: Reorder does not affect a created session**
> GIVEN a team with an unlocked topic configuration and a session in `lobby` or `in_progress` state
> WHEN the facilitator saves a new topic order
> THEN the existing session's `session_topics.display_order` values are unchanged
> AND the save succeeds (reorder is not blocked by an existing session)

> **Scenario: Reorder does not rewrite history**
> GIVEN a team with completed sessions
> WHEN the facilitator saves a new topic order
> THEN no `session_topics` row for any completed session is modified

The first scenario can only be exercised once #175 populates `session_topics`. Until then, assert "no `session_topics` row is written by the reorder transaction" (a query-level assertion), and list the rest under Known Limitations.

### V2. "Reorder should write dense 1..N so the team's config is tidy" (§3c)
"Tidy" isn't testable. Rewrite:

> After a successful reorder, the team's active topics have `display_order` values exactly `1..N` (N = active count), assigned in the submitted order. `GET /topics` and `GET /topics/all` return active topics in that order.

Also pin 1-based numbering in the contract (replace "0-indexed or 1-indexed, consistent").

### V3. "The save should fail cleanly" / "lets the UI say 'the topic list changed; reload'" (§4)
Rewrite as a UI acceptance condition:

> When a save returns `409 TOPIC_ORDER_STALE`, the screen shows a message stating the topic list was changed elsewhere, discards the draft, and reloads the current saved order. No partial order is persisted.

That means the draft is lost on a stale save. I accept that, because the draft is built against a list that no longer exists. The proposal should say so rather than leave it implied.

### V4. Save-failure alternate flow (use case: "previously saved order is retained")
The use case says what happens server-side but not to the draft. Rewrite:

> On a `5xx` or network failure, the persisted order is unchanged and **the facilitator's draft remains on screen, still marked unsaved**, so they can retry without rebuilding it.

This is the opposite of V3, and deliberately so. A transient failure shouldn't cost the user their work.

### V5. Dirty draft vs. Remove/Restore (§5, Q5)
"Disable or discard" is still open. Recommend **disable Remove and Restore while the order is dirty**, with inline copy: "Save or discard your order changes first." That is simpler to test than a discard prompt, and it can't surprise the user. Acceptance:

> While the active list has unsaved order changes, Remove and Restore actions are disabled and the reason is shown. After Save or Discard, they are re-enabled.

### V6. Navigate-away warning (§5, Q6)
The use case leaves this as a UX decision. I'm making the call: **in scope for v1**, limited to in-app route changes. A browser `beforeunload` prompt is optional. Acceptance:

> Navigating to another in-app route while the order is dirty prompts the facilitator to confirm discarding changes. Confirming discards the draft. Cancelling keeps the facilitator on the screen with the draft intact.

### V7. Hidden vs. disabled controls
The notes say "hide or disable". Pick one per case:
- **Locked team:** hide reorder controls (matches the existing locked treatment, which hides Remove).
- **Fewer than 2 active topics:** hide reorder controls. The last-active guard makes 1 the minimum, so this is the "only one topic" alternate flow.
- **First / last row:** disable "Move up" on row 1 and "Move down" on row N (don't hide them, so the layout doesn't shift).

### V8. Explanatory copy (§5)
Pin the text so it can be asserted: "Order changes apply to sessions created after you save. Sessions already created keep their order." Use "created", not "started".

### V9. Use case wording is now wrong
- Out of Scope says "topic order is fixed at session **start**". Per `session-topic-lifecycle` spec, it is fixed at session **creation**. I'll correct the use case.
- Postcondition "All future sessions will present topics in the updated sequence" should become "Sessions created after the save present topics in the updated sequence."
- AC "After saving, the new order is used in all subsequent sessions" should get the same #175 Known-Limitation annotation that Re-Add Topic's AC received.

### V10. "No automatic reordering, ever" (§2.3)
Agreed, and the use case already has it as Out of Scope. Nothing to build. But don't write a "negative" spec scenario for it, since it can't be tested meaningfully. Put it in design.md as a non-goal with the rationale Devon gave (conversation tool vs. metric-optimizing tool).

### V11. "Restore default order" (§2)
Agree it's out of scope. FR-8.6 covers the *set*, not the order. The "read-only hint showing canonical position" is a nice-to-have, and I don't want it creeping in as part of "cheap". **Out of scope for this change**, recorded as a follow-up idea.

---

## 4. Positions on the open questions (§7)

1. **Archived collision fix: in this change, first.** It is a latent 500 today, and reorder turns it from rare to routine. Shipping reorder without it ships a known regression. I prefer it in this change over a separate prerequisite, to avoid a dependency hop, but it must be its own task group, its own migration with a rollback note, and its own spec scenario:
   > GIVEN a team with an archived topic at `display_order = k` AND an active topic at `display_order = k`
   > WHEN the active topic is archived
   > THEN the archive succeeds (no 500).

   **Partial unique index on active rows** is the right fix. It states the real rule: active order is unique, archived order is meaningless (confirmed by the `archived_at DESC` sort). Renumbering on archive hides the intent.
2. **409 for stale, 422 for malformed.** A stale list is a well-formed request that is invalid against current server state, the same class as the lock. Distinct codes let the UI branch (V3 vs. a validation message). On Devon's anti-oracle concern: unknown IDs, other-team IDs, and archived IDs should all collapse into the single `409 TOPIC_ORDER_STALE`, never a 404, so existence can't be probed. Only structural failures are 422: not an array, non-UUID entries, duplicates, empty, or over the cap.
3. **Two-phase renumber**, given the constraint is being replaced anyway. Engineering call. From my side it needs no requirement beyond "no partial order is ever persisted" (atomic).
4. **Buttons only for v1.** They meet the use case (desktop, tablet, keyboard) with no new dependency. DnD is a follow-up, and if added it must meet the same keyboard/screen-reader bar.
5. **Disable** (see V5).
6. **In scope**, in-app only (see V6).
7. **Audit: full before and after ID arrays.** Payload: `{ previous_order: uuid[], new_order: uuid[] }` with actor, team, correlation ID as standard. **IDs only, no names.** Names can change, and the topic record resolves them. Size is bounded by active topic count plus the C6 cap. The locked-denial row uses the existing `topic.write_denied_locked` shape with `attempted_operation: "topic.reordered"`, and no order payload. No audit row for a no-op (C4).
8. **Yes, update the contract in this change**: admin branch, 409 lock, error envelope, check cascade, timing floor, 1-based, 404 only for the team, 409 stale / 422 malformed, and response shape.
9. **FR-2.7:** restate (see §1). I own the BRD edit.
10. **Accept the #175 known limitation**, same wording pattern as Restore Topic. The proposal must name exactly what *is* proven: `topics.display_order` is persisted densely, `GET /topics` and `GET /topics/all` reflect it, and no `session_topics` row is touched.

---

## 5. Suggested acceptance conditions to carry into the proposal (consolidated)

1. A facilitator (non-member) or application admin can save a full ordering of the team's active topics. Response `200` returns the active topics with `displayOrder` `1..N` in the submitted order.
2. A locked team returns `409 TOPIC_CUSTOMIZATION_LOCKED` and writes `topic.write_denied_locked` with `attempted_operation: "topic.reordered"`, whatever the body.
3. Engineers and team-member facilitators get `403`. An unknown team gets `404`.
4. A malformed body (not an array, non-UUID, duplicates, empty, over the cap) gets `422`. No change.
5. A well-formed list that doesn't equal the current active set (missing, extra, archived, other-team, or unknown IDs) gets `409 TOPIC_ORDER_STALE`. No change.
6. Success writes exactly one `topic.reordered` audit row with before and after ID arrays, in the same transaction. A no-op writes none.
7. Existing sessions' `session_topics` are untouched. Reorder is allowed while a session exists.
8. Archiving a topic after a reorder never fails on a `display_order` collision.
9. UI: move up/down per row. Draft is local until "Save order". "Discard" reverts. Save is disabled when the draft is clean. Remove/Restore are disabled while dirty. There is an in-app navigate-away prompt. Controls are hidden when locked or when fewer than 2 topics. The explanatory copy uses "created".
10. UI on stale (`409`): message, draft discarded, list reloaded. UI on `5xx`: error shown, draft retained, retry possible.

---

## 6. Requirements-doc changes I will make (not engineering tasks)

- BRD FR-2.7: restate per §1.
- Reorder Topics use case: "start" to "creation" (Out of Scope), postcondition wording, #175 annotation on the "subsequent sessions" AC, navigate-away decision recorded (resolves the Notes item), FR-2.7 link under Dependencies.
- Validation Report `:27`: note that FR-2.7 is covered only for non-first sessions, by design.
