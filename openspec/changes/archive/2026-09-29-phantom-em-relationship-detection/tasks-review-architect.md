# Architecture Review: Task Ordering/Dependencies — phantom-em-relationship-detection

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-09-29
**Scope:** Task ordering and dependency correctness in `tasks.md`, given design.md's Decisions 8 and 9 are now resolved. This is not a re-review of those decisions themselves.

## Summary

The high-level task ordering is sound: detection script before its verification, annotation script before its verification, fixture setup before both verification tasks, result-recording and handoff last. I did not find any task that references the detect script's output before the detect script task completes, or any task in section 3 that omits the guard/identity-echo requirements design.md now requires.

I found one real gap (fixture completeness in 4.1 vs. what 4.2/4.3 need to test) and one wording ambiguity (statement ordering language split across 3.2/3.3) that should be tightened before implementation starts, so the implementer doesn't have to reconcile it mid-task.

## Finding 1 (blocking): Task 4.1's fixture does not build everything 4.2–4.3 test against

Task 4.1 specifies the fixture as:

> a `team_memberships` row with `role = 'engineering_manager'` and a matching pre-cutoff `team.role_changed` audit row, no `team.manager_established` row

That's one fixture shape — the positive case. But the verification tasks that follow assume additional fixture rows that no task is responsible for creating:

- **Task 4.2** requires the detect script to "correctly exclude a removed-membership variant" — this needs a second fixture row (`removed_at IS NOT NULL`, EM role, no `manager_established` row) that 4.1 doesn't mention building.
- **Task 4.3** requires excluding "a pre-cutoff `team.role_changed` row that has already been annotated" — this needs a third fixture row: a pre-cutoff `team.role_changed` row *plus* a corresponding `team.manager_established_retroactive_annotation` row referencing it via `annotated_audit_log_id`, so the `NOT EXISTS` guard has something real to exclude. Nothing builds this.
- **Task 4.3** also requires "the `team.role_change_denied` exclusion fixture row... dated before the cutoff" (the strengthened requirement from the security review) — a fourth fixture row. Also not in 4.1.

As written, 4.3 sequentially follows 4.1, but 4.1's scope doesn't cover the fixture rows 4.2 and 4.3 actually depend on. An implementer following tasks.md in order would hit 4.2 or 4.3 and discover they need to go back and extend the "already done" fixture task — exactly the kind of implicit, undocumented dependency this review exists to catch.

**Recommendation:** Expand task 4.1 to explicitly enumerate all four fixture rows before any verification task depends on them:
1. The base phantom case (active EM membership, pre-cutoff `team.role_changed`, no `manager_established` row) — for 4.2's positive match and 4.3's annotation.
2. A removed-membership variant (EM role, `removed_at IS NOT NULL`, no `manager_established` row) — for 4.2's exclusion check.
3. A pre-cutoff `team.role_change_denied` row (same metadata shape as `team.role_changed`) — for 4.3's operation-filter exclusion check.
4. A pre-cutoff `team.role_changed` row already paired with a `team.manager_established_retroactive_annotation` row referencing it — for 4.3's idempotency-exclusion check (distinct from 4.4, which re-runs the whole script rather than pre-seeding an annotation).

Without this, 4.3 as currently scoped cannot actually be executed as described — the fixture it needs doesn't exist yet when it runs.

## Finding 2 (non-blocking, tighten before implementation): 3.2 and 3.3 give overlapping/ambiguous statement-order instructions for the same file

Design.md Decision 8 fixes the annotate script's statement order explicitly: `\if` existence guard → environment sanity check → identity-echo check → guarded `INSERT`. Task 3.3 correctly reproduces this order inline as (a)/(b)/(c) before the `WHERE` clause work.

But task 3.2, immediately prior, says: "Add the same environment sanity-check statement as the detection script, **as this script's first executable statement**." Read literally against Decision 8's order, the guard comes before the environment check in the annotate script — so the environment check is not first in the file, only first among *SQL statements sent to the server* (the `\if` is a client-side psql meta-command, not a statement executed against the database). That reading is defensible, but it's not stated, and 3.3 then re-specifies the environment check's position as step (b), creating a second, slightly different description of the same placement.

This isn't a hard defect — 3.3's explicit ordering wins and is correct — but as written, an implementer doing 3.2 literally in isolation could reasonably place the environment check as the file's literal first line, then have to move it when doing 3.3. That's rework caused by ambiguous task text, not a design gap.

**Recommendation:** Either (a) scope 3.2's "first executable statement" claim explicitly to the detection script only and defer all annotate-script ordering to 3.3, or (b) add a one-clause qualifier to 3.2 — "first *SQL* statement; the `\if` guard specified in task 3.3 precedes it" — so the two tasks don't read as two different orderings of the same file.

## Checked and found correct

- **Detect-before-consume:** No task references the detection script's output before section 2 completes. Section 5 (result recording/handoff) correctly comes after sections 2–4.
- **Annotate script internal sequencing (3.1 → 3.4):** 3.1 (header/invocation) → 3.2/3.3 (pre-flight checks + `WHERE` clause) → 3.4 (guarded `INSERT ... SELECT`) → 3.5 (inspection) is the right order; the `INSERT` task (3.4) correctly comes after the query logic it selects from (3.3), and both correctly precede the no-`UPDATE`/`DELETE` inspection (3.5).
- **Verification internal sequencing (4.1 → 4.4):** fixture setup, then detect-script test, then annotate-script test, then idempotency re-run, is the correct order and matches script build order (section 2 before 4.2, section 3 before 4.3/4.4).
- **Decision references:** Tasks 3.3/3.4 and 5.1/5.3 correctly cite Decisions 8 and 9 as already-resolved inputs (task 1.1/1.2), not as open items to re-derive mid-task.
- **Minor, non-blocking:** Task 5.2 describes work ("at handoff time... task 5.3") that's temporally anchored to task 5.3 but numbered before it. Functionally harmless since the tracking mechanism just needs to exist by the time handoff (5.3) happens, but the forward cross-reference reads awkwardly — consider folding the tracking-mechanism setup into 5.3 itself, or resequencing so the handoff task is 5.2.

## Bottom line

Fix Finding 1 before implementation starts on section 4 — it's a real dependency gap, not a style note. Finding 2 and the 5.2/5.3 note are worth a quick edit but don't block starting sections 2–3.
