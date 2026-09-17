# Task Review — Business Analyst (Marcus Delgado)

**Change:** `restrict-team-005-em-promotion` (GitHub #109)
**Stage:** 4 — Task Review
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-09-16

## Verdict

**Blocking issues found — 2.** Both are the same failure mode this proposal exists to close (a document asserting behavior that no longer matches the code, left for the next reader to trust in good faith), found in two places tasks.md doesn't currently reach. Everything else I checked is well covered.

## Prior blocking issue — confirmed still resolved

I previously flagged that `REST API Contract.md` and its `Validation Report.md` documented the pre-fix, EM-only-restriction behavior as settled and said nothing about Application Admin, which — read literally — documented admin-initiated promotion via TEAM-005 as permitted. Tasks 5.5 and 5.6 incorporate this correctly and are still intact:

- Task 5.5 explicitly requires rewriting the line-421 constraint to state the **unconditional** block "covering all actors, including Application Admin," ties it to task 1.1's resolution, and correctly notes the Full Stack Engineer's finding that the code never implemented the EM-only version either — so this is a documentation write, not a reversal.
- Task 5.6 requires a dated addendum to the Validation Report correcting OQ-6's actor scope, framed as "removing an ambiguity that was never actually resolved," not overturning a considered decision, and correctly preserves the append-only convention (new dated entry, not an in-place rewrite).

No stale "EM-only" or contingent language remains in either task. This resolution held.

## Fresh coverage pass — design decisions A–G reflected in task text

Checked §2/§3/§4 specifically for stale contingent/open-question phrasing left over from before the design review resolved Decisions B, E, F, G:

- **Decision B (block all actors, including Application Admin):** Task 3.2 states this unconditionally ("no actor-role branch... Blocks Application Admins and EM actors alike"). Task 4.4 correctly reframes the admin test case as settled, not conditional — this matters because proposal.md's own Impact section (line 35) still lists the admin-actor test as "conditionally... pending the design.md decision," which is now stale in proposal.md itself. Tasks.md does not inherit that staleness — worth a proposal.md touch-up but not blocking, since design.md and tasks.md are the operative documents at this stage.
- **Decision E (graceful degrade + log-only signal):** Task 2.3 states the resolution directly and correctly omits a synchronous audit_log row, matching Decision E's reasoning about call volume. Good.
- **Decision F (required blocked-attempt audit event):** Task 3.4 is unconditional, with the correct field list and the `denyAdminContentAccess` precedent. Good.
- **Decision G (detection control, not a trigger):** Task 1.5 accurately records the resolution and correctly redirects the follow-through into task 1.6 rather than inventing a new one. Good.
- Tasks 1.1–1.3 and 1.5 are marked `[x]` with resolution text embedded directly in the task line, so a reader of tasks.md alone (without opening design.md) gets the current, correct scope. This is exactly the traceability property I look for.

No stale references found in tasks.md §2–§4. **However**, I found the equivalent staleness one layer down, in the spec deltas tasks.md is supposed to be implementing — see Finding 1.

## Finding 1 (Blocking): `specs/team-content-access/spec.md` still frames Decision E as an open question

Line 32 of `specs/team-content-access/spec.md` reads:

> "How this state is handled (graceful `participant`-level access with a distinguishable audit/log signal, versus an outright deny) is an open design decision tracked in this change's design.md and is not finalized by this requirement..."

This is now false. Design review on 2026-09-16 resolved this as Decision E, and task 2.3 correctly implements the resolution. But the spec delta itself — the artifact that becomes the canonical requirement text when this change is archived into the main specs — still says the opposite: that it's unresolved. Nothing in tasks.md updates this file. An implementer or QA reviewer who reads the spec delta instead of (or in addition to) tasks.md would reasonably conclude the mismatched-state behavior is still an open call, which contradicts task 2.3's unambiguous instruction.

This is the identical failure mode the proposal names as its own cause: "a document asserting incorrect behavior as intentional, for the next engineer to trust in good faith" (proposal.md, What Changes) — just found in a spec delta rather than requirements/design docs. Recommend adding a task (§1 or §2) to correct this paragraph to state Decision E's resolution directly before implementation sign-off, the same way tasks 5.5/5.6 correct the other stale documents. I checked `specs/role-assignment/spec.md` for the same pattern and found none — it's fully resolved and consistent with Decisions B and F.

## Finding 2 (Blocking): Task 5.1's UC rewrite is scoped too narrowly — the zero-Engineers warning flow is also now stale

`requirements/use cases/01 - Identity and Access - Use Cases.md`, UC "Assign a Role to a Team Member," has three passages tied to the *promotion* path through TEAM-005 that task 5.1 doesn't touch:

- **Main Flow step 2** ("selects a new role... Engineer or Engineering Manager") and **step 4** (the zero-Engineers warning) describe a role selector that can still promote — no longer true for TEAM-005 once this ships.
- **AC4** ("A role change to `engineering_manager` that would leave the team with zero `participant`-role members displays the message...") — currently checked off (`[x]`) as accepted, implemented behavior. Demotion (the only transition TEAM-005 retains) strictly *increases* the participant count, so this warning can never fire through TEAM-005 again.
- **Alternate Flow "Role change would leave zero Engineers"** (line 204) — same reachability problem.

I confirmed this against the code, not just the design docs: the zero-participant guard (`teams.ts:832-838`) lives only in TEAM-005's transaction block. TEAM-006's handler (`teams.ts:940` onward) has no equivalent check, and per design.md's own Decision G discussion, TEAM-006's upsert *can* promote an existing participant on their own team to EM (not just onboard a brand-new member) — meaning after this ships, the **sole remaining promotion path has no zero-Engineers warning at all**. That's a real, user-facing loss of a safety property this proposal doesn't name anywhere (not in Risks/Trade-offs, not in Non-Goals, not in tasks.md), and it isn't something task 4.7's "leave the dead code in place, defensively" resolution addresses — that resolution is about the code path, not about whether the *user-facing warning* still exists anywhere reachable.

I'm not asking this proposal to add a zero-Engineers guard to TEAM-006 — design.md's Non-Goals explicitly rules out new EM capabilities, and that's a reasonable line to hold. But the requirements documentation must say so on purpose, not by omission:
- Task 5.1 needs to also address Main Flow steps 2/4, AC4, and the existing zero-Engineers Alternate Flow — reopen AC4 as unchecked and rewrite it (and the Main Flow/Alternate Flow text) to reflect that this warning is specific to the demotion-only flow TEAM-005 now has (i.e., it no longer applies, since demotion can't trigger it), or
- If the team decides TEAM-006 should carry an equivalent warning, that's a scope decision for whoever owns Non-Goals (Solution Architect / Product), not something to leave implicit.

Either way, this needs a recorded decision the same way Open Questions 6 and 7 do ("even 'no action needed' should be a recorded decision, not a silent gap") — right now it's neither decided nor flagged as open. This is exactly the "edge case discovered late becomes a scope dispute" pattern I watch for.

## Everything else — coverage confirmed

Checked tasks.md against every proposal.md "What Changes" bullet and the Impact section:

- Read-side fix (Path 1 removal, comment correction, dual regression tests) — tasks 2.1–2.5, fully covered.
- Write-side fix (unconditional block, ordering, redirective error, audit event, demotion regression, no-config-escape verification) — tasks 3.1–3.6, fully covered, and all cross-references to design.md decisions are current, not stale.
- Regression suite (four scenarios from exploration §6, plus the three tests that pin the removed behavior) — tasks 4.1–4.7, fully covered; task 4.7's rationale for keeping the dead zero-participant guard code (rather than deleting it) is sound and matches design-review-engineer.md's recommendation.
- Requirements-doc correction, both document sets — tasks 5.1–5.6, covered except for Finding 2 above.
- Sign-off — tasks 6.1–6.3 cover the load-bearing decisions (1.1–1.3, error copy, no-admin-exception, demotion, doc correction). Minor, non-blocking observation: no sign-off task names who confirms tasks 1.6 (detection/backfill query) or 1.7 (historical mislabeling decision) were actually acted on — both are explicitly non-blocking for shipping per design.md, so I'm not elevating this, but whoever closes out task 1.6 within the timeboxed sprint (per the Executive Stakeholder's ask) should have a sign-off line, not just a task checkbox.

## Summary of asks

1. Add a task to correct `specs/team-content-access/spec.md:32`'s stale "open design decision... not finalized" language to state Decision E's resolution.
2. Expand task 5.1's scope to cover Main Flow steps 2/4, AC4, and the "Role change would leave zero Engineers" Alternate Flow in the Use Cases doc — or explicitly record the decision that TEAM-006 does not need an equivalent warning, if that's the team's call.

Neither finding blocks starting implementation of the core code fix (Decisions A/B, tasks 2–4) — both are documentation-completeness gaps, same as the ones this proposal was written to close. I'd want them resolved before this change is archived and its spec deltas become the canonical record, the same bar tasks 5.5/5.6 were held to.
