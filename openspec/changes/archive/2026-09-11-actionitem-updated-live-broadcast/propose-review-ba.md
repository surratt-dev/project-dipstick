# BA Review — Proposal: `actionitem-updated-live-broadcast` (#64 + #95, combined)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `specs/action-item-status-management/spec.md`, `specs/websocket-specification/spec.md`, `tasks.md`
**Grounded against:** `requirements/BRD.md` (FR-3.1–FR-3.5, FR-7.1–FR-7.6, FR-1.3, OR-6.4), `requirements/use cases/07 - Action Item Management - Use Cases.md`, `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`, `requirements/design/REST API Contract.md` (VOTE-001, VOTE-002), `packages/backend/migrations/2_create_tables.sql`, `packages/shared/src/types/action-item.ts`, shipped route code (`content.ts`, `em-views.ts`)

---

## Headline finding: the proposal missed a pre-existing, fully-worked REST contract entry for this exact endpoint

Before anything else, because it changes how I read the rest of this proposal: `requirements/design/REST API Contract.md` already contains **VOTE-002 — Update Action Item Status** (lines 1870–1935), a complete, previously-authored spec for `PATCH /api/v1/action-items/:actionItemId/status` — request body, response shape, authorization rules, error table, and implementation notes. Nobody in this change's lineage — exploration, my own prior review, Priya's review, design.md, or the proposal — found it. I searched the change directory for any reference to VOTE-002, `resolved_in_session_id`, or `resolvedInSessionId`: zero hits.

This matters because both `proposal.md` ("which has no entry for it today") and `design.md`'s Migration Plan ("has no entry for it today") assert something factually false, and because VOTE-002 already answers, in writing, several of the things this proposal treats as open:

| Question | This proposal's status | VOTE-002's existing answer |
|---|---|---|
| Endpoint path | `PATCH /api/v1/action-items/:id` (proposal.md, design.md Impact) | `PATCH /api/v1/action-items/:actionItemId/status` |
| `sessionId` placement | **Open Question 2** — "route param, body field, or query param — pick one" | Optional request-body field, validated (`422` if the referenced session isn't active) |
| Invalid-transition response code | **Open Question 3** — "409 has precedent... but the architect should confirm" | Already asserts `409 Conflict`, explicitly, no hedge |
| Facilitator authorization scope | **Open Question 1** — session-scoped vs. standing team-wide, explicitly unresolved | "may update any action item belonging to a team they are actively facilitating (active session exists)" — a third formulation, closer to session-scoped but not word-for-word what design.md's lean says |
| Resolution note on this endpoint | Excluded entirely; every history row writes `resolution_note = NULL`; capture deferred whole-cloth to issue #65 | `resolutionNote?: string` is part of *this same endpoint's* request body, optional, max 500 chars, tied to `action_items.resolution_note` and `action_items_resolution_note_length` |
| `action_items.resolved_in_session_id` | Never mentioned anywhere in design.md, proposal.md, or the spec deltas | Central to VOTE-002's contract: set when `status = 'resolved'` and `sessionId` provided; response body includes `resolvedInSessionId` |

None of this is a reason to block the proposal — but it is a reason it can't go to the architect as currently written. Three sub-findings, in order of how much they change the proposal:

**1. The `resolution_note` exclusion needs to be a stated decision, not a silent divergence.** This isn't a hypothetical future column: `action_items.resolution_note` and `action_items.resolved_in_session_id` already exist in the schema (`2_create_tables.sql:142-143`), already have a shared TypeScript type (`packages/shared/src/types/action-item.ts:11-12`), and are already **read and displayed today** — `content.ts` and `em-views.ts` both select and surface `resolution_note` on resolved items, and `em-views.test.ts:681` asserts a resolution note round-trips through the EM view ("Capacity adjusted in planning"). There is no write path yet (the exploration's grep for `UPDATE action_items` correctly found nothing), so nothing regresses today. But VOTE-002 already specced resolution-note capture as part of *this same endpoint*, not a separate one. Deferring it to issue #65 may still be the right proportionate-scope call — I'm not arguing it isn't — but the proposal needs to say "VOTE-002 already included this; we are deliberately narrowing that contract for this change, here's why" rather than asserting the field doesn't exist in any prior design. An architect or engineer who opens the REST contract doc mid-implementation (which they will — it's the canonical contract doc) will find a contradiction the proposal never flagged.

