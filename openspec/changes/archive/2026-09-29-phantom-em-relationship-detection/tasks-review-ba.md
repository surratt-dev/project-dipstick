# BA Review — Tasks, Phantom EM Relationship Detection (#117)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md`, cross-checked against `proposal.md`, `design.md`, `specs/phantom-em-relationship-detection/spec.md`
**Prior review on record:** `propose-review-ba.md` (2026-09-29) — flagged one blocking-adjacent item (#6, broken cross-reference) and confirmed points 1–5 from exploration review landed correctly
**Date:** 2026-09-29

## Overall

My job at this stage is narrower still: does `tasks.md`, taken as a whole, cover every capability `proposal.md` commits to, and did the two open items I was asked to re-check actually get fixed? Short answer: the previously-flagged broken cross-reference is fixed. Decision 8 is fully operationalized. Decision 9 is operationalized for one of the two artifacts design.md says it belongs in, but not the other — a real gap, not a nitpick, because it's the same failure category ("resolved on paper, not built") that this entire change exists to close.

---

## 1. Previously flagged defect (tasks.md 1.2 → "Task 4.1") — confirmed fixed

`tasks.md` 1.2 now reads: *"Decided by the Solution Architect, 2026-09-29. Tasks 5.1 and 5.3 below implement this."*

That's the corrected reference. 5.1 (the `query-result.md` template, which carries the notification recipient field and Decision 9's fixed sentence) and 5.3 (handoff, which references Decision 9 by name) are the tasks that actually depend on the notification recipient being named — not 4.1, the unrelated fixture-setup task I flagged before. Confirmed fixed, no further action needed here.

---

## 2. Decision 8 (actor identity) — fully operationalized, one minor cross-reference gap

`tasks.md` 1.1 states the resolution (mandatory `operator_user_id` parameter, quoted-literal substitution, identity-echo check, fixed `actor_global_role` literal) and says *"Tasks 3.3 and 3.4 below implement this."*

Checking against design.md Decision 8's four mechanical requirements:

| Decision 8 component | Task that implements it |
|---|---|
| 1. Existence guard (`\if :{?operator_user_id}`) | 3.3 |
| 2. Quoted-literal substitution (`:'operator_user_id'::uuid`) | 3.4 (and referenced in 3.3) |
| 3. Identity-echo sanity check | 3.3 |
| 4. Exact copy-pasteable invocation in the header comment | **3.1** |

Three of four land where 1.1 says they do. The fourth — the exact invocation string, which design.md calls out as its own mechanical requirement ("the header transcribes this, it does not require the operator... to derive it") — is implemented in task 3.1, which 1.1 doesn't cite. This is a much smaller version of the defect I flagged at propose stage: not a *wrong* pointer (3.1 is directly adjacent, in the same section, and unambiguous in context), just an incomplete one. Given this pipeline's specific sensitivity to task cross-references right now, I'd add "3.1" to 1.1's list rather than leave it to be inferred. Not blocking.

---

## 3. Decision 9 (notification recipient) — real gap: one of two required artifacts isn't a task

This is the substantive finding.

Design.md's own text on Decision 9 states the sentence must be carried into **two** places: *"it is carried into the artifacts the operator actually uses — `query-result.md` (Decision 7) **and the annotate script's header** — not left as a design-doc-only boundary."* `tasks.md` 1.2 repeats this exact claim: *"The fixed escalation-not-remediation sentence is defined in Decision 9 and carried verbatim into `query-result.md` and the annotate script's header."*

Checking where that actually becomes a checkable task:

- `query-result.md` → **task 5.1**, explicit: *"include the literal escalation-not-remediation sentence from Decision 9 in the template itself."* Covered.
- The annotate script's header → **no task does this.** Task 3.1 (the task that builds `8_phantom_em_annotate.sql`'s header comment) lists exactly what the header must contain: what it does, the run-after-review note, the Decision I reference, and the exact copy-pasteable invocation string. Decision 9's sentence is not on that list, and no other task in Section 3 adds it.

