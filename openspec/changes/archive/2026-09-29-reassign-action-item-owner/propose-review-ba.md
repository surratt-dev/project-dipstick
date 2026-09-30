# BA Review — Proposal Stage: `reassign-action-item-owner` (#108, VOTE-004)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `tasks.md`, `specs/action-item-owner-reassignment/spec.md`, `specs/action-item-status-management/spec.md` (this change)
**Grounded against:** `requirements/design/REST API Contract.md` (VOTE-004, VOTE-002), `requirements/use cases/07 - Action Item Management - Use Cases.md` ("Reassign an Action Item When an Owner Leaves the Team," "Update Action Item Status"), `packages/backend/src/routes/action-items.ts`, `packages/backend/migrations/2_create_tables.sql`, `packages/backend/src/auth/audit-logger.ts`

---

## Overall read

This is, capability-for-capability, the most buildable set of artifacts I've reviewed on this project. `specs/action-item-owner-reassignment/spec.md` states every check as a SHALL, gives each an ordered position in the cascade, and backs it with a Given/When/Ten scenario — including the two negative-space scenarios (`404` vs `403` enumeration, `409` vs new-owner-cascade precedence) that are exactly the kind of thing that gets left implicit elsewhere. Everything my explore-stage review (`explore-review-ba.md`) asked to become "a stated decision, not a lean" — the `sessionId` reuse of D11, the same-owner no-op, the check ordering, the `action_item_history` invariant, the contract correction note — landed as a concrete requirement with test-shaped scenarios. I re-verified the code claims (the `ACTIVELY_FACILITATING_STATUSES` constant, the `evaluateTeamAccess`/"ever facilitated" relationship check, the `sessionId` D11 validation block, the resolved-item `409`) against `packages/backend/src/routes/action-items.ts` directly, and every one matches what design.md and tasks.md describe. That is not a small thing to get right on a sibling-reuse change, and it didn't need my re-verification to be trustworthy — but I did it anyway, and it holds.

Two findings below are real gaps, not nitpicks — one of them (`sessionId` optionality) is a place where this change quietly inherits VOTE-002's shape without checking whether VOTE-002's *reason* for that shape actually applies to VOTE-004's own governing use case. The rest are smaller completeness notes. None of this should surprise the team or cause a rewrite; it's the kind of thing that's cheap to close now and expensive to notice after `action_item_history` already has rows in production.

---

## Finding 1 (real gap, needs a decision): `sessionId` optionality contradicts this endpoint's own use case, not just a nuance carried over from VOTE-002

**What the artifacts say:** Proposal.md, design.md (Decision D4), and `spec.md`'s "An optional sessionId is validated independently..." requirement all treat `sessionId` as optional, client-supplied, and independently validated — reusing VOTE-002's Decision D11 "exactly," with server-side derivation explicitly declined. The stated reason for declining derivation is sound on its own terms: deriving it would require assuming "exactly one qualifying active session per team can exist at a time," a guarantee nothing in the schema enforces.

**What the source use case says:** `requirements/use cases/07 - Action Item Management - Use Cases.md`, "Reassign an Action Item When an Owner Leaves the Team":
- **Precondition:** "The facilitator is authenticated and recognized as the facilitator for an **active session**." (line 342) — unconditional, not "if in a session."
- **Main flow, step 6:** "The application persists the ownership change, **recording the prior owner and the session in which the reassignment occurred**." (line 353) — no hedge.
- **Postcondition (Success):** "The prior owner and **reassignment session are recorded** in the item's history." (line 363) — again unconditional.

Compare this to the *sibling* use case this endpoint's design leans on for precedent, "Update Action Item Status" (same document, lines 72–183): its trigger explicitly names an out-of-session path ("...or, if supported, outside of a session"), and its own session-recording language is hedged accordingly — "records the session in which the resolution occurred **(if applicable)**" (line 153). VOTE-002 has a legitimate, use-case-grounded reason for `sessionId` to be optional: it supports a scenario (out-of-session status update) that this endpoint does not have. VOTE-004's own use case never contemplates an out-of-session reassignment — its precondition *requires* an active session before the action is even possible, which is also exactly what the facilitator-authorization check (D1) already independently requires and proves before the new-owner cascade ever runs.

