# Business Analyst Review — `tasks.md` (`reassign-action-item-owner`, VOTE-004 / issue #108)

**Reviewer:** Marcus Delgado, Business Analyst
**Scope:** `tasks.md`, cross-checked line-by-line against `proposal.md`, `design.md`, and `specs/action-item-owner-reassignment/spec.md` (including the two design-review passes, `design-review-engineer.md` and `design-review-security.md`, since several of the decisions I'm checking for exist only because those reviews raised them).

## Overall verdict

Tasks.md covers this proposal completely. I traced every "What Changes" bullet in proposal.md, every ADDED requirement and scenario in `specs/action-item-owner-reassignment/spec.md`, and every Decision (D1–D11) in design.md against a corresponding task, and I did not find a requirement or a normative scenario with no task behind it. More to the point for this pass specifically — the things that got added or changed in the last round of revisions (sessionId made required, the `isOwner` removal, the D11 race guard, the D6/D10 no-op audit amendment, the D5 soft-removed-member query warning, the `ownerDisplayName` sourcing note, and the three-part contract correction including the `global_role` rewrite) are each present in tasks.md, attributed to the right decision, and not just mentioned in passing — they show up as concrete, checkable steps. This is a well-translated task list, not one where the reviewer feedback got absorbed into prose but lost on the way to something an implementer actually executes.

I have one real (but minor, non-blocking) finding on test-coverage completeness, and two things I verified and want on record as confirmed rather than silently assumed.

## Finding 1 (Minor) — `applyTimingFloor` test coverage names two of the four branches it needs to cover

Design.md's D2 amendment and both design reviews are emphatic that `applyTimingFloor` is not incidental — it's "the other half" of the anti-enumeration control, and it's required at **four** early-return branches: item-not-found 404 (task 2.2), no-relationship 404 (task 2.3), invalid/missing-`sessionId` 422 (task 2.4), and not-authorized-facilitator 403 (task 2.5). All four implementation tasks correctly call this out explicitly — that part is solid, and it's exactly what Engineer Finding 3 and Security Finding 1 asked for.

But on the test side, task 4.2 ("Anti-enumeration tests") only asserts "response timing does not distinguish the two `404` cases" — it doesn't ask for an equivalent assertion on the 422 branch (task 4.7, sessionId validation tests) or the 403 branch (task 4.1, authorization tests). So it's possible to implement this correctly (all four branches call the helper, per 2.2–2.5) and still ship a test suite that only proves the floor exists on two of the four.

I checked whether this is a new gap this change introduces or an inherited one: it's inherited. `VOTE-002`'s own shipped test suite (`action-items.test.ts`) asserts `mockApplyTimingFloor` call counts at its 403 branch (line 199) and both its 404 branches (lines 323, 356, 388, 400), but its own invalid-`sessionId` 422 test (line 753) has no timing-floor assertion at all. So VOTE-004's tasks.md is reproducing a real thinness in the sibling's own precedent, not inventing a new one.

**Recommendation:** Since design.md treats all four branches as equally load-bearing, and since this change is the one place in the design process where that point has been made explicitly (twice, by two independent reviewers), I'd rather see tasks.md close the gap here than carry it forward a second time. Add one clause each to task 4.1 (assert `applyTimingFloor` called on the 403 branch) and task 4.7 (assert it on the missing/invalid-`sessionId` 422 branch). This is a one-sentence addition per task, matching the size of fix both reviews already asked for elsewhere in this document — not a new category of work.

Not blocking: the implementation tasks (2.2–2.5) already require the behavior; this finding is only about whether the test tasks will catch a future regression on the two branches they're currently silent on.

## Confirmed — the two follow-up tickets are named as out of scope, and no task implements them

I read proposal.md's "Two non-blocking follow-ups" section (the global Fastify error handler, from Security Finding 5; and shared request/response types for `VOTE-002`/`VOTE-004` together, from Engineer Finding 5) against every task in sections 1–4 of tasks.md. Neither is implemented anywhere:

- No task touches `packages/backend/src/app.ts` or adds a `setErrorHandler`.
- No task adds `ReassignActionItemRequest`/`ReassignActionItemResponse` (or any type) to `packages/shared/src/types/action-item.ts`.

Both are documented plainly in proposal.md as deliberate, named exclusions rather than silently dropped ideas, and tasks.md respects that boundary — it doesn't quietly scope-creep either one in under a different task's heading. This is exactly the pattern I want to see: an out-of-scope decision that stays out-of-scope by the time it reaches the task list, not one that drifts back in because an implementer thought "well, while I'm in this file..."

## Confirmed — the `action-item-status-management` cross-reference isn't missing, it's just not a `tasks.md` line item

I initially flagged this as a possible gap: proposal.md's Impact section says `openspec/specs/action-item-status-management/spec.md` gets a one-sentence cross-reference, and design.md's D7 states the same, but tasks.md's Documentation section (task 3.1, 3.2) only covers `requirements/design/REST API Contract.md` and `team-membership-removal/README.md` — neither mentions `action-item-status-management` at all.

On inspection, this isn't dropped: the actual delta content already exists as a prepared artifact at `specs/action-item-status-management/spec.md` in this change's own folder (a proper `MODIFIED Requirements` delta, matching the exact wording proposal.md and D7 describe). I confirmed the main spec file (`openspec/specs/action-item-status-management/spec.md`) doesn't have this sentence yet, which is correct and expected — merging a change's delta specs into the main spec tree is this project's archive/sync stage's job (there's a dedicated `openspec-sync-specs` capability for exactly this, separate from `tasks.md`, which is scoped to implementation work), not something `tasks.md` itself needs to instruct. `requirements/design/REST API Contract.md` and `team-membership-removal/README.md`, by contrast, sit outside the openspec spec tree with no automated sync path, which is exactly why those two do get explicit tasks (3.1, 3.2) and this one doesn't. Consistent, not an oversight — I mention it here only so it's on the record that I checked, not assumed.

## Traceability spot-checks (recently revised decisions)

- **`sessionId` required (D4):** task 2.4 states it as required with `422` on absence, cites the BA-review correction by name, and is tested by 4.7 (including the "required, corrected from an earlier optional draft" case) and cross-checked against the resolved-item ordering in 4.5. Matches spec.md's requirement and scenarios exactly.
- **`isOwner` removed (propose-review-ba.md Finding 2):** task 2.3's relationship check has no owner-path fork, matching spec.md's explicit note that `isOwner` is "correctly absent from both this enumeration and tasks.md's implementation of it (task 2.3)." Verified consistent.
- **D11 race guard:** task 2.9's `WHERE status != 'resolved'` + `rowCount` check, and the dedicated concurrency test 4.13, both match design.md's decision and the spec's "concurrent resolve discovered only at write time" scenario precisely, including the "write neither `action_item_history` nor `audit_log`" outcome.
- **D6/D10 no-op audit amendment:** task 2.8 (write path) and tests 4.6/4.9 (including the "repeated no-op calls each get their own row" case from the spec) match. This is the one place where three documents (design.md, spec.md, tasks.md) all had to move together after Security Finding 2, and they did.
- **D5 soft-removed-member query warning (Security Finding 4):** task 2.7's implementation note about not reusing `evaluateTeamAccess`'s `removed_at`-filtered join is present near-verbatim from design.md. Good — this is exactly the kind of "obvious shortcut that would silently break a 404-vs-422 distinction" detail that's easy to lose between design and implementation, and it didn't get lost here.
- **`ownerDisplayName` sourcing (Engineer Finding 4):** task 2.7(b)'s query is widened to select `display_name`, and both 2.8 and 2.12 state explicitly that they reuse that row rather than adding a join. Matches.
- **Contract correction, three parts:** task 3.1 lists all three (403→409, sessionId wording, and the added-after-review `global_role` rewrite), matching design.md's Migration Plan exactly, including the "no mention of `global_role`" instruction.

## Summary

One minor, non-blocking test-coverage gap (Finding 1, `applyTimingFloor` assertions on two of four branches) worth a one-line fix to tasks 4.1 and 4.7. Everything else I checked — full requirement/scenario coverage, the two out-of-scope follow-up tickets staying out of scope, and every recently-revised decision's translation from design.md/spec.md into a concrete task — holds up. This is buildable as written.
