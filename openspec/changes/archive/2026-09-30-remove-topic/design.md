## Context

`requirements/design/REST API Contract.md` already carries a fully drafted TOPIC-004 (`DELETE /api/v1/teams/:teamId/topics/:topicId`, Archive Topic) and TOPIC-005 (Restore), reviewed against FR-8.3/FR-8.5/FR-8.6. `packages/backend/src/routes/topics.ts` already exists, holding `POST /api/v1/teams/:teamId/topics` (TOPIC-003, Add Custom Topic, #49/#50) and explicitly naming itself as the future home for TOPIC-004..007. This design does not redraw that surface; it implements TOPIC-004, corrects two contract inconsistencies discovered along the way, and builds the first Topic Management frontend screen.

**Constraints carried in from exploration, not re-derived here** (see `exploration-notes.md`, `explore-review-ba.md`, `explore-review-facilitator.md` for full reasoning; this document states the resulting decisions):
- Terminology is archive/restore, matching the shipped `topics.status`/`archivedAt` model, not remove/re-add.
- Authorization for the write endpoint is the standing, org-wide facilitator model already established by `topics.ts` (`evaluateStandingFacilitatorAccess`, `hasCompletedFirstSession`) — same as TOPIC-003.
- TOPIC-002's authorization is corrected to match TOPIC-003–007's uniform standing-facilitator model, not TOPIC-001's session-scoped one — confirmed as a never-decided drafting error (zero mentions of TOPIC-002 in the sibling design's 13 decisions), not a considered decision this design would be reversing, and confirmed greenfield (no existing callers of `GET .../topics/all`).
- Removing a team's last active topic is a hard `409` block, not a soft warning, with the same change also replacing `facilitator-sessions.ts`'s unhandled `throw` at begin-voting.
- The confirmation flow is one dialog escalating in place, not two independent always-shown dialogs; the server re-derives the open-action-item count on the confirming request rather than trusting a client-held number.
- Facilitator-visible provenance (who/when) is required on the archived-topics view — an audit-log row alone does not satisfy this, because facilitators do not read the audit log.
- `session_topics` is a per-session snapshot table, immune by construction to a concurrent archive (confirmed against `2_create_tables.sql:86-101`; no re-derivation from `topics.status` after session start).

**Picking this up as Solution Architect (Ingrid Sollenberger).** Two findings surfaced while implementing the constraints above that neither exploration document anticipated, and both are resolved as stated decisions below rather than left silent:
- Devon's exploration notes assumed facilitator-visible provenance could be read straight off the `topic.archived` audit event with "no new capture needed." That doesn't hold up: `audit_log.metadata` is a JSONB blob with no index on `(team_id, metadata->>'topic_id')`, and coupling a product-facing read path to the audit log's shape and retention is the wrong architectural boundary — the audit log exists for post-incident review, not as a queried dependency of a facilitator-facing screen. Decision 6 below adds a first-class `archived_by` column instead.
- Reading `facilitator-sessions.ts` end to end to scope the begin-voting fix (Decision 8) turned up that no shipped endpoint anywhere in this codebase inserts into `session_topics` — not `POST /api/v1/teams/:teamId/sessions/draft`, not any other route. Only two integration test fixtures construct `session_topics` rows directly. `session-topic-lifecycle`'s own spec (`:139`) asserts the topic list "is snapshotted into `session_topics` at session creation (`SESSION-001`)," but that snapshot step is not implemented in production code today. This means the begin-voting handler's crash is not narrowly gated behind "a team reaches zero active topics" the way both exploration reviews assumed — it is a pre-existing, broader gap this change did not create and is not scoped to close. Decision 8 states this explicitly and narrows this change's fix to the crash itself, not the missing snapshot mechanism.

## Goals / Non-Goals

**Goals:**
- Ship `DELETE /api/v1/teams/:teamId/topics/:topicId` (TOPIC-004), reusing TOPIC-003's team/lock/audit conventions, cascade shape, and error-envelope rather than reinventing them — extending, not verbatim-reusing, its identity/role check to satisfy FR-8.2's admin requirement (Decision 1).
- Close the last-active-topic gap TOPIC-004 makes reachable for the first time: a hard `409` at removal, and a clean, user-facing failure (not a `500`) at the one place a zero-topic state can still surface if it's ever reached another way.
- Correct TOPIC-002's authorization to the model its five sibling endpoints already share, so the Topic Management screen this change ships can actually load the list it needs.
- Give facilitators — who are standing and org-wide, not tied to one team — a way to see who archived a topic and when, without reading the audit log.
- Ship the first Topic Management screen: minimal, calm, one action, with a decided nav entry point.