**Why this matters concretely, not abstractly:** every accepted reassignment writes an `action_item_history` row (per D7/D9, tasks 2.10). If a caller omits `sessionId`, that row's `session_id` is `NULL` — permanently. Per the use case's own postcondition, "the session in which the reassignment occurred" is supposed to be a recorded fact of every successful reassignment, not a fact recorded only when the client happens to include it. Priya's explore-stage Observation 8 raised this same concern from the facilitator's continuity-of-history angle; the exploration notes and design.md both resolved it by leaning on "consistency with VOTE-002" without checking that VOTE-002's optionality is justified by a scenario (out-of-session update) that doesn't exist for this endpoint. That's the gap: the reasoning that closed this question was sibling-consistency, not this endpoint's own governing use case.

**Concrete condition I'd like adopted, one of these two, stated as a decision rather than left as inherited from D11:**
1. **Make `sessionId` required in the request body for this endpoint specifically** (not optional), still validated by the exact D11 rule already specified (`422` if it doesn't reference an actively-facilitating session for the item's team). This closes the gap against the use case's unconditional postcondition without reopening the "assume a single qualifying session" question D4 correctly declined to solve via server-side derivation — the client's own UI already knows which session it's acting in, since the facilitator can only reach this action from inside a live session per the use case's precondition. This is the smaller change and the one I'd lean toward.
2. **Or:** explicitly override the use case's postcondition in proposal.md, the same way other accepted limitations in this document are named plainly (e.g., the eligibility-vs-availability gap, the between-sessions timing gap) — state that a reassignment's `session_id` MAY be `NULL` when the client omits it, that this is a deliberate, known divergence from the use case's stated postcondition, and why the sibling-consistency argument outweighs it.

Either is buildable. What isn't buildable-as-is is leaving this un-reconciled: right now `spec.md` and the use case disagree about whether "the session is recorded" is a guarantee or a maybe, and nothing in the proposal says so out loud.

---

## Finding 2 (internal inconsistency, needs a decision): the relationship check's task list and its own spec text disagree on whether "is the calling user the item's current owner" is a signal

`spec.md`'s first requirement states the zero-relationship condition as: "not the owner, not a plain team member, not an Application Admin, and has never facilitated a session for this team" (line 7) — explicitly listing "the owner" as one of four independent relationship facts, mirroring VOTE-002's actual shipped shape, where `isOwner = item.owner_id === userId` is checked as its own short-circuit before `evaluateTeamAccess` and the "ever facilitated" query (`action-items.ts` lines 96–105).

`tasks.md` task 2.3, however, only implements two of the four: `evaluateTeamAccess(userId, team_id)` and the "ever facilitated" `EXISTS` query. There is no task instructing an `isOwner` check anywhere in the reassignment handler's task list.

