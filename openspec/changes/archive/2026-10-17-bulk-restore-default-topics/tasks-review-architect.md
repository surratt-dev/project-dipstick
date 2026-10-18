# Tasks Review: Solution Architect (Ingrid Sollenberger)

Change: bulk-restore-default-topics (#218). Reviewed: tasks.md against design.md and proposal.md.
Focus: dependency ordering. Does any task assume something not yet built? Which tasks should be split, merged or moved?

## Verdict

Approve with required reordering. The macro order (verify, gate, shared planner, backend, backend tests, frontend, docs) matches the real dependency graph: shared planner before server and UI, audit event name before handler, additive `displayOrder` before the dialog. I found no task whose code dependency points forward in a way that breaks the build. The problems are: (a) decisions that gate build tasks are ratified after the build, (b) three tasks are in the wrong section, (c) one missing contract task, (d) two tasks are split on a line that is not a buildable seam, and (e) several test tasks overlap.

## Blocking (reorder or add before build starts)

### B1. Ratification happens after the work it constrains (1.2 vs 9.1)
Proposal ratification items 1 (ids-only audit metadata), 2 (skip rule stricter than single restore), 3 (ordering cost) and 4 (first-by-prior-order wins) each determine code written in 2.1 (planner semantics) and 3.3 (audit metadata shape). Task 1.2 gates only on item 2, and 9.1 asks for all of them at PR review. If the PO rejects item 1 or 4 at 9.1, 2.1/2.2/3.3/4.3/4.7 are reworked. This is the expensive implicit-decision pattern I flag everywhere.
Fix: extend the 1.2 gate to obtain answers to items 1, 3, 4 and 5 (AC4/AC5 reading) together with the item 2 numbers. 9.1 then only records that the answers were obtained and unchanged.

### B2. Task 6.1a (use case acceptance criteria) must precede section 5 but lives in section 6
The header says order is backend, frontend, docs. 6.1a says "before section 5 starts". A reader executing in section order violates it.
Fix: move 6.1a to the end of section 4 (or to section 1 as 1.3), renumber. Keep 6.2 in docs, depending on it.

### B3. No task defines the bulk-restore response contract or the frontend client
Backend 3.2/3.3 returns `{restored:[{topicId,name,displayOrder}], skipped:[{topicId,name,reason}]}`. Task 3.4 updates only the shared type for `GET /topics/all`. Task 5.3 consumes the response and issues the request, yet no task creates the shared response type, the `reason` union (design says unknown reasons must render generically, so the type needs to be open), or the fetch helper (design D20 cites `assignDefaults.ts` as the pattern). 5.3 silently assumes both exist.
Fix: add to section 2 (or 3.4b) the shared response type; add 5.0 (client helper `restoreDefaults.ts`, no body, no Content-Type, mapped status handling) before 5.1/5.3.

### B4. 5.2 assumes a reusable "single-Restore predicate" that may not exist
"Reuse the single-Restore predicate" is only valid if that predicate is a named function or derived value in `TopicManagementPage.tsx`. If it is inline JSX logic, extracting it is a refactor of existing code with its own regression risk, and it is not in the diff plan or the "unchanged" list.
Fix: add a verification line to 1.1 (is the predicate extractable?) and, if not, an explicit refactor task before 5.2 with its own tests.

## Split / merge / move

### S1. Merge 3.2 and 3.3, or redefine 3.2 as a skeleton
3.2 specifies the handler including "`applyTimingFloor` on every exit including the thrown path (D22)" and "no topic read before `lockTeamTopics`". The thrown-path floor is a property of the catch block that 3.3 builds around the transaction, and "no topic read before lock" is a property of 3.3's body. 3.2 is therefore not completable or testable without 3.3. Splitting at this seam produces a half-handler no test can exercise.
Fix: either one task "handler and transaction" with 3.2/3.3 as sub-bullets, or make 3.2 strictly the cascade up to the transaction (auth wrapper, route registration, canonical 404, role, limiter, writable team, lock gate returning a stub) and move the D22 floor-on-throw wording to 3.3. Fold 3.5 (header comment) into whichever task contains the cascade; it is not a separate unit of work.

### S2. 3.2 omits the limiter denial-context change (D18)
D18 requires `attemptedOperation: "topic.defaults_restored"` and the endpoint string in `TopicWriteDenialContext`. If that type is a closed union, it must be extended before 3.2 compiles; if it is free-text, say so. Neither tasks.md nor 1.1 states which. Add to 3.1 (alongside the audit event name, both are type-level prerequisites) and verify in 1.1.

### S3. 3.4a duplicates 6.3 and mis-sections docs
The `docs/deployment.md` audit-lookups sentence appears in both 3.4a and 6.3. Keep the code doc comment (on the union) in 3.1 where the union is edited; leave the deployment.md text only in 6.3. This removes a two-owner edit to one file.

### S4. 2.4 (CI builds shared before tests) should precede 2.2
Its purpose is to make downstream tests valid; it is a prerequisite for the first backend or frontend test importing the planner. Move it to 2.1a or the start of section 2. 2.3 is a recorded decision, not work; convert it into a PR-checklist line or a verification in 9.2 ("`addCustomTopic.ts` absent from diff").

### S5. Section 4 is a test dump downstream of all implementation
Implementation is complete only at the end of 3.x and nothing is verified until 4.x. Interleave: after 3.2/3.3 run 4.1 (cascade) and 4.4/4.5 smoke before 3.4. At minimum add a stated checkpoint "backend green" before section 5 so the frontend is not built on an unproven endpoint. Also overlaps to consolidate:
- 4.14 duplicates 4.2 (sequential-restore equivalence, tie/negative order) and 4.3.
- 4.13 duplicates 4.1 (byte-identical 404, 503 fail-closed) and 4.11 (hygiene, both marked mandatory).
- 4.12 and 4.12a both assert the floor on 200 paths.
Merge to one case list per concern; fewer tasks, same coverage.

### S6. Split 5.3
It bundles submit/in-flight guard, result and delta rendering, live region, and the full error matrix. These are separable and testable independently: 5.3a submit and double-activation guard; 5.3b result, empty, delta and live region; 5.3c error mapping and close-and-refetch. 5.4 (empty state) depends on the dialog trigger from 5.2/5.3 and should be listed after them with that dependency stated.

### S7. Move 7.4 (timing floor measurement) out of "post-build" and fix its numbering
7.4 can change `TIMING_FLOOR_MS`, a shared constant read by every content route, so it modifies behavior beyond this feature and must land before the 4.12/4.12a assertions are final and before 9.2 (full suite green). It is also listed before 7.2 and 7.3. Also reconcile naming: design says `TIMING_FLOOR_MS`, tasks 4.12/4.12a say `CONTENT_TIMING_FLOOR_MS`; 1.1 should confirm which constant bulk uses. Move 7.4 to run after 4.12a with its output feeding 9.2, and keep the "block production on TODO-GROUP6, name an owner" fallback. This is a production-readiness gate and must not sit behind optional follow-ups.

## Minor

- 6.1 (sync delta specs) is an archive-time action; place it with 9.3, not in the docs section.
- 7.1 (facilitator usability test) cannot complete before merge; mark it explicitly as post-merge so 9.x does not appear blocked on it.
- Section 8 items are drafts for the PO, not tasks; 8.6 precedes 8.5. Cosmetic, but renumber or move to a separate artifact so task completion counts are meaningful.
- 4.8 and 4.9 need real-DB and session fixtures; confirm in 1.1 that the harness exists, otherwise there is hidden fixture work not in the plan.
- 5.5 repeats assertions already in 5.1 and 5.3; keep 5.5 to the visibility matrix and cross-cutting checks.

## Recommended order (summary)

1.1 (extended: limiter context type, role predicate extractable, floor constant name, test harness) -> 1.2 (gate extended to ratification items 1-5) -> 2.4 -> 2.1 -> shared response type (new) -> 2.2 -> 3.1 (+ denial-context type, union doc comment) -> 3.2+3.3 merged -> 3.4 -> section 4 (consolidated, with a "backend green" checkpoint) -> 7.4 measurement -> 6.1a -> 5.0 -> 5.1 -> 5.2 -> 5.3a/b/c -> 5.4 -> 5.5 -> 6.2/6.3/6.4 -> 9.1 (confirm only) -> 9.2 -> merge -> 9.3 with 6.1, 7.1, 7.2/7.3.

## Architecture notes (no action required)

The design decisions themselves (server-authoritative plan under the advisory lock, planner shared but server recomputing, audit in the same transaction, snapshot isolation of live sessions, explicit inherited gaps) are sound and explicitly documented. The one-limiter-unit decision (D21.5) and floor-on-throw divergence (D22) are properly recorded. My concerns here are sequencing only.