**Non-Goals:**
- TOPIC-005 (Restore), TOPIC-006 (Reorder), TOPIC-007 (Annotate) — separate future issues (#52–55), built against the same helpers this change establishes further.
- Add/reorder/annotate frontend controls on the new screen.
- Widening TOPIC-001's authorization — Decision 12 of the sibling design already resolved that TOPIC-001's narrower model is intentional; this change's TOPIC-002 correction does not reopen it.
- Extending TOPIC-003's (Add Custom Topic, #49/#50, shipped) identity/role check to admit `application_admin`. TOPIC-003 has the same FR-8.2 gap Marcus Delgado's BA review found for TOPIC-004 (Decision 1) — but TOPIC-003 is already-shipped, already-deployed code, and widening its authorization is a separate change with its own review and rollout considerations. Fixing TOPIC-004 (new in this change) closes the concrete UX bug this proposal would otherwise ship — an admin who can list a team's topics (TOPIC-002) and see the Remove button render, but gets a confusing `403` on click. That does not require also touching TOPIC-003's already-running code. Deliberately deferred, stated here rather than left as a silent gap — and, per Tomás Ferreira's security review (Finding 5), given the same tracked-follow-up-issue treatment this document already applies to the `session_topics` gap below (tasks.md 12.2), rather than named and then left to be rediscovered.

- Fixing `session_topics`'s missing snapshot-at-creation mechanism (found in Context, above) — that is a materially larger, separately-scoped gap. This change closes only the begin-voting handler's unhandled crash.
- A `created_by` attribution column for custom topics (sibling design's Open Question 2) — untouched, still open.
- Real-time push when a topic is archived or the lock state changes — matches the sibling design's Decision 7 (no real-time unlock push); same reasoning applies here.

## Decisions

### Decision 1 — `DELETE /api/v1/teams/:teamId/topics/:topicId` lives in `topics.ts`, reusing TOPIC-003's team/lock/audit helpers verbatim; the identity/role check is extended, not reused verbatim, to admit `application_admin`

**Decision:** The new handler is added to the existing `packages/backend/src/routes/topics.ts`, calling the same `hasCompletedFirstSession` helper, the same `buildErrorEnvelope`/`applyTimingFloor` machinery, and the same `writeLockDenialAudit` function for the lock-denial branch (reusing the `topic.write_denied_locked` operation name — no new per-endpoint variant, per the sibling design's own note that this name is shared across every topic-write endpoint the lock gates) exactly as TOPIC-003 does.

The identity/role check is the one piece **not** reused verbatim. TOPIC-003's shipped `checkStandingFacilitatorAuthorization` (#49/#50) rejects any caller whose `global_role !== 'facilitator'` with no `application_admin` branch. TOPIC-004 does not copy that check as-is. Instead it uses the same model as TOPIC-002 (Decision 9, below) — `global_role = 'facilitator'` AND not an active member of the target team, OR `global_role = 'application_admin'`.

**Placement and shape of the shared function, corrected per Marcus Oyelaran's engineer review (Finding 1, BLOCKING):** the design as originally drafted left this function's file unspecified, and the obvious placements are both wrong. Putting it in `topics.ts` and exporting it for `content.ts` to import would make one route file depend on another — nothing else in this codebase does that (`content.ts` imports from `auth/team-content-access-helper.ts`, never from `topics.ts`), and it would make TOPIC-002 depend on `topics.ts` loading correctly, an implicit coupling between two features meant to be independently reviewable. Giving it the same reply-writing shape as `checkStandingFacilitatorAuthorization` (TOPIC-003's private, single-caller function) would also require it to hardcode response text serving two callers with genuinely different semantics — TOPIC-002 is a read ("view this team's topics"), TOPIC-004 is a destructive write ("archive a topic for this team") — and nothing in this design supplies wording that works for both.

The engineer review's fix is adopted as stated: the shared piece is **decision-only**, added to `packages/backend/src/auth/standing-facilitator-access-helper.ts` alongside `evaluateStandingFacilitatorAccess` (not a new file — it composes that helper's fact-only result into a policy decision, the same relationship `checkStandingFacilitatorAuthorization` already has to it, just relocated to `auth/` since this one has two callers instead of one). It takes no `FastifyReply` and writes no message text:

```typescript
type StandingFacilitatorOrAdminDecision =
  | { authorized: true; actorGlobalRole: string }
  | { authorized: false; reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER" };

export async function checkStandingFacilitatorOrAdminAuthorization(
  userId: string,
  teamId: string,
): Promise<StandingFacilitatorOrAdminDecision>
```

`topics.ts`'s TOPIC-004 handler and `content.ts`'s TOPIC-002 handler each call this function, then each writes its own `reply.code(403).send(...)` with endpoint-appropriate message text, keyed off `reason` — exactly mirroring how `checkStandingFacilitatorAuthorization` already wraps `evaluateStandingFacilitatorAccess` today, just with the wrapper's reply-writing half now living per-caller instead of inside a single function. Because the function itself does not touch `reply`, it also does not call `applyTimingFloor` — **each caller remains responsible for calling `applyTimingFloor(startTime)` immediately before sending its own `403`, on every early return this check produces.** This is stated explicitly, not left implicit: Decision 2's amendment (below) already requires this for every early return in TOPIC-004's cascade, including this one; Decision 9 (below) states the identical requirement for TOPIC-002, which does not get a narrower timing obligation just because its authorization check now lives in a shared function. The fact-only `evaluateStandingFacilitatorAccess` helper itself (returns `{ globalRole, isMember }`, no policy decision) is unchanged and still called by this new function, exactly as it is by TOPIC-003's existing wrapper today.

**Why:** FR-8.2 [HARD] requires that "the facilitator or Application Administrator shall be able to add, remove, or reorder topics" for a team. Marcus Delgado's BA review of this proposal (Finding 1, BLOCKING) found that reusing TOPIC-003's check verbatim — as originally drafted here — would ship TOPIC-004 with no `application_admin` branch at all, and that this is worse than a quietly-inherited gap: this same change already grants `application_admin` access to TOPIC-002 (Decision 9), the paired read endpoint that powers the new Topic Management screen's topic list. An admin would see that screen render normally, including a "Remove" affordance per row (Decision 10 does not gate the button on caller role beyond ordinary screen access), and then receive a confusing `403` the moment they click it — a concrete, shippable UX bug this exact change would introduce, not a latent gap sitting in code nobody exercises yet.

This does not change TOPIC-003's authorization model. TOPIC-003 (Add Custom Topic, #49/#50) keeps its existing facilitator-only check exactly as shipped — see Non-Goals. Extending TOPIC-003 to also admit `application_admin` would close the identical FR-8.2 gap for the add-path, but that is already-shipped, already-deployed code with its own review and deploy considerations; folding it into a design document scoped to archive, not add, would be exactly the kind of silent bundling this project has otherwise been careful to avoid. It is deliberately deferred, stated on the record, not silently skipped.

**Alternatives considered:**
- *Reuse TOPIC-003's `checkStandingFacilitatorAuthorization` verbatim, as originally drafted.* Rejected — ships the FR-8.2 violation and the admin-sees-Remove-then-403 UX bug described above, into a screen this change is building for the first time.
- *Also fix TOPIC-003's identical gap in this same change.* Rejected — TOPIC-003 is shipped, deployed code; widening its authorization is a separate change with its own review and rollout considerations, not something to bundle silently into a "remove topic" design. Called out explicitly in Non-Goals rather than left undecided.
- *Implement the shared function in `topics.ts`, exported for `content.ts` to import.* Rejected per the engineer review — no route file in this codebase imports from another route file, and it would make TOPIC-002 (`content.ts`) implicitly depend on `topics.ts` loading correctly.
- *Give the shared function the same `reply`-writing, message-owning shape as `checkStandingFacilitatorAuthorization`.* Rejected — TOPIC-002 and TOPIC-004 need different rejection wording (a read vs. a destructive write) and this design has no single message that serves both correctly; a decision-only function that returns a `reason` and lets each caller write its own message is the shape the codebase already uses everywhere else this split occurs.

### Decision 2 — Full check-ordering cascade for TOPIC-004

**Decision:** TOPIC-004 evaluates checks in exactly this order, short-circuiting on the first failure:

1. Identity/role authorization — `global_role = 'facilitator'` AND not an active member of the target team, OR `global_role = 'application_admin'` (Decision 1, above, extended from the sibling design's Decision 3 to admit `application_admin` per FR-8.2). Failure → `403 Forbidden`.
2. Team existence. Failure → `404 Not Found` (`TEAM_NOT_FOUND`).
3. Customization lock (`hasCompletedFirstSession`). Failure → `409 Conflict` (`TOPIC_CUSTOMIZATION_LOCKED`) — audited via `writeLockDenialAudit`, same as TOPIC-003.
4. Topic existence and ownership — `topicId` refers to a row in `topics` with `team_id = :teamId`. Failure → `404 Not Found` (`TOPIC_NOT_FOUND`).
5. Topic status — the topic is currently `active`. Failure → `422 Unprocessable Entity` (`TOPIC_ALREADY_ARCHIVED`).
6. Last-active-topic guard (Decision 3, below). Failure → `409 Conflict` (`TOPIC_LAST_ACTIVE`).
7. Open-action-item check (Decision 5, below): if the topic has open action items and the request does not carry `confirm=true`, respond `200 OK` with `requiresConfirmation: true` (not a failure — nothing is rejected).
8. Success: transition to `archived`, `200 OK`.

**Why:** This extends the sibling design's Decision 9 cascade (`403` → `404` → `409` → `422`) by inserting the two checks TOPIC-004 needs that TOPIC-003 didn't: topic-specific existence and topic-specific status. The same leak-prevention principle Decision 9 already established governs their placement — a check that reveals nothing about a *specific team* runs before one that does, and a check that reveals nothing about a *specific topic* runs before one that does. Team existence (step 2) and the team-scoped lock (step 3) both precede any topic-specific check, so a caller who fails identity/role or targets a locked team never learns whether a given `topicId` exists or what state it's in — the same reasoning Devon's exploration notes already landed on (§6: "a caller who was never going to be allowed to write at all shouldn't learn anything about the topic's specific state first").

Within the topic-specific checks, existence (step 4) precedes status (step 5) for the same reason team existence precedes the lock: you cannot meaningfully ask "is this topic already archived" about a topic that isn't this team's. Status (step 5) precedes the last-active-topic guard (step 6) because the guard's own query ("would archiving this topic leave zero active topics") only makes sense against a topic confirmed to be currently active — running it against an already-archived topic would be answering a question about a state transition that was never going to happen anyway, one more instance of a topic-specific check revealing more than the caller has earned the right to know yet. The last-active-topic guard (step 6, an unconditional hard block) precedes the open-action-item check (step 7, a resumable one-more-request warning) because there is no reason to tell a caller how many open action items would be orphaned by an archive that is never going to be allowed to happen regardless — the harder, unresumable failure is checked first, same ordering logic as `403` before `422` in the sibling cascade.

**Alternatives considered:**
- *Check the last-active-topic guard before topic status.* Rejected — the guard's query is meaningless against a topic that might already be archived; status must be confirmed `active` first.
- *Check open action items before the last-active-topic guard.* Rejected — surfaces the action-item count for an archive that was never going to succeed, an unnecessary information disclosure with no benefit, and (per Devon's exploration notes) the harder failure should be checked first.

**Amended, applying the sibling design's Decision 9 timing-floor requirement:** every early-return in this cascade — steps 1 through 6's failures, and both `200` outcomes in steps 7–8 — calls `applyTimingFloor(startTime)` immediately before responding, with no branch exempted. This is the same requirement TOPIC-003 already implements; TOPIC-004 does not get a narrower version of it just because it has two more branches.

### Decision 3 — Last-active-topic guard: hard `409`, serialized against concurrent archive requests via the same per-team advisory lock TOPIC-003 already uses

**Decision:** Before transitioning a topic to `archived`, the handler checks whether the team has more than one currently-active topic. If archiving this topic would leave zero active topics for the team, the request is rejected with `409 Conflict` (`TOPIC_LAST_ACTIVE`, a new reason code) and the topic is not modified. This check and the archive transition itself run inside the same transaction, guarded by `pg_advisory_xact_lock(hashtext(teamId))` — the identical mechanism the sibling design's Decision 10 introduced for `POST /topics`'s `displayOrder` race, taken before the active-topic count is read:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($1::text));  -- $1 = teamId

SELECT COUNT(*) AS active_count FROM topics WHERE team_id = $1 AND status = 'active';
-- if active_count <= 1: ROLLBACK, return 409 TOPIC_LAST_ACTIVE

UPDATE topics SET status = 'archived', archived_at = now(), archived_by = $2
WHERE id = $3 AND team_id = $1 AND status = 'active';

COMMIT;
```

**Why — the guard itself:** stated as a hard block, not a soft warning, per Priya Nair's facilitator review: a warning a facilitator can click past while tidying up topics between sessions is a warning that will be clicked past, and the moment that actually costs something is standing in front of a team at session start with zero topics configured — the worst possible place for a rough edge to surface. Priya's and Marcus's independent reviews reached this conclusion from two different directions (facilitator workflow risk and a concrete crash finding, respectively), and Devon's exploration notes revised their original soft-warning lean to agree. This design carries that revision forward as the decision, not as an open question.

**Why — the advisory lock:** without it, two concurrent `DELETE` requests against two different topics of a team with exactly two active topics could each independently read `active_count = 2`, both conclude "not the last one," and both proceed — leaving zero active topics despite the guard, the identical race shape the sibling design's Decision 10 closed for `displayOrder` collisions. Reusing `pg_advisory_xact_lock(hashtext(teamId))` serializes both the count-read and the write per team, with no risk of leaking the lock past the request (released automatically on `COMMIT`/`ROLLBACK`) and no added contention between requests targeting different teams.

**Alternatives considered:**
- *Soft warning at removal time, defer the actual constraint to session start (Devon's original lean).* Rejected, superseded by both SME reviews (see "Why," above) and by Marcus's finding that session start's current handling of zero-active-topics is an unhandled crash, not a safe fallback (Decision 8).
- *`SELECT ... FOR UPDATE` on the active topics instead of an advisory lock.* Rejected for the same MVCC reason the sibling design's Decision 10 rejected it for the insert case: `FOR UPDATE` only re-verifies rows already in its snapshot; it does not correctly serialize a second transaction's fresh `COUNT(*)` against a first transaction's not-yet-committed archive.

### Decision 4 — TOPIC-004's `403` error-table text is corrected to match Decision 2's split; a new `409` reason code is added

**Decision:** `REST API Contract.md:786`, TOPIC-004's `403` row, currently reads "Not a facilitator, is a team member, customization lock active" — folding the lock (a state precondition) into `403` the same way TOPIC-003's error table did before the sibling design's Decision 2 corrected it. This is corrected: `403` covers only `NOT_A_FACILITATOR`/`FACILITATOR_IS_TEAM_MEMBER`; the lock is `409` (`TOPIC_CUSTOMIZATION_LOCKED`, already the shape TOPIC-003 uses); a new `409` row is added for `TOPIC_LAST_ACTIVE` (Decision 3); the `404` row is split into `TEAM_NOT_FOUND`/`TOPIC_NOT_FOUND`.

**Why:** Leaving TOPIC-004's error table as originally drafted would mean the *implemented* behavior (409 for lock, per Decision 2's established precedent, which this design is not re-litigating) contradicts the *documented* behavior for the same endpoint — silently diverging from a document this project has consistently chosen to correct on the record instead (the same move already made for TOPIC-003's `403`/`409` split and for TOPIC-002 in Decision 9, below).

**Alternatives considered:** *Ship the contract's literal `403`-for-everything text.* Rejected for the same reason Decision 2 of the sibling design rejected it: this was never independently reviewed as its own line item, so it is a gap in the contract, not a stable answer this design would be overriding.

### Decision 5 — Open-action-item check: a new reusable helper, and the confirmation response is extended with an inline drill-down list, not just a count

**Decision:** A new function, `getOpenActionItemsForTopic(topicId): Promise<Array<{ actionItemId: string; description: string }>>`, co-located with `topic-lock-helper.ts`'s pattern (one exported function, documented as intended for reuse by TOPIC-005/006/007 later), runs:

```sql
SELECT ai.id, ai.description
FROM action_items ai
JOIN session_topics st ON st.id = ai.session_topic_id
WHERE st.topic_id = $1 AND ai.status = 'open'
ORDER BY ai.created_at ASC
```

TOPIC-004's `ArchiveTopicConfirmationRequired` response is extended beyond the drafted contract's `openActionItemCount: number` to also carry the list itself:

```typescript
interface ArchiveTopicConfirmationRequired {
  requiresConfirmation: true;
  reason: 'openActionItems';
  openActionItemCount: number;
  openActionItems: Array<{ actionItemId: string; description: string }>;
  message: string;
}
```

On the confirming request (`confirm=true`), the handler re-runs this same query and re-derives the count independently — the `confirm=true` flag is never treated as "the caller's previously-displayed count was correct," only as "the caller acknowledged some past warning." A stale count from an earlier response is never trusted.

**The re-derived count is written into the success audit row, so the re-derivation is observable — corrected per Marcus Oyelaran's engineer review (Finding 2):** as originally drafted, the `confirm=true` re-query ran inside the advisory-lock-held transaction but gated nothing (the topic's eligibility to archive is already fully re-verified by the cascade's other steps, which run unconditionally) and its result was written nowhere — dead work extending a lock's critical section for no observable effect, and, per the review, indistinguishable from a bug to the next engineer who reads it. This is corrected by making the re-derivation's result part of the record it already sits next to: Task 5.1's helper call (the zero-confirm path) and Task 5.2's helper call (the `confirm=true` path) both feed their result into Decision 7's success audit row — `topic.archived`'s `metadata` is extended from `{ topic_id }` to `{ topic_id, openActionItemCount }`, where `openActionItemCount` is whatever the applicable helper call most recently returned (0 for a topic with no open items, the freshly re-derived count for a `confirm=true` archive). This costs one field in a JSONB column the same transaction is already writing, and it turns "we re-checked, trust us" into an actual record of what was open at the moment a facilitator archived over a warning.

**Why — the helper:** `action_items.session_topic_id` is a nullable FK to `session_topics`, itself keyed by `topic_id` — "does this topic have open action items" means joining across every session the topic has ever appeared in, not just the most recent one. This is new work, not reuse of anything TOPIC-003 already built, and Marcus's BA review specifically asked that it become a named, reusable helper now rather than inlined and extracted later once TOPIC-005/006/007 need something adjacent.

**Why — the drill-down list, extending the drafted contract:** both SME reviews independently flagged that a bare count doesn't give a facilitator running several teams enough to act on ("is N=3 stale noise or live commitments? I don't have them memorized" — Priya's review). The line drawn is deliberately narrow: `description` only, no navigation away from the dialog, no action-item editing surface — enough to recognize what's at stake, not a second feature. This is a stated extension of TOPIC-004's drafted response shape, not a silent deviation from it.

**Why — server-side re-derivation on `confirm=true`:** a page reload or a navigate-away-and-back between the first and second `DELETE` must not let a stale, client-held count silently confirm an archive against a *different*, current set of open items than what was actually shown — the same trust boundary this design already applies everywhere else (never let the client assert a fact the server can cheaply re-verify).

**Alternatives considered:**
- *Ship the contract's literal `openActionItemCount`-only shape, no drill-down.* Rejected per both SME reviews — a bare number doesn't let a facilitator make the judgment call the warning exists to support.
- *Trust a client-supplied `confirm=true&expectedCount=N` and skip re-deriving.* Rejected — reopens exactly the staleness gap Marcus's BA review flagged; the server re-deriving the check is no more expensive than the first request's check and removes an entire class of "confirmed against stale data" bug.

### Decision 6 — Facilitator-visible provenance: a new `archived_by` column, not an audit-log read path

**Decision:** `topics` gains a new nullable column, `archived_by uuid NULL REFERENCES users(id)`, set in the same transaction as the archive `UPDATE` (Decision 3's SQL block, above). TOPIC-002's `archived` array is extended beyond the drafted contract to include this provenance:

```typescript
archived: Array<{
  topicId: string;
  name: string;
  prompt: string;
  voteType: 'finger' | 'roman' | 'modified_roman';
  isDefault: boolean;
  archivedAt: string;
  archivedBy: { userId: string; displayName: string } | null;  // null only for pre-existing rows archived before this column existed — none exist today
}>;
```

`archivedBy` is populated via a join to `users.display_name` in the TOPIC-002 handler, not a second round trip.

**Why:** Devon's exploration notes proposed surfacing this from the `topic.archived` audit event, reasoning "no new capture needed, just surfacing it." That doesn't hold up under implementation: `audit_log.metadata` is an unindexed JSONB blob, and building a product-facing read path (TOPIC-002, called every time a facilitator opens the Topic Management screen) against the audit log's storage shape and retention policy is the wrong architectural boundary — the audit log exists for post-incident review, and this codebase already models "who/when a state transition happened" as first-class table columns when the fact is product-relevant, not audit-only (`action_items.resolved_in_session_id`, `action_items.resolution_note` are the direct precedent: neither is left to an audit-log join). A dedicated column is one small additive migration, needs no backfill (no topic has ever been archived — this is the first endpoint that can produce that state), and gives TOPIC-002 a plain indexed join instead of a JSONB scan.

Priya's facilitator review is the direct source of this requirement: under the standing, org-wide facilitator model, she inherits teams without a handoff conversation, and "the topic is just gone" with no visible provenance is a continuity regression from the spreadsheet-and-memory era the application replaces. The audit trail technically having this data somewhere doesn't answer her question in the place she'd actually look.

**Alternatives considered:**
- *Read `topic.archived` audit events at TOPIC-002 request time, matched by `team_id` + `metadata->>'topic_id'`.* Rejected — no supporting index exists, couples a product-facing screen's load time to the audit log's retention policy (if audit rows are ever pruned or archived to cold storage on a different schedule than product data, provenance silently disappears from the UI), and duplicates work an indexed column does for free.
- *No provenance, audit log only.* Rejected — this is the exact gap both the facilitator review and Devon's own persona concerns (§7 of the exploration notes: "a facilitator hitting a wall of 'topic's gone, ask around' is the same failure mode as a team needing to ask Devon Calloway what a topic means") name directly.

**The disclosure boundary this creates is a considered decision, stated on the record per Tomás Ferreira's security review (Finding 2):** under Decision 9's standing, org-wide model, `archivedBy` surfaces a specific named colleague's identity to every facilitator or `application_admin` in the organization who is not an active member of the target team — a population with, by construction, no prior relationship to that team or to the archiving facilitator. This is a different disclosure shape from anything else this feature area ships: TOPIC-001/002/003 disclose topic *content* (prompts, vote types) to the same broad population, which is defensible because topic content isn't personal data about an individual; `MemberManagement.tsx` discloses member names, but only to a team's own facilitator, about that team's own members — a relationship-gated disclosure, not an org-wide one. `archivedBy` is accepted as a considered choice, not left as an emergent side effect of composing Decision 6 with Decision 9, for two reasons: (1) facilitator display names are not treated as sensitive data within the facilitator population generally — they are already visible org-wide in other bounded contexts (e.g., any facilitator's name is discoverable via team membership screens today) — and (2) the standing facilitator model this change extends already treats every standing facilitator as trusted with *any* team's topic configuration, including the ability to read that team's full topic list and archive from it; a name identifying which already-trusted facilitator took an already-visible action is a strict subset of what TOPIC-002 discloses about the action itself. If either premise stops holding — if display names are ever reclassified as sensitive, or if the standing model is narrowed — this disclosure should be revisited alongside it, not independently.

**Addendum (implementation-review-security.md):** TOPIC-002's response also adds `teamName: string` at the top level (implementation deviation, ratified by implementation-review-architect.md) — a new disclosure this decision should name explicitly rather than leave to an inline code comment. Before this change, a non-member standing facilitator had no endpoint returning a team's display name (`teams.ts`'s GET endpoints all gate on membership, not the standing model). This is accepted on the same footing as `archivedBy`: it is a strict subset of what the standing model already discloses to this caller (the full topic list and content of a team they are, by design, trusted to read and archive from), it is not personal data about an individual, and it exists to satisfy the confirmation dialog naming both the topic and the team (Decision 10) so a facilitator managing multiple teams cannot mis-click against the wrong one.

### Decision 7 — Audit posture: `topic.archived` on success, reusing `topic.write_denied_locked` on denial

**Decision:** A successful archive writes an `audit_log` row (`operation = 'topic.archived'`) inside the same transaction as the `UPDATE`, carrying `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata: { topic_id, openActionItemCount }` — the second field per Decision 5's correction, above, so the open-action-item re-derivation that already ran in this transaction leaves an observable record rather than being computed and discarded. `topic.archived` is added to `AuditEventName`'s union in `audit-logger.ts` alongside the existing `topic.write_denied_locked`/`topic.custom_added` entries. Every denial branch in Decision 2's cascade that involves the lock (step 3) reuses `writeLockDenialAudit` and the existing `topic.write_denied_locked` operation name — no new per-endpoint audit-event variant, matching the sibling design's own note that this name is shared across every topic-write endpoint the lock gates.

**Why:** matches the sibling design's Decision 8 amendment exactly — a standing, org-wide facilitator model means "who did this" isn't answerable without an audit row, and that already mattered enough to fix for the add-path. It matters at least as much for the archive-path, arguably more, since removal is more consequential to a team's data continuity than addition (the same reasoning the exploration notes already state in §6).

**Why the `TOPIC_LAST_ACTIVE` denial (Decision 3, step 6) is not audited — stated explicitly per Tomás Ferreira's security review (Finding 3):** this design's cascade audits exactly one denial branch, the lock (step 3), and none of the others — `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`, `TEAM_NOT_FOUND`, `TOPIC_NOT_FOUND`, `TOPIC_ALREADY_ARCHIVED`, and `TOPIC_LAST_ACTIVE` all reject without writing a row, consistent with TOPIC-003's existing convention that identity/role and state-precondition failures aren't audited, only the lock is. `TOPIC_LAST_ACTIVE` is worth naming separately from the others in that group because, unlike `TOPIC_NOT_FOUND` or `TOPIC_ALREADY_ARCHIVED` (caller mistakes against already-settled state), it is a rejection of an attempt to *change team state against a hard data-integrity rule*, reachable by the same wide, org-wide caller population the lock-denial audit already exists to cover. The reason this design still leaves it unaudited is scope discipline, not an oversight: adding an audited event for every state-precondition failure in this cascade would be a materially larger expansion than this change's Goals call for, and `TOPIC_LAST_ACTIVE` is not distinguished from `TOPIC_ALREADY_ARCHIVED` by anything this endpoint's own contract treats differently — both are `4xx` state-precondition rejections with no side effect. If repeated, scripted attempts to strip a team down to its last topic become an observed real-world concern, adding an audited event here is a small, additive follow-up; this change does not pre-build it speculatively.

**Rate limiting on the denial path — confirmed resolved, not silently inherited, per Tomás Ferreira's security review (Finding 4):** Task 11.3 states that this change's denial- and success-path audit writes carry no rate limiter or `withTimeout`/`AUDIT_WRITE_TIMEOUT_MS` guard, "matching the sibling change's Decision 13 precedent." Checked against the sibling design's own text: Decision 13 of `openspec/changes/archive/2026-09-29-topic-customization-lock-and-add-custom-topic/design.md` is a stated, resolved decision — not an open question left dangling — accepting the flood/growth risk explicitly, on the record, for the identical org-wide caller population and identical unguarded-`db.query` audit-write shape this change reuses. TOPIC-004 adds `application_admin` on top of that population (Decision 1) and the last-active-topic guard (Decision 3) is a second synchronous, unguarded write reachable by it, but neither changes the abuse ceiling Decision 13's reasoning turns on (`audit_log` growth and DB load, not privilege escalation or disclosure — the same category of cost the codebase already accepts for `TEAM-005`'s narrower precedent). This change inherits Decision 13's resolution, not its open question — there is no unresolved rate-limit question being carried forward silently.

**Alternatives considered:** *A new `topic.write_denied_locked_archive` variant, distinguishing the add-path denial from the archive-path denial.* Rejected — the existing operation name is already documented as endpoint-agnostic (distinguished by `metadata.endpoint`, not by a per-endpoint operation name), and TOPIC-004 has no reason to be the first endpoint to break that convention.

### Decision 8 — `facilitator-sessions.ts`'s begin-voting handler: replace the unhandled throw with a clean validation error, scoped narrowly to the crash itself

**Decision:** The `throw new Error(...)` at `facilitator-sessions.ts:1195` (fired when no `session_topics` row exists at `display_order = 1` for the session) is replaced with a clean `409` response, following this same file's existing local error-shape convention (`{ error: { category, message, correlationId } }`, no `code` field — matching the adjacent session-status check at lines 1155-1163, not `topics.ts`'s `code`-bearing envelope, since this fix lives in a file that already has its own established local convention for this class of check):

```typescript
if (firstTopicResult.rows.length === 0) {
  return reply.code(409).send({
    error: {
      category: "invalid_request" as const,
      message: "This session has no topics configured and cannot begin voting.",
      correlationId: crypto.randomUUID(),
    },
  });
}
```

**Scope note, stated on the record (Context, above):** this change does not attempt to fix or explain why `session_topics` might be empty at this point — that could be the last-active-topic guard's absence in a hypothetical world without Decision 3 (now closed), or it could be the broader, pre-existing gap this design found while reading this file: no shipped endpoint currently populates `session_topics` at session creation, despite `session-topic-lifecycle`'s spec asserting that it does. This fix closes the *crash*, unconditionally, for whatever reason the precondition fails. It does not close the *broader gap*, which is a separately-scoped problem this change did not create and whose fix (implementing `session_topics` population at `SESSION-001`) is out of this change's Non-Goals.

**Why both halves of this decision matter:** Marcus's BA review specifically asked that this change not ship "no removal-time block *and* no session-start fix" as a default — that's satisfied by Decision 3 (the block) and this decision (the fix) both landing here. But scoping this decision to "fix the crash, don't solve the deeper gap" is equally deliberate: attempting to also build `session_topics` population inside a change proposed as "remove-topic" would be a materially larger, differently-scoped undertaking than #51 was filed to do, and would risk never shipping either half cleanly.

**Alternatives considered:**
- *Defer this fix to a follow-up issue, ship only the removal-time block.* Rejected — this is exactly the "unhandled throw nobody's hit yet" risk Devon's exploration notes and Marcus's review both argue against; the fix is small and sits next to code this change already touches.
- *Also implement `session_topics` snapshot-at-creation in this change, since it's adjacent.* Rejected — out of scope; a materially larger change than #51, better scoped and reviewed on its own terms as its own issue.

### Decision 9 — TOPIC-002's authorization corrected to the standing, org-wide facilitator model; the `403` error-table text corrected in the same change

**Decision:** `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002), implemented in `content.ts` alongside the existing TOPIC-001 handler and reusing `evaluateStandingFacilitatorAccess` (the same fact-only helper TOPIC-003/004 use, not `content.ts`'s existing `evaluateTeamAccess`), requires: `global_role = 'facilitator'` AND not an active member of the team, OR `global_role = 'application_admin'` — via the same shared, decision-only `checkStandingFacilitatorOrAdminAuthorization` function TOPIC-004 uses (Decision 1, above), not TOPIC-001's session-scoped model. `REST API Contract.md:609`'s `Authorization` line and `:658`'s `403` error-table text ("Authenticated user is not a facilitator with an active session for this team, and is not an `application_admin`") are corrected together, in the same edit — the two cannot be fixed independently of each other without leaving the contract internally contradictory for one edit cycle.

**Timing floor, stated explicitly for TOPIC-002 — per Tomás Ferreira's security review (Finding 1):** because `checkStandingFacilitatorOrAdminAuthorization` is decision-only (Decision 1, above) and does not touch `reply` or call `applyTimingFloor` itself, TOPIC-002's `content.ts` handler is responsible for calling `applyTimingFloor(startTime)` immediately before sending its own `403 Forbidden` on either `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER` — with no branch exempted, the same requirement Decision 2's amendment states for TOPIC-004. This is stated here as its own requirement, not left as a single incidental mention in a verification checklist line, because `content.ts` is not a blank file the way `topics.ts` was when the sibling review first raised this gap: it already contains `denyNullGrant`, which embeds `applyTimingFloor` inside itself specifically so every null-grant path has one consistent call site, and TOPIC-001's handler, which calls the floor on every branch including its admin-denial branch. TOPIC-002 sits in the same file next to that precedent and does not get a narrower timing obligation just because its authorization check moved into a shared function.

**Why:** carried forward from the exploration notes and strengthened by Marcus's BA review's independent verification: this is not "the matrix vs. the endpoint text" (an appeal-to-authority framing), it's that TOPIC-003 through TOPIC-007 share one authorization model word-for-word, five endpoints in a row, and TOPIC-002 alone sits in the middle of that block using a different one — a one-of-six outlier, not a two-way disagreement to referee. The sibling design's Decision 12 is real and deliberate, but it is about TOPIC-001 specifically (zero mentions of TOPIC-002 anywhere in that design's 13 decisions) — this design is not reversing anything Decision 12 settled. And unlike widening TOPIC-001 (which Decision 12 correctly declined, citing `evaluateTeamAccess`'s use across six other files), TOPIC-002 is greenfield: no shipped handler, no existing caller, nothing to break. This also isn't optional scope invented by this change — TOPIC-002 is "used exclusively by the topic management/configuration screen" per its own contract description, and this change is the first one that ships that screen. A facilitator cannot browse a team's topics to pick one to archive if the read endpoint powering that screen only grants access to a facilitator currently running a session for that team.

**Placement, following Decision 5 of the sibling design's reasoning:** TOPIC-002 is added to `content.ts`, not `topics.ts`, despite using `topics.ts`'s authorization helper — it is a read endpoint, and `content.ts` is this codebase's established home for team-content reads (including TOPIC-001, already there). The helper being shared across files is not a reason to relocate the handler; `evaluateStandingFacilitatorAccess` already has two callers in `topics.ts` (TOPIC-003, TOPIC-004) and gains a third in `content.ts` with no code duplication.

**Alternatives considered:**
- *Leave TOPIC-002 as drafted (session-scoped), and have the frontend call TOPIC-001 instead for the management screen's list.* Rejected — TOPIC-001 is active-topics-only; the management screen needs the archived list too (Decision 6's provenance, Re-Add's future needs), and TOPIC-001's own contract description scopes it to a different purpose. Substituting endpoints to route around a contradiction in the correct one is a worse outcome than fixing the contradiction.
- *Treat this as new scope requiring separate sign-off, out of scope for #51.* Rejected — per the exploration notes and BA review, this was never a considered decision to begin with, just an unnoticed drafting error; fixing it here is lower-risk than building a screen against a broken read endpoint and discovering the break during frontend implementation.

### Decision 10 — Frontend: minimal Topic Management screen, matching `MemberManagement.tsx`'s existing two-step confirmation pattern

**Decision:** A new route (`/team/:teamId/topics`), `ProtectedRoute`-gated per `App.tsx`'s existing pattern (server-side dual authorization, page component renders a 403 state on denial — no new client-side gating primitive). The screen has two sections: an active topic list (prompt, vote type, description per row, matching View Active Topic Configuration's existing acceptance criteria — not a stripped-down name list) with a "Remove" action per row, and an archived-topics list showing `archivedAt`/`archivedBy` per Decision 6.

The confirmation flow is built as local component state, following the exact shape `MemberManagement.tsx` already establishes for its own two-step confirm/re-submit flow (`RoleChangeState`'s `awaiting_confirmation` → re-submit-with-flag → `confirmed` states) — not a new shared `Modal`/`ConfirmDialog` component, since none exists anywhere in `packages/frontend/src/components` today and this is the only consumer. Concretely:
1. Click "Remove" → always show a dialog: `"Archive '{topic.name}' for {team.name}?"` with the always-true retention line ("This topic's historical data will be retained and stays visible in trend views.") — no API call needed, since this is always true.
2. Confirm → `DELETE .../topics/:topicId`. On `200 { status: 'archived' }`, close the dialog, refresh the list. On `200 { requiresConfirmation: true, openActionItemCount, openActionItems, message }`, the *same* dialog replaces its content in place (not a second dialog appended below) with the specific warning — one interpolated copy string, e.g. `` `${count} open action item${count === 1 ? '' : 's'} will stay open, but nothing will remind anyone about them going forward.` ``, plus an inline, view-only, non-navigating list of `openActionItems[].description` — and a second "Archive anyway" confirm.
3. Second confirm → `DELETE .../topics/:topicId?confirm=true`.

**Why:** Priya's review named both the team-and-topic-named copy and the "escalate in place, not append" behavior as things that needed to be a stated choice, not left to whoever writes the component — both are stated here. `MemberManagement.tsx` already solves the identical shape of problem (a write that might come back `200`/`422` with `requiresConfirmation`, requiring a second confirmed request) for a different resource; reusing its pattern rather than inventing a new one is the same "match the existing inline-state pattern, don't introduce a generic modal system for one consumer" call the exploration notes already made.

**Nav entry point:** a "Topics" tab/link is added to `TeamPage.tsx` alongside the existing `MemberManagement` render — both reviews escalated this from "worth a decision" to "this issue can't ship without it," and Priya's framing is adopted directly: a screen nobody can navigate to isn't a shipped feature, particularly for a facilitator who inherits a team without a handoff conversation and has no other way to discover it exists.

**Alternatives considered:**
- *Build a shared `ConfirmDialog` component now, anticipating TOPIC-005/006/007's own confirmation needs later.* Rejected — no second consumer exists yet; extracting a shared component before a second real use case shows up is exactly the premature abstraction the exploration notes' §8 chrome-creep concern warns against. `MemberManagement.tsx`'s own precedent is itself inline, not extracted, despite predating this change.
- *A separate route/page for the archived-topics list.* Rejected — Priya's continuity concern is best served by provenance being visible in the same place a facilitator is already looking when deciding what to remove or whether something's missing, not a second screen to remember to check.

## Risks / Trade-offs

- **[Risk]** TOPIC-002's authorization correction is a behavior change to a documented contract clause. → **Mitigation:** the endpoint is unbuilt today (Decision 9) — there is no shipped caller to break, and the correction is implemented as the endpoint's first version, not a later widening of running code.
- **[Risk]** The `archived_by` column (Decision 6) requires a schema migration, unlike the sibling change. → **Mitigation:** additive, nullable, no backfill needed (no topic has ever been archived; this is the first endpoint that can produce that state).
- **[Risk]** Two concurrent archive requests against a team's last two active topics could both succeed absent the advisory lock. → **Mitigation:** Decision 3 reuses the sibling design's `pg_advisory_xact_lock` pattern, already proven for the identical race shape.
- **[Risk]** A stale client tab could archive a topic against a since-changed open-action-item set. → **Mitigation:** Decision 5's server-side re-derivation on `confirm=true` — the client's displayed count is never trusted.
- **[Risk]** Fixing `facilitator-sessions.ts`'s crash (Decision 8) could be read as "session start is now fully hardened against zero-topic states." → **Mitigation, stated on the record:** it is not — the deeper gap (no shipped `session_topics` population mechanism at all) remains, named explicitly in Context and in Decision 8's scope note, and is not solved by this change.
- **[Trade-off]** No real-time update when a topic is archived by a different facilitator viewing the same team concurrently. → Accepted, matching the sibling design's Decision 7 reasoning (no real-time unlock push) — next navigation or reload picks up the change.

## Migration Plan

One additive migration: `topics.archived_by uuid NULL REFERENCES users(id)`. No backfill (every existing `topics` row has `status = 'active'`, `archived_at = NULL` — no shipped endpoint has ever archived a topic). No feature flag — enforcement (the last-active-topic block, the corrected TOPIC-002 authorization) is unconditional from the moment this ships, consistent with the standing position that protective, data-integrity-adjacent constraints are not configurable. Rollback is a plain code revert; the migration is additive and does not need to be reverted for a code-only rollback (an unused nullable column is harmless), though a full rollback may drop it for cleanliness.

## Open Questions

1. **Whether `openActionItems`' drill-down list (Decision 5) needs a length cap or pagination for a topic with an unusually large number of open items.** Not addressed here — action items are expected to be a small list in practice, and no requirement asks for a cap. Worth confirming empirically rather than guessing at a limit now.

**Resolved, not left as an Open Question:** the `session_topics` snapshot-at-creation gap found in Context — every session created today has no `session_topics` rows until some other, unbuilt mechanism populates them, so `SESSION-004`/begin-voting cannot succeed for *any* session today, independent of anything in this change (verified independently by Marcus Delgado's BA review and Rachel Okonkwo's executive review). This is not this change's job to fix (Decision 8's scope note stands), and it is total and pre-existing, not scoped to a rare edge case — a severity that does not belong sitting only as a footnote in a design doc. Per Rachel's review, this is being filed as its own tracked GitHub issue, sized and prioritized on its own terms and referencing this design doc for context, rather than left to be rediscovered (tasks.md 12.1).
