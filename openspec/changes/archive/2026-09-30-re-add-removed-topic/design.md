## Context

`requirements/design/REST API Contract.md` already carries a fully drafted TOPIC-005 (`POST /api/v1/teams/:teamId/topics/:topicId/restore`), sitting next to the now-shipped TOPIC-004. `packages/backend/src/routes/topics.ts` already holds TOPIC-003 (Add Custom Topic) and TOPIC-004 (Archive Topic, `remove-topic`, #51), both built against a shared, decision-only authorization function — `checkStandingFacilitatorOrAdminAuthorization` in `packages/backend/src/auth/standing-facilitator-access-helper.ts` — and both already wired to `checkTeamExists`, `checkCustomizationLockGate`, and `applyTimingFloor`. `packages/frontend/src/pages/TopicManagementPage.tsx` already renders an archived-topics section with per-row `archivedAt`/`archivedBy` provenance (`remove-topic` Task 9.5). This design does not redraw any of that surface; it adds the restore endpoint as a third caller of the existing shared pieces and extends the archived-topics section with one action. It does not touch the EM trend view — see the Scope Correction note below.

**Constraints carried in from exploration, not re-derived here** (see `exploration-notes.md` for full reasoning, revised after Priya Nair's facilitator review and Marcus Delgado's BA review; this document states the resulting decisions):
- TOPIC-005's authorization, as drafted in the contract, repeats the pre-correction TOPIC-004 mistake: facilitator-only, no `application_admin` branch, and the customization lock folded into the `403` row instead of split out to `409`. Both are corrected here the same way `remove-topic` corrected them for TOPIC-004, reusing the same shared function rather than re-deriving the reasoning.
- The full six-step check-ordering cascade for TOPIC-005, explicit rather than left as "applies identically to TOPIC-004 by analogy."
- The append-position race is closed by the same `pg_advisory_xact_lock(hashtext(teamId))` TOPIC-003 and TOPIC-004 already use, in the same shared lock namespace — a concurrent archive and restore against the same team serialize against each other by design.
- Provenance: `archived_at`/`archived_by` are preserved through restore, not cleared; `restored_by` is added as a dedicated column alongside the already-drafted `restored_at`, matching the `archived_by` precedent rather than overloading `updated_at`.
- Confirmation UX reuses the exact local-state, single-dialog pattern already built for Remove; restore's confirmation is a single step (no open-action-item escalation branch exists in this direction — restoring only ever increases the active count).

**Scope correction, made after executive review (see `proposal.md`'s "Scope Decision" section):** exploration originally carried a sixth decision in this document — a trend-gap signal, derived from `session_topics` absence, surfaced in the EM trend view. Rachel Okonkwo's executive review recommended splitting it into its own change, coordinated with Trend Dashboard ownership, since the use case's own Notes call for exactly that coordination and restore has no dependency on it either direction. Devon Calloway accepted the split. That decision, its reasoning, and the design work already done for it (derivation approach, response shape) now live in `proposal.md` rather than as a decision in this document; this document covers only `restore-topic`, `topic-management-screen`, and `topic-customization-lock`.

**Picking this up as Solution Architect.** One thing worth confirming before stating decisions: TOPIC-005's drafted response (`RestoreTopicResponse`, `REST API Contract.md:836-840`) already includes `restoredAt` but not `restoredBy` — the gap this design closes is narrower than "no provenance decision exists at all." Confirmed by reading the contract, not assumed.

## Goals / Non-Goals

**Goals:**
- Ship `POST /api/v1/teams/:teamId/topics/:topicId/restore` (TOPIC-005), reusing TOPIC-004's team/lock/authorization/audit conventions and cascade shape verbatim where they transfer, extending only where restore's semantics differ (topic-already-active instead of already-archived; append-position race instead of last-active-topic guard).
- Correct TOPIC-005's authorization to the standing-facilitator-or-admin model before it ships, rather than shipping the same FR-8.2 gap `remove-topic` already found and fixed once for TOPIC-004.
- Add `restored_by`/`restored_at` provenance, preserving `archived_at`/`archived_by` through the transition.
- Extend the existing Topic Management screen's archived-topics section with a "Restore" action and a single-step confirmation dialog, reusing the established local-state pattern.

**Non-Goals:**
- The trend-gap signal (a marker in the EM trend view indicating a topic was intentionally absent for a stretch of sessions) — deferred to a follow-up change per executive review; see `proposal.md`'s "Scope Decision" section for the full rationale. Not built here, including no changes to `EmTopicTrend`, `EmTopicSessionDataPoint`, `em-views.ts`, or `EmTrendDataPage.tsx`.
- TOPIC-006 (Reorder), TOPIC-007 (Annotate) — separate future issues, unaffected by this change.
- Extending TOPIC-003's identity/role check to admit `application_admin` — tracked separately (#176, filed by `remove-topic`), not reopened here.
- Building `session_topics` population at session creation (#175, filed by `remove-topic`) — still unbuilt; this change does not attempt it. See `specs/restore-topic/spec.md` for the explicit scenario acknowledging that the use case's "included in the next session" acceptance criterion is blocked on #175 for any topic, restored or otherwise.
- A "why was this topic removed" reason field, on either archive or restore — not asked for by any requirement, and would reopen a scope boundary `remove-topic` already deliberately left alone.
- A shared `Modal`/`ConfirmDialog` component — still no second consumer beyond `MemberManagement.tsx`'s and `TopicManagementPage.tsx`'s own inline-state patterns; restore's dialog is the fourth state added to the same discriminated union, not a new abstraction.

## Decisions

### Decision 1 — `POST /api/v1/teams/:teamId/topics/:topicId/restore` lives in `topics.ts`, reusing TOPIC-004's helpers verbatim, including the already-corrected authorization function

**Decision:** The new handler is added to `packages/backend/src/routes/topics.ts`, alongside TOPIC-003 and TOPIC-004. It calls `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` — the same decision-only function TOPIC-004 and TOPIC-002 already call — not a new, TOPIC-005-specific check. It calls `checkTeamExists` and `checkCustomizationLockGate` unchanged. Each early-return this handler introduces calls `applyTimingFloor(startTime)` itself, immediately before responding, exactly as Decision 2's amendment (below) requires.

**Why:** `REST API Contract.md:818` drafts TOPIC-005's authorization as `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false` — no `application_admin` branch, and the lock folded into the same line as an actor-identity fact rather than a state precondition. This is exactly the shape `remove-topic` design.md Decision 1 found and corrected for TOPIC-004, for the identical FR-8.2 `[HARD]` reason: TOPIC-002 already grants `application_admin` access to the read endpoint that lists a team's archived topics and would render a "Restore" affordance for one, and an admin who clicks it would get a confusing `403` — the same concrete, shippable UX bug Marcus Delgado's BA review caught for TOPIC-004, reachable here by construction since this change is the first to put a Restore button in front of that already-admin-visible list. There is no principled reason for TOPIC-005 to have a narrower authorization model than its sibling TOPIC-004 — same team, same topic, same caller population, opposite status transition. Reusing the shared function closes this before it ships, rather than shipping the gap and waiting for a second review to find it a second time.

**Alternatives considered:**
- *Implement TOPIC-005's authorization as separately drafted in the contract (facilitator-only, lock folded into `403`).* Rejected — ships a known-shape FR-8.2 gap and a known-shape `403`/`409` error-table mistake into a fourth endpoint in the same file, when both have already been found, fixed, and function-ized once.
- *Write a new, TOPIC-005-specific wrapper around `evaluateStandingFacilitatorAccess`, distinct from TOPIC-004's.* Rejected — TOPIC-005's authorization semantics are identical to TOPIC-004's and TOPIC-002's; a fourth near-duplicate wrapper would be the exact drift risk the shared function's original engineer review (cited in `remove-topic` design.md Decision 1) was built to close.

**Implementation-time verification (flagged by Security Analyst design review):** this decision is only real if the shipped handler actually calls `checkStandingFacilitatorOrAdminAuthorization` and routes the lock check through the existing `checkCustomizationLockGate`'s `409`, rather than a re-derived inline check that reintroduces the contract's original `403`-folded-lock mistake at the handler level. The design review could not verify this against running code since the handler doesn't exist yet; tasks.md Task 8.6 makes this an explicit verification step rather than an assumption.

### Decision 2 — Full check-ordering cascade for TOPIC-005

**Decision:** TOPIC-005 evaluates checks in exactly this order, short-circuiting on the first failure:

1. Identity/role authorization — `checkStandingFacilitatorOrAdminAuthorization` (Decision 1). Failure → `403 Forbidden` (`NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`).
2. Team existence. Failure → `404 Not Found` (`TEAM_NOT_FOUND`).
3. Customization lock (`hasCompletedFirstSession`). Failure → `409 Conflict` (`TOPIC_CUSTOMIZATION_LOCKED`) — audited via `writeLockDenialAudit`, same shared `topic.write_denied_locked` operation TOPIC-003/004 already use.
4. Topic existence and ownership — `topicId` refers to a row in `topics` with `team_id = :teamId`. Failure → `404 Not Found` (`TOPIC_NOT_FOUND`).
5. Topic status — the topic is currently `archived`. Failure → `422 Unprocessable Entity` (`TOPIC_ALREADY_ACTIVE`, a new reason code — the natural mirror of TOPIC-004's `TOPIC_ALREADY_ARCHIVED`).
6. Advisory-lock-guarded reposition and status flip (Decision 3, below) → `200 OK`.

**Why:** identical leak-prevention reasoning to TOPIC-004's cascade (`remove-topic` design.md Decision 2): a check that reveals nothing about a specific team runs before one that does, and a check that reveals nothing about a specific topic runs before one that does. Team existence and the team-scoped lock both precede any topic-specific check; topic existence precedes topic status for the same reason team existence precedes the lock. There is no last-active-topic-shaped guard to sequence in this direction — restoring a topic only ever increases a team's active count, so no analogous hard block exists here, and the cascade is one step shorter than TOPIC-004's as a direct consequence, not an oversight.

Every early-return in this cascade — steps 1 through 5's failures, and the `200` success in step 6 — calls `applyTimingFloor(startTime)` immediately before responding, with no branch exempted, matching TOPIC-003/004's established discipline.

**Alternatives considered:** *Omit the topic-status check and rely on the `UPDATE ... WHERE status = 'archived'` clause silently affecting zero rows for an already-active topic.* Rejected — this would return a misleading `200` for a no-op write instead of the `422` a caller can act on, and would make the response ambiguous between "restored" and "was already active, nothing happened."

### Decision 3 — Append-position race closed by the same per-team advisory lock TOPIC-003/004 already use; provenance set in the same transaction

**Decision:** The status flip and reposition happen inside a transaction guarded by `pg_advisory_xact_lock(hashtext(teamId))` — the identical mechanism `remove-topic` design.md Decision 3 introduced for TOPIC-004's last-active-topic guard, and the sibling `topic-customization-lock-and-add-custom-topic` design's Decision 10 introduced for TOPIC-003's `displayOrder` assignment:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($teamId::text));

SELECT COALESCE(MAX(display_order), 0) + 1 AS new_position
  FROM topics
 WHERE team_id = $teamId AND status = 'active';

UPDATE topics
   SET status = 'active',
       display_order = $new_position,
       restored_at = now(),
       restored_by = $userId
       -- archived_at, archived_by intentionally left untouched — preserved,
       -- not cleared, per Decision 4
 WHERE id = $topicId AND team_id = $teamId AND status = 'archived'
 RETURNING restored_at;

COMMIT;
```

**Zero-rows branch — the same precheck/lock race TOPIC-004 already closed, carried forward explicitly:** Decision 2's topic-status precheck (step 5) runs before the advisory lock is taken, exactly like TOPIC-004's own precheck does (`topics.ts` Task 3.3, `remove-topic` design.md Decision 3). Two concurrent restores against the *same* archived topic can both pass that precheck, then serialize on the advisory lock; the second one through finds zero rows on its `UPDATE`. The handler must not treat that as success — it branches explicitly, mirroring `topics.ts:686-698`'s existing `TOPIC_ALREADY_ARCHIVED` handling with the restore-direction reason code:

```
if (restoreResult.rows.length === 0) {
  // Topic was restored (or re-archived) by a concurrent request between
  // Decision 2 step 5's pre-check and this UPDATE — both serialized
  // per-team by the advisory lock, but the pre-check itself runs before
  // the lock is taken. Same race shape as topics.ts:686-698's
  // TOPIC_ALREADY_ARCHIVED branch, mirrored for restore.
  await client.query("ROLLBACK");
  await applyTimingFloor(startTime);
  return reply
    .code(422)
    .send(buildErrorEnvelope("invalid_request", "This topic is already active.", "TOPIC_ALREADY_ACTIVE"));
}
```

This is not a new branch invented for TOPIC-005 — it is TOPIC-004's already-shipped pattern (`topics.ts` Task 5.3), applied to restore's `UPDATE` with `TOPIC_ALREADY_ACTIVE` in place of `TOPIC_ALREADY_ARCHIVED`. Omitting it — relying on the `WHERE ... status = 'archived'` clause alone — would leave the handler either throwing on an empty `RETURNING` result or silently responding with a stale or undefined position, neither of which is the `422` this design otherwise commits to for an already-active topic.

**Why — the advisory lock:** without it, two concurrent requests against the same team — two restores, or a restore and a concurrent `POST /topics` (Add Custom Topic) — could both read the same `max(display_order)` and both attempt to write the same position, colliding against `topics_team_order UNIQUE (team_id, display_order, status)`. This is the identical race shape TOPIC-003's Decision 10 and TOPIC-004's Decision 3 already closed; TOPIC-005 is the third use of an already-proven mechanism, not a new pattern. `SELECT ... FOR UPDATE` is rejected here for the same MVCC reason it was rejected for TOPIC-003: it only re-verifies rows already in its snapshot and does not correctly serialize a second transaction's fresh `MAX(display_order)` read against a first transaction's not-yet-committed write.

**Why the lock namespace is shared, not endpoint-scoped:** `hashtext(teamId)` is the same lock key TOPIC-003 and TOPIC-004 already take — a concurrent archive and restore against the same team serialize against each other. This is intentional cross-endpoint serialization: both operations mutate the same team's `status`/`display_order` state, and this is stated explicitly so a future reader debugging contention under load does not have to re-derive that it's by design rather than an accidental side effect of reusing a hash function.

**Why the `WHERE ... status = 'archived'` clause on the `UPDATE`:** re-verifies the precondition Decision 2's status check already evaluated, inside the same transaction that holds the advisory lock — belt-and-suspenders consistent with TOPIC-004's `UPDATE ... WHERE status = 'active'` clause.

**Alternatives considered:**
- *Restore to the topic's own stored `display_order` value instead of appending.* Rejected: the `topics_team_order UNIQUE (team_id, display_order, status)` constraint is why archiving a topic never had to renumber the remaining active topics in the first place (TOPIC-004's `UPDATE` only sets `status`/`archived_at`/`archived_by`) — restoring to the prior position would require deciding what happens if an active topic has since taken that slot (via `POST /topics`, which also appends), machinery appending avoids needing entirely. (The proposal previously cited FR-8.6 for this decision; that citation was wrong — FR-8.6 is about the canonical default topic set remaining restorable, not about ordering semantics. The decision itself doesn't depend on FR-8.6 and stands on the constraint reasoning above; the mis-citation has been corrected in `proposal.md`.) Nothing in the requirements suggests appending is disorienting to facilitators in practice.
- *A dedicated `topics_restore` advisory lock, separate from TOPIC-003/004's.* Rejected — there is no reason for concurrent writes to a team's topic configuration to serialize against each other only sometimes; one lock namespace per team, covering every write to that team's `topics` rows, is the simpler and already-proven shape.

### Decision 4 — Provenance: preserve `archived_at`/`archived_by` through restore; add `restored_by` alongside the already-drafted `restored_at`, both dedicated columns

**Decision:** `topics` gains two new nullable columns: `restored_by uuid NULL REFERENCES users(id)` and `restored_at timestamptz NULL`. The restore transaction (Decision 3) sets both and leaves `archived_at`/`archived_by` untouched — it does not clear them. `GetAllTopicsResponse.archived[]` gains `restoredBy: { userId, displayName } | null` and `restoredAt: string | null`, populated via the same join pattern `archivedBy` already uses. A topic that has been archived and restored multiple times shows only the most recent restore event, the same limitation `archivedAt`/`archivedBy` already carry for multiple archive events — this is a stated limitation, not a gap this change is asked to close. (A mechanism that generalizes across multiple cycles — deriving gaps from `session_topics` presence rather than from these provenance timestamps — was scoped during exploration but is deferred to the follow-up change described in `proposal.md`'s "Scope Decision" section, not built here.)

**Why — preserving `archived_at`/`archived_by`:** a facilitator looking at the active list some time after a restore and wondering "didn't this used to be gone for a while?" gets an answer that's still there, until the topic is archived again and the record updates to the new event. Clearing on restore throws away an answer for no benefit anyone has identified.

**Why a dedicated column instead of reusing `updated_at`:** `updated_at` would be cheaper to populate, but it collapses "this topic was restored" into "this row was touched by literally any future edit to any field," which defeats the point of having a provenance fact at all — the same reasoning `archived_by` was given a dedicated column over an audit-log read path in `remove-topic` design.md Decision 6.

**The asymmetry with `archived_by`'s original case, named rather than glossed over:** `archived_by`'s case rested on two facts — the audit log is the wrong architectural boundary for a product-facing read, and a facilitator inheriting a team needs to know *who removed this and why it's gone*, because an unexplained absence can look like a bug. The first fact transfers to restore unchanged. The second does not transfer at the same strength: a restored topic's presence on the active list needs no explanation to use correctly — nobody is confused by a topic that's there. The continuity value of `restored_by`/`restored_at` is real but genuinely weaker than `archived_by`'s was. This design adds the columns anyway because the marginal cost is small (two more nullable columns on a table that already has the sibling pair, one join already being made) against a real, if smaller, continuity benefit — not because the two cases are equally strong.

**Alternatives considered:**
- *Clear `archived_at`/`archived_by` on restore.* Rejected — throws away a continuity answer for no identified benefit.
- *Serve `restoredAt` from `updated_at` instead of a dedicated column.* Rejected — collapses a specific provenance fact into "was edited at some point," the same reasoning that already ruled this out for `archived_by`.
- *No `restored_by` at all, keep only the already-drafted `restored_at`.* Rejected — an asymmetric answer ("we know when, but the screen that already shows who archived a topic has no who for who brought it back") is a stranger gap to explain than the small cost of adding the column.

### Decision 5 — Frontend: a "Restore" action added to the existing archived-topics section, following the established local-state pattern

**Decision:** `TopicManagementPage.tsx`'s archived-topics section gains one action per row and one additional state shape in its existing `RemoveTopicState`-style discriminated union (renamed in spirit, not necessarily in code, to cover both remove and restore transitions — the exact type name is an implementation detail, not a design-level decision). The confirmation flow is a single step, not an escalating one — restoring only ever increases the active count, so TOPIC-004's last-active-topic guard has no analog reachable from this direction, and there is no server response shape equivalent to `requiresConfirmation` for restore to react to.

1. Click "Restore" → show a dialog: `"Restore '{topic.name}' for {team.name}? Historical data will be restored."` — matching `RemoveTopicDialog`'s existing plain, one-line tone. (The use case's own Main Flow step 5 wording also mentions the trend-view gap becoming visible; that clause is dropped from the shipped copy because the trend-gap signal itself is deferred to a follow-up change — see `proposal.md`'s "Scope Decision" section — and the dialog should not promise a marker that doesn't exist yet. The use case document is updated accordingly, not the other way around.)
2. Confirm → `POST .../topics/:topicId/restore`. On `200`, close the dialog, refresh the list — the restored topic disappears from `archived[]` and appears in `active[]` on the next fetch.

**Why:** Priya Nair's facilitator review (carried into exploration) established the "name both the topic and the team" requirement for Remove's confirmation, for a facilitator managing several teams under the standing model; the same risk of acting on the wrong team's topic applies with equal force here. `MemberManagement.tsx` and `TopicManagementPage.tsx`'s own existing Remove flow already establish the local-state, no-shared-`Modal` pattern this reuses — introducing a second pattern for a single-step confirmation that's strictly simpler than the one already built would be the premature-abstraction mistake Devon's exploration notes warn against in reverse (building something new where reuse is simpler).

**Acknowledged limitation, stated rather than discovered as a surprise:** this copy — and the provenance in Decision 4 — answers *what will happen* and *who/when*, never *why* a topic was removed in the first place. Nothing in this feature, or in `remove-topic` as shipped, has ever captured a reason, and this design does not add one (Non-Goals) — a facilitator restoring a topic archived months ago by someone she's never worked with is still partly guessing at intent.

**Alternatives considered:** *A second, separate confirmation component built for restore specifically.* Rejected — restore's flow is a strict subset of remove's already-built flow (no escalation branch needed), so extending the existing state machine costs less and introduces no new pattern for the next reader to learn.

### Decision 6 — Audit posture: `topic.restored` on success, mirroring `topic.archived`

**Decision:** A successful restore writes an `audit_log` row (`operation = 'topic.restored'`) inside the Decision 3 transaction, carrying `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata: { topic_id }`. `topic.restored` is added to `AuditEventName`'s union in `audit-logger.ts` alongside `topic.archived`/`topic.custom_added`/`topic.write_denied_locked`. A lock-denied restore attempt reuses `writeLockDenialAudit` and the existing `topic.write_denied_locked` operation name — no new per-endpoint variant, matching the established convention that this event name is shared across every topic-write endpoint the lock gates.

**Why:** matches `remove-topic` design.md Decision 7's reasoning exactly — the standing, org-wide facilitator model means "who did this" isn't answerable without a row, and that already mattered enough to build for both add and archive. It matters equally for restore: an EM or facilitator later asking "who brought this back" gets the same answer class Decision 4's `restored_by` column already gives on the product-facing read path; the audit row is the durable, append-only complement to it, not a substitute (same relationship `topic.archived` has to `archived_by`).

**Why other denial branches in this cascade remain unaudited:** matches `remove-topic` design.md Decision 7's stated scope exactly — identity/role, team-existence, and state-precondition failures (`TOPIC_NOT_FOUND`, `TOPIC_ALREADY_ACTIVE`) are not audited, only the lock denial is, consistent with TOPIC-003/004's established convention. TOPIC-005 introduces no new denial category that would warrant reopening that scope.

**Alternatives considered:** *A single event name covering both archive and restore, distinguished only by `metadata`.* Rejected — the codebase's existing convention is one event name per meaningful state transition (`topic.custom_added`, `topic.archived`), and `topic.restored` follows that precedent rather than introducing a different one for this endpoint alone.

## Risks / Trade-offs

- **[Risk]** TOPIC-005's authorization correction is a behavior change to a documented contract clause, the same shape of risk `remove-topic` accepted for TOPIC-002. → **Mitigation:** the endpoint is unbuilt today — there is no shipped caller to break, and the correction is implemented as the endpoint's first version, not a later widening of running code.
- **[Risk]** Two concurrent requests against the same team's topics (a restore and a concurrent add, or two concurrent restores) could both compute the same append position absent the advisory lock. → **Mitigation:** Decision 3 reuses the already-proven `pg_advisory_xact_lock(hashtext(teamId))` pattern, in the same lock namespace TOPIC-003/004 already use.
- **[Risk]** "Included in the next session" (the use case's own acceptance criterion) cannot be demonstrated end-to-end against a real, running session today, for a restored topic or any other. → **Mitigation, stated on the record rather than silently hit during implementation:** no shipped endpoint anywhere in this codebase currently populates `session_topics` at session creation (#175, filed by `remove-topic`, still open). This is a pre-existing gap this change inherits, not one it introduces; `specs/restore-topic/spec.md` states it explicitly rather than leaving it implicit in this document's prose alone. Not this change's job to fix.
- **[Risk]** A topic archived and restored more than once loses its full history in `archived_by`/`restored_by` (only the most recent event is retained per pair of columns). → **Mitigation:** accepted as a stated limitation of these product-facing provenance columns specifically; the audit log (Decision 6, above) retains every event regardless of how many archive/restore cycles a topic goes through, even though the product-facing columns only surface the latest pair. A reader who needs the full cycle history can still reconstruct it from the audit log.
- **[Trade-off]** No real-time update when a topic is restored by a different facilitator viewing the same team concurrently. → Accepted, matching `remove-topic` design.md's own accepted trade-off for archive — next navigation or reload picks up the change.

## Migration Plan

One additive migration: `topics.restored_by uuid NULL REFERENCES users(id)`, `topics.restored_at timestamptz NULL`. No backfill (every existing `topics` row has never been restored by any shipped endpoint). No feature flag — consistent with the standing position that protective, data-integrity-adjacent behavior is not configurable, and this change introduces no new protective constraint to gate (restoring a topic only ever increases a team's active count). Rollback is a plain code revert; the migration is additive and does not need to be reverted for a code-only rollback.

## Open Questions

None carried forward as open for this document's scope. Exploration resolved the authorization correction, the cascade ordering, the advisory-lock reuse, and the provenance recommendation as stated decisions, with reasoning, rather than leaving any of them as leans for this document to adjudicate. The trend-gap signal's scope and derivation were also resolved during exploration, but per executive review that work is deferred to a follow-up change rather than decided in this document — see `proposal.md`'s "Scope Decision" section.