So `tasks.md` 1.2 asserts a coverage claim ("carried verbatim into query-result.md **and the annotate script's header**") that Section 3 doesn't actually deliver. If someone builds strictly from the task checklist — which is the whole point of a task list, and exactly what I ask the team to be able to do — `8_phantom_em_annotate.sql` ships without the sentence design.md says it must carry, and nothing in the checklist would catch that at review time, because the checklist itself doesn't ask for it.

This matters more than a typical documentation gap here specifically because of what this change is: proposal.md opens by naming #109's task 6.4 — a correctly-identified follow-up that was never operationalized into a tracked action — as the reason this change exists at all. A design decision that says "goes in two places" landing as a task that only builds one of them is the same shape of gap, one level down the pipeline. I don't think this is a reason to send tasks back to design — design.md said the right thing — but I do want it fixed in tasks.md before implementation starts on Section 3.

**Suggested fix:** amend task 3.1 to add, alongside the existing header-comment requirements: *"...and the Decision 9 escalation-not-remediation sentence, for the operator to use verbatim if Query 1 finds anything: 'Query 1 flagged N phantom EM relationship(s) in `<environment>` as of `<timestamp>`. This is a notification, not a request for action — no remediation has been taken and none is authorized by this message.'"* This mirrors exactly how task 5.1 already handles it for `query-result.md`.

---

## 4. Capability coverage — proposal.md against tasks.md, section by section

Going through `proposal.md`'s "What Changes" bullets against `tasks.md`:

| Proposal commitment | Tasks section | Disposition |
|---|---|---|
| `8_phantom_em_detect.sql`, read-only, re-runnable | 2.1–2.4 | Covered |
| `8_phantom_em_annotate.sql`, idempotency-guarded | 3.1–3.5 | Covered |
| Two separate files, never one script, structural pause | Section split (2 vs. 3) + 3.1's separate-invocation framing | Covered |
| `query-result.md` template with named fields | 5.1 | Covered |
| Decision 8 (actor identity) as a concrete, checkable resolution | 1.1 → 3.3/3.4 (+3.1, see §2) | Covered, minor cross-ref gap |
| Decision 9 (notification recipient) as a concrete, checkable resolution | 1.2 → 5.1/5.3 | **Partially covered — see §3** |
| Verified idempotency (not inspection-only) | 4.1–4.4 | Covered |
| New execution deadline (2026-10-08) + non-silent tracking if missed | 5.2 | Covered, matches proposal wording closely |
| Handoff to named operator | 5.3 | Covered |
| "Artifact ready, not checked" completion framing | Implicit in 5.2/5.3's framing; no task literally restates this, but none is needed — it's a completion-criteria statement, not a build step | Fine as-is |

I also checked `spec.md`'s ADDED requirements against the task list — every scenario there (removed-membership exclusion, `operation` collision guard, idempotency, environment sanity check, no-remediation code paths, result-recording template) has a corresponding task building or verifying it. The one gap is the same one flagged in §3: spec.md's own result-recording requirement only describes `query-result.md`'s fields, not the annotate-script-header sentence either — so this gap is consistent across design.md's stated intent, spec.md, and tasks.md all landing on "one artifact, not two." Worth fixing in tasks.md regardless of whether spec.md gets touched.

---

## 5. Requirements traceability

Same note as at propose stage: this change has no counterpart in `requirements/` — it's backend audit-integrity tooling, not a ritual-facing feature, so there's no use case or entity model to trace it against. That's a scope observation, not a gap.

---

## Summary

| Item | Disposition |
|---|---|
| Previously flagged defect (1.2 → "Task 4.1") | **Fixed** — now correctly points to 5.1/5.3 |
| Decision 8 → concrete tasks | Covered (3.1, 3.3, 3.4); 1.1's cross-reference omits 3.1 — minor, non-blocking |
| Decision 9 → concrete tasks | **Partially covered** — `query-result.md` sentence (5.1) is a task; the annotate script's header sentence, which design.md and tasks.md 1.2 both claim is also carried forward, is not a task anywhere |
| Overall capability coverage (proposal → tasks) | Complete, with the one exception above |

Recommendation: fix task 3.1 to include the Decision 9 sentence in the annotate script's header before implementation begins on Section 3. This is a small addition — comparable in size to the fix from my last review — and I'd rather it land now than surface as a gap during Stage 3 implementation review. Everything else here is buildable as written.