**2. Open Questions 2 and 3 aren't actually open — they're "does the architect want to affirm or override an existing documented answer."** Frame the tasks.md items that way. As written, 1.2 and 1.3 read as if the architect is deciding on a blank page; they're not — they're choosing whether to ratify VOTE-002's existing `sessionId`-as-optional-body-field-with-422-validation and `409`-for-invalid-transitions, or explicitly override them. That's a meaningfully smaller, faster decision than what tasks.md currently implies, and it removes the risk of the architect independently reinventing an answer that already exists and then having to reconcile two documents that disagree.

**3. Open Question 1 (facilitator scope) needs to be read against VOTE-002's third formulation, not just the two use cases.** Design.md frames this as a two-way choice between the UC's "session-scoped" language and a "standing team-wide grant." VOTE-002 offers a third: "any action item belonging to a team they are actively facilitating (active session exists)" — team-wide *while a session is active*, not scoped to that specific session's own participant list. That's neither of design.md's two options exactly. Someone needs to explicitly reconcile three sources, not two, before this is a clean 403 test matrix.

**4. Task 5.3 is scoped wrong.** It says "Add a new entry for the status-update endpoint to `requirements/design/REST API Contract.md` (currently missing...)." It should say "reconcile VOTE-002's existing entry with this change's decisions" — different task, different review surface, and it should explicitly correct VOTE-002's own stale claim about a `action_items_resolved_has_session` CHECK constraint, which I checked against the migration and does not exist (`2_create_tables.sql:134-150` has no such constraint). That's a pre-existing inaccuracy in VOTE-002, not something this change introduced, but this change is the one touching that section next and shouldn't leave it uncorrected a second time.

I'd treat this whole finding as a blocking process gap, not a blocking scope problem: the proposal's substance is largely fine, but it was authored and reviewed twice without anyone checking the one document whose entire job is to already answer exactly these questions. That's worth naming so it doesn't happen again on the next change through this same doc.

---

## Follow-through on my exploration-stage review

Checking my own prior asks (`explore-review-ba.md`) against what actually landed in `design.md` and the spec deltas:

- **Facilitator authority scope ambiguity** — correctly captured as Open Question 1 in design.md, not silently decided. Good. (Now needs the VOTE-002 reconciliation above.)
- **Same-status no-op field semantics** — resolved cleanly. D6 names `action_items.updated_at` as the mechanism, and the spec delta's Requirement 4 states it as a testable line ("SHALL update `action_items.updated_at` to the current time"), exactly what I asked for. No further gap.
- **`action_item_history` row shape tied to the real schema** — resolved cleanly. D5 and the spec delta's Requirement 5 cite the real column names and state `resolution_note = NULL`, `session_id` tied to the session-context resolution, `changed_by_user_id` = acting user. Good — this also correctly closes the "actor visible in history" open question from the `07` UC file, as noted.
- **Payload should carry `previousStatus` + `newStatus`** — resolved. D4 and the websocket-specification delta both state this explicitly, matching `SessionStateChangePayload`'s shape.
- **Session-context edge cases** (no session supplied; bad/stale session supplied) — resolved well. The websocket-specification delta's scenarios ("A status change made outside any live pre-session review publishes no broadcast") state the mutation-succeeds-broadcast-is-conditional split explicitly, matching D7. Good.
- **Status-transition-validity HTTP response** — captured as Open Question 3, correctly not silently decided. (Now: see finding above — VOTE-002 already asserts 409 without a hedge, so this is closer to "confirm" than "decide.")
- **REST API Contract doc gap** — a task exists (5.3), so the *intent* landed, but see the headline finding: it's scoped as "add" when it should be "reconcile," and the false "no entry" premise made it into both proposal.md and design.md.

The one thing I flagged that isn't fully closed: I asked for an explicit statement of whether a no-op still requires the same authorization check as a real transition. The spec delta's Requirement 4 scenario ("Authorization is enforced identically on a no-op request") covers this directly. Confirmed closed.

Net: five of seven prior points landed cleanly and are buildable as written. The two that didn't (REST contract task framing, facilitator-scope's third source) both trace back to the same root cause — VOTE-002 wasn't found.

---

## Capability-by-capability buildability check

### `action-item-status-management` (new capability)

This spec delta is genuinely strong — better than most exploration-to-spec translations I've reviewed on this project. Each requirement pairs a SHALL statement with Given/When/Then scenarios that are directly testable, and it correctly marks the three still-open decisions with explicit "not asserted here as settled" language rather than quietly picking an answer. Specific notes:

