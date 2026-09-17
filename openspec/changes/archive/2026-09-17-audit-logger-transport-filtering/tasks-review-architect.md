# Architecture review: tasks.md ordering pass

Reviewer: Ingrid Sollenberger (Solution Architect)
Scope: task ordering/dependencies only. Not re-litigating content already fixed (18-event list, task 4.1 framing).

## Finding 1 — Section 3 (Verification) is ordered before Section 4, but 3.1's diff claim doesn't account for 4.1's file

Task 3.1 states: "git diff touches only `docs/deployment.md` and a comment-only addition in
`audit-logger.ts`." That's true at the point 3.1 runs (only Sections 1-2 are done), but the
change's actual final diff also touches `openspec/specs/first-access/spec.md` (task 4.1) — listed
in proposal.md's own Impact section as a third touched file. If 3.1 is meant to be read as "this is
the complete diff for this change" (which is how a verification gate reads in a PR), it will be
stale and misleading once 4.1 lands after it.

**Fix:** reorder so Section 4 (spec traceability) comes before Section 3 (Verification), and add
the `first-access/spec.md` reorganization to 3.1's file list. This also lets 3.3 ("state the issue
#3 disposition in the PR/change description") sit at the true end of the task list, where a
PR-description step belongs. Sections 1 and 2 have no ordering dependency on each other or on 4.1,
so 1 → 2 → 4 → 3 is a clean fix; 4.1 itself has no prerequisites and could technically run first,
but keeping it after the content it references (18-event list, D2 placement) stay grounded in
Sections 1-2 is reasonable and not worth disturbing further.

## Everything else checks out

- 3.2/3.4 correctly follow 1.1/2.1 (they verify content that must already exist) and correctly
  reference only the `audit-logging-operations` spec delta's three requirements — I confirmed that
  delta file already exists at `specs/audit-logging-operations/spec.md` and does not cover 4.1's
  `first-access/spec.md` edit, so no forward-dependency gap there.
- 4.1 has no real dependency on 1-3; it's an independent doc reorganization. Fine where it sits
  content-wise, only the Section 3/4 ordering relative to it is the issue (Finding 1).
- No application code change reintroduced: 2.1 is explicitly comment-only ("No other lines in this
  file change"), consistent with design.md's D1/non-goals. Confirmed no other task touches
  `packages/backend/src` beyond the single comment insertion.

## Recommendation

Swap Section 3 and Section 4 (renumber to 1, 2, 3=spec traceability, 4=verification), and update
what-will-become-4.1 (the diff-scope check) to list all three touched files:
`docs/deployment.md`, `audit-logger.ts` (comment-only), and `openspec/specs/first-access/spec.md`
(Resolved-subsection reorganization, no requirement-text change).
