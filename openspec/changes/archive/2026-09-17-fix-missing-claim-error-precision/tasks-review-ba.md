# BA Review — Tasks: fix-missing-claim-error-precision

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `tasks.md` against `proposal.md` (and, where tasks reference them, `design.md` and `specs/first-access/spec.md` delta)
**Question asked of me:** Do the tasks, taken together, cover all capabilities in the proposal? Is anything lost in translation from requirements to tasks?

---

## Overall

Full coverage, nothing lost. I traced all nine numbered items in `proposal.md`'s Acceptance Criteria section against `tasks.md` line by line, and every one lands on a specific task:

| Acceptance criterion (proposal.md) | Task(s) |
|---|---|
| 1. Null claims → `MissingClaimError("id_token")` | 1.1 |
| 2. `auditFields.missingClaim === "id_token"` for that case | 1.1, 2.1 |
| 3. `sub`-absent branch unchanged | 1.1, 2.2 |
| 4. `iss`-absent branch unchanged | 1.1, 2.2 |
| 5. `mapAuthError` / redirect message unchanged, no diff, no `err.claim` branching | 1.2, 4.3 |
| 6. Test assertion tightened to `.toBe("id_token")` | 2.1 |
| 7. Spec scenario split (Null claims object / Missing or empty sub claim) | 3.1 |
| 8. `#7` moved Open → Resolved | 3.2, 3.3 |
| 9. `#4`/`#6` not reopened or touched | 3.4, 4.3 |

I also checked the four "What Changes" bullets in `proposal.md` independently (not just the AC list, in case something in prose didn't make it into a numbered criterion) — all four are covered by the same task set above. Nothing in "What Changes" exists that isn't traceable to at least one AC and at least one task.

I spot-checked the two places where a task's *wording* has to match a source exactly rather than paraphrase it, since that's where translation loss usually hides:

- **Task 3.1** ("exact text already drafted in the delta file") — I compared `specs/first-access/spec.md` (delta) against the live `openspec/specs/first-access/spec.md` (lines 91–100). The delta's unchanged requirement paragraph, the new "Null claims object" and "Missing or empty sub claim" scenarios, and the untouched "Missing iss claim" scenario are exactly what task 3.1 describes doing. No drift.
- **Task 3.3** ("matching the existing `#2`/`#3` format exactly") — I checked the live Resolved section (lines 218–219): `- **#2** — closed (oidc-error-log-sanitization) — [Security] ...` / `- **#3** — closed (audit-logger-transport-filtering) — [Security] ...`. The line task 3.3 specifies to add follows that format precisely, including the parenthetical change-name convention.

Neither check turned up a gap between what the proposal says should happen and what the task says to do.

---

## Two tasks beyond the nine ACs — checked, not scope creep

Tasks 1.3 (JSDoc third example on `MissingClaimError.claim`) and 4.4 (PR description note re: external SIEM/alert consumers of `missingClaim: "sub"`) aren't required by any of the nine acceptance criteria. I checked `design.md`'s Review section before flagging these as untraceable additions — they're not: both are documented there as non-blocking notes from the Engineer and Security reviewers, folded into `tasks.md` deliberately. That's exactly the kind of paper trail I want to see — a task that isn't in the AC list should point back to *something*, and these do. No concern.

One thing worth naming explicitly, since it's the kind of thing that becomes a scope dispute later if unstated: `proposal.md`'s own Impact section says "no downstream comms step is needed," while task 4.4 adds a one-line comms step anyway (the PR note). This isn't a contradiction — `design.md`'s Risks section reconciles it directly (in-repo grep found no consumer, but can't see outside the repo, hence the low-cost heads-up) — but a reader who only reads `proposal.md` and not `design.md` could see it as tasks contradicting the proposal. Non-blocking; I'd only act on this if `design.md` weren't already carrying the explanation, which it is.

---

## Negative-scope items — carried forward correctly

The persona risk I watch for on every review is a requirement's *negative* scope (what must NOT change) getting dropped when it becomes a task, because negative scope is easy to omit without anything looking obviously missing. Here it survived intact:

- "Do not touch the `sub`/`iss` branches" → task 1.1's explicit instruction not to touch them, reinforced by 2.2's confirmation the sibling tests are unchanged.
- "Do not modify `mapAuthError`" → task 1.2, reinforced by 4.3's diff check.
- "Do not reopen `#4`/`#6`" → task 3.4, reinforced by 4.3.

All three negative-scope statements in `proposal.md` appear as their own tasks, not folded silently into a positive task where they'd be easy to lose on a re-read six months from now.

---

## Requirements-layer check

Same as my proposal-stage review: this stays below the `requirements/` layer. Nothing in `tasks.md` implies a change to the Identity and Access use cases, and I found nothing in `tasks.md` that a facilitator- or participant-facing requirement would need to know about (confirmed again here since `mapAuthError` and the redirect message are the tasks that would surface any user-facing change, and both are explicitly "no diff" tasks).

---

## Bottom line

No gaps. All nine acceptance criteria and all four "What Changes" bullets map to specific tasks; the two tasks beyond the AC list are traceable to documented reviewer feedback in `design.md`, not undocumented scope creep; and the proposal's negative-scope statements (what must stay unchanged) each got their own task rather than being implied. Approve `tasks.md` as ready for implementation.