In the ordinary case this is harmless — an active current owner is already a team member, so `evaluateTeamAccess` grants them a relationship regardless. It stops being harmless in exactly the scenario this endpoint is *named* for: a departed owner (`removed_at IS NOT NULL`) is, by construction, no longer covered by `evaluateTeamAccess`'s membership grant. If that departed former owner ever called this facilitator-only endpoint against their own former item (not a likely attack, but not an impossible one — e.g., a stale bookmark, a scripted retry), `spec.md`'s stated relationship list says they should be recognized as having "some relationship" (they're named as the owner condition) and get `403`; the task list as written would return `404` instead, since nothing checks `item.owner_id === userId`.

**Concrete fix, either direction is fine, but it needs to be a stated choice:**
- Add a 2.3a task: `isOwner = item.owner_id === userId`, folded into the same `hasRelationship` short-circuit VOTE-002 uses, so the implementation matches `spec.md`'s literal text; **or**
- Correct `spec.md`'s line 7 to drop "not the owner" from the zero-relationship enumeration, with one sentence stating why it's inapplicable here (VOTE-004 has no owner-authorized path, so distinguishing 404-vs-403 for a departed former owner probing their own old item is not a scenario this endpoint's threat model needs to close, unlike VOTE-002 where the current owner is a legitimate caller).

I'd lean toward the second option — it's a smaller, more honest fix, since VOTE-004's whole design premise (D1) is "no owner-path fork," and carrying over VOTE-002's `isOwner` relationship signal without also carrying over any reason a non-facilitating owner would legitimately call this endpoint reads as copy-paste residue rather than a considered decision. Either way, right now the spec text and the buildable task list contradict each other on a `404`-vs-`403` boundary, which is precisely the class of ambiguity this whole change was built to eliminate for VOTE-002's own URL shape.

---

## Finding 3 (minor, name it and move on): the "resolved item + invalid sessionId" ordering has no scenario, unlike its new-owner sibling

Design.md and the tasks.md check-ordering (item load → relationship → `sessionId` → authorization → resolved-item → new-owner cascade) put `sessionId` validation *before* the resolved-item `409` check — meaning a request against a resolved item that also supplies a `sessionId` for the wrong team would be rejected `422` (bad session) rather than `409` (resolved), the mirror image of the already-spec'd "resolved item + invalid new owner → 409 wins" scenario (spec.md lines 92–96). This ordering is inherited unchanged from VOTE-002's own shipped order (I confirmed this directly in `action-items.ts`: `sessionId` validation at line ~127 runs before the resolved-item check at line ~181), so it isn't a new judgment call — but `spec.md` explicitly test-cases the new-owner-vs-resolved precedence and stays silent on the `sessionId`-vs-resolved precedence. For symmetry and so a future test-writer doesn't have to reverse-engineer the intent, I'd add one short scenario stating it explicitly, the same way its sibling already does.

---

## Finding 4 (minor, pre-existing, name it rather than let it surprise someone): no stated behavior for a missing/malformed `newOwnerUserId`

The new-owner cascade (D5) starts at "`newOwnerUserId === callerId` → `422`," which presumes the field is present and well-formed. Neither `design.md` nor `spec.md` states what happens if `newOwnerUserId` is omitted from the request body entirely or isn't a valid UUID. I checked `action-items.ts` for VOTE-002's equivalent handling of malformed bodies and found no request-schema validation layer in this route file at all — so this is an inherited gap, not one this change introduces, and I'm not asking for it to block this change. Given how disciplined this document otherwise is about naming every accepted gap plainly (the eligibility/availability gap, the timing gap, the OQ-8 gap), I'd like one sentence added alongside those naming this one too, so a reviewer six weeks from now finds it named rather than discovered.

---

## What's already right and doesn't need rework

- The new-owner validation cascade (D5) maps precisely onto BRD FR-9.5's no-manager-participation constraint — `role = 'participant'` checked exactly, not "membership exists" — with an independently-tested scenario (spec.md, "An Engineering Manager cannot be reassigned an item"). This is exactly the precision my persona cares about most on this endpoint, and it's there.
- The `404`-vs-`403` enumeration boundary (D2) and `403`-vs-`409` resolved-item correction (D3) both landed as spec'd scenarios *and* a task to correct `REST API Contract.md` at its source (task 3.1) — not just a design.md footnote. That was my top ask at explore-review stage and it's fully closed.
- The `action_item_history` schema decision (D7) closed the "convention vs. enforced invariant" gap I raised in explore-review: the `CHECK` constraint is in tasks.md 1.2, and the application-level SHALL for status-pair equality is in spec.md line 122, with a cross-reference sentence actually added to `action-item-status-management/spec.md`'s own requirement (not just this change's spec) — I checked that file directly and the sentence is there.
- The `ACTION-002`/OQ-8 overlap I flagged is named plainly in both proposal.md and design.md's risk table, scoped out explicitly rather than silently absorbed, with a forward pointer for me to revisit. That's the right call — extending this change to fix OQ-8 would be scope creep on a different endpoint's write path.
- The `team-membership-removal/README.md` stub correction (task 3.2) is targeted correctly — I verified both stale bullets still exist at lines 12 and 22 of that file exactly as tasks.md describes them.

---

## Summary — what needs resolution before implementation

| # | Item | Severity | Needs |
|---|---|---|---|
| 1 | `sessionId` optionality vs. this endpoint's own use case (unconditional "session is recorded" postcondition) | Real gap | A decision: require `sessionId` on this endpoint (my lean), or explicitly override the use case postcondition in proposal.md with a stated reason |
| 2 | `isOwner` relationship signal named in spec.md but absent from tasks.md's implementation steps | Internal inconsistency | Either add the task (2.3a) or correct spec.md's line 7 to drop "not the owner" with a stated reason |
| 3 | No scenario for "resolved item + invalid sessionId" ordering | Minor completeness | Add the symmetric scenario spec.md already has for new-owner |
| 4 | No stated behavior for missing/malformed `newOwnerUserId` | Minor, pre-existing | One sentence naming it as an inherited, accepted gap, matching this document's own house style |

None of these change the endpoint's overall shape or its readiness for implementation. Items 1 and 2 are the ones I'd want an explicit answer to before tasks.md's affected tasks (2.3, 2.4, 2.10, 2.12) are executed, since both affect what actually gets written to `action_item_history` and the `404`/`403` boundary — the two places a documentation-only fix after the fact is much more expensive than a one-line decision now.
