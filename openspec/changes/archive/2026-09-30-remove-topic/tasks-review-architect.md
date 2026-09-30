# Architecture Review — tasks.md ordering and dependency check

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Does `tasks.md`'s ordering correctly operationalize `design.md`'s decisions? No task should assume something a prior task hasn't built yet. This is a dependency-graph review, not a re-review of the decisions themselves — those were mine to make in design.md and I'm not relitigating them here.

## Verdict

**Approved.** The section ordering is a correct topological sort of design.md's dependency graph — I did not find a task that consumes something an earlier task hasn't produced yet. Two structural nits below are worth a look before implementation starts, but neither is a reordering that has to happen; they're clarity/traceability improvements.

## Verified dependency chains

**1. Shared decision-only auth function precedes both consumers.** `checkStandingFacilitatorOrAdminAuthorization` is introduced in Task 3.1 (TOPIC-004's own section) and Task 7.1 (TOPIC-002) explicitly cites "Task 3.1 adds" when consuming it. Section 3 precedes Section 7 in the list, so the dependency holds under top-to-bottom implementation. Confirmed correct.

*Nit:* the function is a shared, cross-cutting auth primitive with two independent callers (per design.md Decision 1's own reasoning for relocating it out of `topics.ts`), but it's introduced as a sub-bullet of a route-specific task (3.1) rather than as its own task in Section 2, which already exists as the place for shared-helper prerequisites (the open-action-items helper). Ordering isn't broken — 3.1 still precedes 7.1 — but a reviewer scanning the task list for "what shared infrastructure exists before route work starts" will miss this one, since it's buried inside "Archive Topic endpoint — checks and cascade." Recommend pulling it into its own task in Section 2 (e.g., 2.3) purely for scan-ability; not a blocking change.

**2. `archived_by` migration precedes every read/write of that column.** Task 1.1 adds the column. The only writer is Task 5.3 (the archive `UPDATE`, Section 5). The only reader is Task 7.3 (TOPIC-002's join, Section 7). Both are numbered after Section 1. Confirmed correct.

**3. Advisory-lock/last-topic guard follows the base archive-endpoint scaffolding it depends on.** Section 4 (the transaction, advisory lock, and count check) presupposes the route handler, identity/role check, team/lock/topic-existence/status checks Section 3 builds — Task 4.1 only runs "evaluated only after" those checks pass. Section 3 precedes Section 4. Confirmed correct.

**4. The `openActionItemCount` audit-metadata addition follows both the `confirm=true` re-derivation and the base audit-write task.** This one resolves cleanly, but not the way the review prompt implied it would: tasks.md doesn't split this into a "base audit write" task followed by a separate "add the metadata field" task — Task 6.1 defines the audit row with `openActionItemCount` already included from the start, citing Task 5.2 for where the value comes from. That's the right call, not a shortcut: this is greenfield code (no shipped `topic.archived` audit event exists to retrofit), so there's no reason to sequence "write it, then correct it" as two tasks the way Marcus's engineer-review finding was resolved in the design doc's prose. Section 6 still numerically follows Section 5, so the dependency (5.2's re-derived count feeding 6.1's write) holds. Confirmed correct.

*Nit — worth flagging for the implementer, not a reordering:* Task 5.3 says "write the Task 6.1 success-audit row" and Task 6.1 says the write happens "inside the Task 5.3 transaction." That's a legitimate forward/backward cross-reference (the doc uses this pattern elsewhere — e.g., 3.6 mirrors 7.4), but here it describes two halves of a single atomic operation (one `INSERT` inside one transaction) split across two numbered sections. Similarly, Task 6.1's raw audit write and Task 6.2's `AuditEventName` union entry + `emitAuditEvent` call are two tasks describing what is likely one type-checked call site — if `db.query` for `audit_log` is wrapped in anything typed against `AuditEventName`, 6.1 may not compile in isolation before 6.2 lands. Recommend a one-line note at the top of Section 6 (or folded into 5.3) stating that 5.3/6.1/6.2 are implemented as a single unit, not sequentially gated — so whoever picks up Section 5 doesn't stop at a non-compiling checkpoint expecting to come back for Section 6 later.

**5. The two tracked-follow-up-issue tasks (11.5, 11.6) are correctly placed.** Both are process tasks (file a GitHub issue), not code tasks, and nothing in Sections 1-10 depends on them — they don't block any implementation step. Both are explicit, required-before-done items ("filed before this change is considered done"), so they're not at risk of being silently dropped either. Correct placement.

*Nit:* they're filed under "11. Verification," alongside test-execution and regression-check tasks (11.1-11.4), which are a different kind of task (confirm the code is correct) from "file a GitHub issue for a gap this change found but isn't fixing" (track future work). Cosmetic — doesn't affect execution order — but a "12. Follow-up tracking" section would make the done-criteria cleaner to audit later.

## One factual citation error (not an ordering issue)

Task 7.5: "Write a test confirming an archived topic's entry includes `archivedAt` and `archivedBy` (userId + displayName) matching the facilitator who archived it (Task 6.1's write)."

`archived_by` is set by the archive `UPDATE` in **Task 5.3** (design.md Decision 6: "set in the same transaction as the archive UPDATE"), not by Task 6.1's `audit_log` insert — those are two different writes in the same transaction, and TOPIC-002 (7.3) joins against `topics.archived_by`, never against `audit_log`. The citation should point to 5.3, not 6.1. Doesn't change execution order (5.3 precedes 7.5 either way), but as written it would send an implementer looking in the wrong place for the write being tested.

## Coverage check

Cross-referenced all ten of design.md's numbered decisions against tasks.md sections — each has a corresponding task (Decision 1→3.1/7.1, Decision 2→Sections 3-5 structure + 11.2, Decision 3→Section 4, Decision 4→10.2, Decision 5→Section 2 + Section 5, Decision 6→1.1/7.3/7.5/10.4, Decision 7→Section 6/11.3, Decision 8→Section 8, Decision 9→Section 7/10.1, Decision 10→Section 9). Nothing in design.md's Risks/Trade-offs table or Open Questions is left without a corresponding task or an explicit non-goal citation. No gaps found.

## Summary for implementation

Proceed in section order as numbered. The two things worth doing before or during implementation, not before approving the task list:
- Treat Tasks 5.3, 6.1, and 6.2 as one implementation unit (same commit/PR checkpoint), not three independently-completable steps — the code between them won't type-check or won't be transactionally correct if split.
- Fix Task 7.5's citation from "Task 6.1's write" to "Task 5.3's write."
