# BA Review — Proposal, Phantom EM Relationship Detection (#117)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `proposal.md`, `design.md`, `tasks.md`, `specs/phantom-em-relationship-detection/spec.md`
**Prior review on record:** `explore-review-ba.md` (exploration-notes.md, 2026-09-29)
**Date:** 2026-09-29

## Overall

I reviewed the exploration notes for this same change earlier in this pipeline and raised five points, one of them blocking. My job here is narrower than a fresh read: check whether those five points actually made it into the proposal package as buildable requirements, or whether they got restated as prose and left for someone downstream to re-derive. With one exception (§6 below), they did. This is a case where the propose stage did its job — several of my suggested sentences appear close to verbatim as stated acceptance conditions, not just acknowledged and left implicit again.

I am not re-raising points 1 through 5 from scratch. Below, each one is checked against where it actually landed.

---

## 1. `actor_user_id` / `actor_global_role` — carried forward correctly, appropriately still open

**Disposition: carried forward correctly.** This is now a named decision — "Decision J" — in `design.md`'s Open Questions section, with an owner (Solution Architect), a candidate resolution matching what I suggested (operator's real `users.id` as a mandatory parameter with no default; a fixed literal for `actor_global_role`), and the exact testable acceptance condition I asked for: the script fails or refuses to run if `actor_user_id` isn't supplied. `proposal.md`'s "What Changes" section names it explicitly as a decision carried forward for "Stage 3 design review," and `tasks.md` 1.1 tracks it as a task that blocks 3.3 and 3.4.

I originally asked that this be resolved in `design.md`, not left open. It is still open here — but design.md's own framing (deferring to a Solution Architect design-review stage that hasn't happened yet in this pipeline) is the same pattern the archived `restrict-team-005-em-promotion` design.md used for its own Open Question 4, and it's a legitimate escalation path, not a dodge: the person writing this proposal doesn't hold Solution Architect authority "in this capacity" (their own words). What matters is that it's no longer resolvable-by-inference — it's named, owned, and blocking. That satisfies the concern.

---

## 2. Two-query framing (non-reconciliation, `removed_at`) — carried forward correctly

**Disposition: carried forward correctly, close to verbatim.** `design.md` Decision 4's acceptance condition states the `removed_at IS NULL` refinement explicitly, with the reasoning ("a removed row cannot be a live phantom grant"). Decision 5's acceptance condition states the non-reconciliation fact explicitly, with the phantom-promoted-then-demoted example. Both also appear as scenarios in `spec.md` ("Detection script excludes removed memberships"). Neither is an inference from SQL anymore.

---

## 3. Idempotency guard acceptance test — carried forward correctly, now operationalized

**Disposition: carried forward correctly, and improved.** Decision 6's "Verification method" paragraph states the two-run-against-fixture-data bar explicitly, including my point that code-review-by-inspection isn't sufficient. `tasks.md` 4.1–4.4 turn this into actual tasks: stand up fixture data, run the annotate script, confirm expected inserts, run it a second time, confirm `new_annotations_inserted | 0`. `spec.md` carries the same bar as a named scenario ("Idempotency is verified before handoff, not assumed from inspection"). This went from a suggestion in exploration review to a task list a reviewer can check off — exactly the gap I flagged.

---

## 4. Deliverable boundary (file structure, result-record location) — carried forward, with one improvement over my own suggestion

**Disposition: carried forward correctly.** File names, count (two, not one), and the exact filename convention are stated in `proposal.md` and built out in `design.md` Decision 1. Note: Decision 1 explicitly rejects the single-file-with-section-headers structure I suggested in exploration review, in favor of two separate files — and the reasoning is sound (a single `psql -f` file runs top to bottom with no enforced pause between the read and the write; two files make the operator's second, deliberate invocation structural rather than a documented convention someone could skip). This is a case of the propose stage improving on my suggestion rather than dropping it; I'd rather have this outcome than the one I originally proposed.

The result-record location and field list came through as I asked: `query-result.md`, named, with the exact field list, operationalized as `tasks.md` 5.1. The code-review acceptance criterion for "no UPDATE/DELETE" also landed, in the Decision-C style I suggested, in `tasks.md` 2.4 and 3.5, and as a spec scenario.

---

## 5. "Who was notified" — carried forward correctly, appropriately still open

**Disposition: carried forward correctly.** Design.md's Open Question 2 names the gap, proposes a default (Executive Stakeholder role holder) without assuming it, states the escalation-not-remediation sentence I asked for, and assigns an owner (Solution Architect or Executive Stakeholder). This mirrors the treatment of point 1 above — appropriately deferred to a later design-review stage rather than resolved here, but no longer an unscoped gap someone could improvise around.

---

## 6. New finding — broken task dependency reference (`tasks.md` 1.2 → "Task 4.1")

This wasn't a concern I raised before; it's a defect in how point 5 got operationalized in `tasks.md`, and it's worth fixing before this moves further.

`tasks.md` 1.2 reads: *"...Task 4.1 below depends on this being resolved."* Task 4.1 is *"Stand up a non-production schema copy or fixture data reproducing the phantom-relationship shape"* — a verification-fixture task with no relationship to the notification recipient decision. The task that actually depends on the notification recipient being named is 5.3 (*"Hand off both scripts...referencing...named notification recipient"*), and arguably 5.1 (the `query-result.md` template has a notification-recipient field). Compare this to 1.1's parallel reference, which correctly points at 3.3/3.4 — the actor_user_id decision really does gate those tasks.

This is a small fix (change "4.1" to "5.1 and 5.3" in `tasks.md` 1.2), but I'd rather flag it now than have it surface as a "wait, why does this task block that one?" question during implementation — which is exactly the kind of thing this pipeline's earlier deadline slip (#109's task 6.4 → this whole change existing) should make everyone allergic to. Task cross-references in a proposal about closing a follow-up-tracking gap should not themselves have a broken follow-up reference.

---

## Requirements cross-check

This change has no direct counterpart in `requirements/` — those documents govern the Engineering Health Check ritual (voting, reveal, facilitator/participant views, action items), and this change is backend audit-integrity tooling with no user-facing surface. I don't have a requirement in that set to trace this against, and I don't think one is missing; this is appropriately scoped as an internal ops artifact, not a ritual feature. Noting this only so it's clear the absence of a `requirements/` citation here is a scope observation, not an oversight.

---

## Summary

| Point (from exploration review) | Disposition |
|---|---|
| 1. `actor_user_id`/`actor_global_role` (blocking) | Carried forward correctly — named Decision J, owned, testable condition stated, appropriately still open pending design-review stage |
| 2. Two-query framing (non-reconciliation, `removed_at`) | Carried forward correctly, near-verbatim |
| 3. Idempotency acceptance test | Carried forward correctly, operationalized into `tasks.md` 4.1–4.4 |
| 4. Deliverable boundary (files, result location) | Carried forward correctly; two-file decision improves on my own suggestion |
| 5. "Who was notified" | Carried forward correctly — named, owned, escalation-not-remediation stated, appropriately still open |
| 6. (new) broken task cross-reference | Not yet fixed — `tasks.md` 1.2 should point at 5.1/5.3, not 4.1 |

Nothing here is a reason to send this back to propose. Point 6 is a five-minute fix in `tasks.md`. Everything else I raised at exploration made it into this package as a stated, checkable condition rather than a restated concern — this is the outcome I want to see from this pipeline, and I'd sign off on the substance once 1.2's reference is corrected.
