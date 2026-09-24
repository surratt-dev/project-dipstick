# Architect Review: Task Ordering and Dependencies

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `tasks.md` task ordering/dependencies only, against `design.md` and `proposal.md`. Not re-litigating design decisions.

## Summary

The two-commit migration split (Migration A + behavior changes in Commit 1, Migration B in Commit 2) is correctly reflected in task numbering and the explicit commit-boundary tasks (4.5, 4.12). Section ordering (1 → 2 → 3 → 4) respects the real dependency: the shared creation helper exists before anything calls it, and the get-or-create helper exists before either call site is wired to it. One task, however, has wording that conflicts with a call-site boundary the design document explicitly drew, and one commit-boundary is left unstated where everything else in this document is meticulously cross-referenced. Both are worth fixing before implementation starts, since both are the kind of ambiguity an implementer resolves silently, in whichever direction is convenient, rather than by re-reading design.md.

## Finding 1 (Blocking): Task 2.2's parenthetical names the wrong endpoint

> 2.2 Wire `POST /api/v1/teams/:teamId/sessions/draft` (**both existing-team and new-team creation sites**) to call get-or-create for the `joinToken` in its response...

I checked this against the code directly (`packages/backend/src/routes/facilitator-sessions.ts`). There are exactly two `join_token` generation/INSERT sites in this file, and they are **two different endpoints**, not two branches of one endpoint:

- `POST /api/v1/teams/:teamId/sessions/draft` (lines ~208-388) — one handler, one `join_token` generation (line 303), one INSERT, one response field (line 388). This is the "existing-team" site.
- `POST /api/v1/teams` (lines ~435-612, explicitly comment-labeled `// POST /api/v1/teams  (inline-team-creation)`) — a **separate** handler, its own generation (line 512), INSERT, and response field (line 610). This is the "new-team creation" site.

Design.md's Decision 1 is explicit that `POST /api/v1/teams` is **not** a get-or-create anchor point ("Note on `POST /api/v1/teams` (new-team creation): not a third anchor point"), and Task 4.2 correctly treats it that way — it removes that endpoint's `joinToken` field from the response entirely, rather than wiring it to get-or-create.

Task 2.2's parenthetical says the opposite of Task 4.2 and Decision 1: it names "new-team creation site" as something `/sessions/draft`-get-or-create wiring should cover. There is no such site inside `/sessions/draft` — the only place "new-team creation" exists in this codebase is the separate `POST /api/v1/teams` endpoint, which this same task list's own Task 4.2 says should have the field *removed*, not sourced from get-or-create.

As written, an implementer following 2.2 literally would either:
- wire get-or-create into `POST /api/v1/teams` (contradicting Decision 1, and directly undone by Task 4.2 landing in the same commit), or
- go looking for a "new-team" branch inside `/sessions/draft` that doesn't exist, and guess at what to do.

**Recommendation:** Strike the parenthetical. Task 2.2 should read something like: "Wire `POST /api/v1/teams/:teamId/sessions/draft` to call get-or-create for the `joinToken` in its response..." — this endpoint has exactly one call site. `POST /api/v1/teams` is out of scope for this task by design (Decision 1) and is handled separately by Task 4.2 (field removal).

## Finding 2 (Should-fix): Task 2.2's "replacing the sessions.join_token generation" overlaps with Task 4.2's actual job

Task 4.2 is explicit that removing the generation line and the INSERT's `join_token` value is "safe once Task 4.1 lands, since the column no longer requires a value" — i.e., that removal is deliberately gated on Migration A (dropping `NOT NULL`), and Task 4.1 lands numerically and sequentially *after* Task 2.2. Design.md's own Migration Plan draws the same line: step 3 (wiring get-or-create, includes what became Task 2.2/2.3) only "update[s] the `facilitator-state` SELECT/response to source `joinToken` from `join_links`," while the INSERT-site removal is a distinct, later step 5, bundled with Migration A.

Task 2.2's phrase "replacing the sessions.join_token generation" reads as if it does what Task 4.2 does. If taken literally at the point it's implemented (before 4.1 has relaxed the constraint), removing the INSERT's `join_token` value would violate the still-live `NOT NULL` constraint. If it's *not* taken literally (the correct reading), the phrase is simply imprecise and creates apparent duplication with 4.2's description.

**Recommendation:** Reword to make clear 2.2 only repoints the response field's source, and explicitly leaves the INSERT/column value alone until Task 4.2: e.g., "...to source the response's `joinToken` field from get-or-create's result. The INSERT's `join_token` column value is untouched here — the column is still `NOT NULL` at this point — and is removed later in Task 4.2, gated on Migration A (Task 4.1)."

## Finding 3 (Gap): Section 5 (end-to-end verification) has no stated commit assignment

Design.md's Migration Plan lists end-to-end verification as step 6 of **Commit 1** ("Add end-to-end verification per Decision 7"), landing before Migration B (step 7 / Commit 2). But in `tasks.md`, Task 4.5 — the task that enumerates everything landing in Commit 1 ("Land Tasks 1–3..., Task 3.4..., and Tasks 4.1–4.4 in the same commit") — does not mention Section 5. Task 4.12 (Commit 2's boundary task) doesn't mention it either. Every other test file and task in this document has an explicit commit assignment (that's the whole point of Tasks 4.5/4.12's cross-referencing); Section 5 is the one piece left to inference from design.md alone.

This doesn't produce an incorrect result either way — Tasks 5.1/5.2 don't reference the `join_token` column, so they're valid in either commit — but it's the same category of omission both prior reviews already caught twice in this document (the `facilitator-state` unit tests in 2.5, and the `POST /api/v1/teams` field removal in 4.2's original scoping), and it's cheap to close.

**Recommendation:** Add Section 5 to Task 4.5's list, e.g.: "...and Tasks 4.1–4.4, and Tasks 5.1–5.2, in the same commit."

## Minor note (non-blocking)

Task 4.11 references "`facilitator-sessions.test.ts` (test 2.18)." This is an existing test-numbering label internal to that test file (from a prior change's task numbering — confirmed at `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts:466`), not a reference to this change's own Task 2.x numbering. Worth a one-word disambiguation (e.g. "test case 2.18") if a future editing pass touches this line, so a reader doesn't briefly cross-reference it against this document's own Section 2. Not worth blocking on.

## What's correctly ordered

- Section 1 (shared helper extraction) fully precedes Section 2 (get-or-create), which is the real dependency — confirmed.
- Within Section 2, the get-or-create helper (2.1) precedes both call-site wirings (2.2, 2.3), and the `facilitator-state` `actor_global_role` miss-path lookup (2.3) is correctly sequenced after 2.1 exists to call into.
- The Migration A / Migration B split (Tasks 4.1-4.5 vs. 4.6-4.12) is correctly gated: 4.2 (INSERT-site removal) is explicitly stated as dependent on 4.1 (constraint relax) landing first, matching design.md Decision 6's rolling-deploy analysis. Migration B's task (4.6) and its five dependent test-file fixes (4.7-4.11) are correctly bundled into one atomic commit (4.12), consistent with "the migration and the test updates cannot be split without breaking CI on invalid SQL."
- Frontend (Section 3) has no backend dependency and is correctly independent of Section 2's sequencing.