- **Ownership requirement** — explicit, unambiguous, matches FR-7.3 and the "Engineer Updates Status" UC directly. No changes needed.
- **Facilitator requirement** — correctly flags the open scope question rather than asserting it; the scenarios are written to hold regardless of which way Open Question 1 resolves. Good pattern — this is how you spec around an open decision without blocking on it.
- **Transition-validity requirement** — this is the one I flagged as a gap during exploration (Resolved-is-terminal, not just backward-transition-protected) and it's now fully and correctly specified, including the "same-status-on-Resolved is rejected, not a no-op" distinction as its own scenario. This was the sharpest edge case in the whole change and it's handled correctly.
- **No-op requirement** — explicit, names the field, states the no-broadcast/no-history-row behavior as testable scenarios. Buildable as written.
- **History-row requirement** — cites the real schema, states atomicity as an explicit scenario ("The status update and its history row are atomic"). Buildable as written.

No vague language remains in this delta spec that I'd send back on its own merits. My only addition is the resolution_note point in the headline finding above — this capability's scope statement should explicitly acknowledge it's narrowing VOTE-002's existing contract, not just silently not mention resolution notes.

### `websocket-specification` (modified capability)

Also strong. The distinction between the wrap-up-finalization case (`action_item_finalized`) and the live pre-finalization case (`action_item_status_updated`) is stated clearly in both the Requirement text and a dedicated scenario, which matters because those two are genuinely easy to conflate on a skim. The gating-to-`pre_session` behavior and the "mutation succeeds, broadcast is conditional" split are both explicit, testable scenarios rather than prose assertions.

One gap: this delta spec's payload description says the payload "carries `sessionId`, `actionItemId`, `previousStatus`, `newStatus`, and `updatedAt`" — but VOTE-002's response body doesn't use `updatedAt` as the resolution-relevant timestamp field name for a resolution event; it separately tracks `resolvedInSessionId`. Not a conflict exactly, since the WS payload and the REST response are different contracts and don't need identical field names — but worth a one-line note in design.md confirming that's a deliberate, not accidental, naming divergence, given how much of this review turned out to hinge on undiscovered cross-document naming mismatches.

---

## Cross-check against BRD and use cases

No material conflicts beyond what's already been surfaced and correctly handled:

- FR-3.1–FR-3.5 grounding is accurate throughout.
- FR-7.1–FR-7.3 map cleanly onto the spec delta's requirements; FR-7.2's required fields are unaffected (no schema change, correctly stated).
- The FR-7.4 (single staleness threshold) vs. UC (three-color graduated scale) inconsistency is correctly kept out of this change's scope and correctly filed as a BA follow-up in the "Out of scope" section of proposal.md, per the exploration §10 resolution. This change's own write (`action_items.updated_at`, a bare timestamp) is neutral to both readings, as intended. I'll open that reconciliation as a separate documentation task on my own backlog — not blocking this change.
- FR-1.3's role model and OR-6.4 (multiple facilitators, equivalent access) are respected; no Administrator bypass is asserted anywhere in the spec delta, matching my exploration-stage ask (tasks.md 3.7 explicitly tests for its absence). Good.
- The "Reassign an Action Item When an Owner Leaves the Team" UC (07) and its `VOTE-004` REST entry are untouched by this change and don't overlap with the status-transition endpoint's scope — confirmed no collision.

---

## What I'd want resolved before this leaves proposal stage

1. **Correct the "no entry exists" claim** in both `proposal.md` and `design.md`'s Migration Plan — VOTE-002 exists. Reframe the REST-contract task (tasks.md 5.3) as reconciliation, not creation.
2. **State explicitly whether this change deliberately narrows VOTE-002's resolution-note scope**, and why, rather than silently not mentioning that VOTE-002 already specced it in. If the proportionate-scope reasoning (defer to #65) still wins after that's stated plainly — likely — say so as a stated decision, not an omission.
3. **Feed VOTE-002's existing `sessionId`/response-code/facilitator-scope language to whoever resolves Open Questions 1–3**, framed as "ratify or override an existing documented answer," not "decide from scratch." This should materially shorten that step, not lengthen it.
4. **Note `action_items.resolved_in_session_id`'s relationship (or lack of one) to this change's `action_item_history.session_id` decision** — right now the design only discusses one of the two session-tracking columns this schema actually has for action items, and a reader comparing this change to VOTE-002 will reasonably ask whether `resolved_in_session_id` is meant to also get wired up here or is explicitly staying untouched.

None of this changes my basic agreement with the shape of the change: the combined #64+#95 scope call is right, the delta specs are well-written and buildable on their own terms, and the non-spotlight/facilitator-fidelity constraints from the exploration reviews made it into design.md intact. What I don't want is for an architect or engineer to hit VOTE-002 mid-implementation, discover it says something different, and have to guess whether that's a stale document or a signal this proposal missed — that's exactly the "Slack message to me mid-implementation" failure mode both Devon and I have been trying to design out of this process.
