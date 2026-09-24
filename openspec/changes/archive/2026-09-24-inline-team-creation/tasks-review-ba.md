# Business Analyst Review — Tasks Stage, Inline Team Creation (#44)

**Reviewed by:** Marcus Delgado (Business Analyst)
**Reviewing:** `tasks.md`, `proposal.md` (both post-design-review)
**Cross-referenced:** `design.md` (incl. `design-review-engineer.md` / `design-review-security.md` dispositions), `specs/session-creation/spec.md`, `specs/default-topic-provisioning/spec.md`, my own `propose-review-ba.md`, and `requirements/use cases/02 - Session Setup - Use Cases.md`

---

## Overall

This is a strong pass. Both items I asked to be tightened at propose stage (§1 and §4 of `propose-review-ba.md`) were actually tightened, not just acknowledged — the prerequisite gate is now a real test (4.4) instead of a manual checklist step, and 8.1 carries the ready-to-paste addendum text with an explicit merge-wave trigger. The four design-review-driven additions the team lead asked me to check all trace cleanly back to spec requirements. I found two real coverage gaps worth closing before implementation starts, and they're both narrow — nothing here calls the plan back to design.

---

## 1. My propose-stage asks: both closed out correctly

**§1 (prerequisite gate must be a real test, not a checklist item):** Closed. Task 4.4 is exactly the fix I asked for — a real-data query against the actual migrated test database, asserting all twelve AC-verbatim prompts (plus vote_type, display_order, first_session_description ordering), which fails by design against the current six-topic seed. Task 1.1 now also names the prerequisite artifact concretely (`fix-default-topic-seed-data`, stub path given) rather than presuming something to check against. Good — this was my one real blocker at propose and it's resolved with a mechanism, not a promise.

**§4 (8.1 needs the actual addendum text, gated to this change's merge):** Closed. Task 8.1 contains the full Main Flow addendum (numbered continuation after step 10, cross-referencing the existing-team flow's own addendum by name) and the full Postconditions replacement (Success/Failure lines), matching the established pattern from "Create Session for Existing Team"'s own "Addendum (draft-landing decision)" line-for-line in structure. It is explicitly gated: "Land this in the same PR wave that merges `inline-team-creation` — not as a separate tracked follow-up." I also like the added instruction to update the illustrative quotes if shipped copy diverges — that's the right hedge against the addendum going stale the moment 5.4/5.7's copy is finalized.

---

## 2. The four design-review-driven additions: all map to spec, none are orphaned

- **4.4 (real-data integration test):** Enforces the merge-gate proposal.md and design.md D7 both describe. Not itself a `default-topic-provisioning/spec.md` requirement (that spec is content-agnostic — it says "copy whatever's flagged `is_default`," not "copy twelve rows"), but it doesn't need to be; it's the mechanism that makes task 1.1 and design.md's Risk #1 mitigation actually true instead of aspirational. Correctly scoped.
- **3.2a (audit row on 403 denial):** Maps directly to `session-creation/spec.md`'s "Non-facilitator caller is rejected" scenario ("AND an `audit_log` row is written identifying the actor, the actor's global role, and the actor's IP") and design.md D3's Finding-F1 writeup. Event name (`team.creation_denied_role`) is consistent between tasks.md, design.md, and is tested in 7.1.
- **7.1's security-critical annotation + concurrency test:** Maps to `session-creation/spec.md`'s "Team creation does not establish membership" requirement and design.md D6. The design.md text is explicit that this is a *lower-rigor safety net* than D4's database-level constraint ("no row was ever inserted" has no `CHECK` equivalent) — which is exactly why the task correctly elevates it to a commented, named-invariant test rather than an ordinary assertion. Good match between the stated risk and the enforcement task.
- **3.9 (typed `TeamNameCollisionResponse`):** Matches `session-creation/spec.md`'s uniqueness requirement ("a typed collision response... distinguishable... by its `errorState` discriminant, not by message text") and design.md D2 verbatim, including the exact shape (`errorState: "team_name_collision"; providedName: string`) and its stated siblings (`SessionAlreadyExistsResponse`, `RevealFailureResponse`).

---

## 3. Explore-stage resolved ACs: all four still have concrete implementation tasks

| Resolved AC | Task | Test |
|---|---|---|
| Name-echo confirmation | 5.4 | 7.2 "name-echo label updates with input" |
| Landing acknowledgment | 5.7 | not explicitly listed in 7.2 — see §4 below |
| Empty-state copy | 6.1, 6.2 | 7.2 "empty-state copy and affordance" |
| Pre-submit safety | 5.5 | 7.2 "back-navigation safety (no request fired, and `newTeamError`/`confirmError` both cleared)" |

Three of four have an explicit paired test task; the fourth (landing acknowledgment) is implementation-covered but not named as its own test assertion. Flagged below.

---

## 4. Two coverage gaps — narrow, worth a task-list edit before implementation starts

**(a) No task tests that a non-facilitator gets an identical rejection regardless of whether the submitted name collides.** `session-creation/spec.md`'s check-ordering requirement has its own scenario for this: *"A non-facilitator caller cannot probe name existence... the response does not indicate whether the submitted name collides with an existing team."* This is the direct behavioral consequence of design.md D8 (check order is now a spec-level requirement specifically so a future refactor can't invert it silently) — but 7.1's non-facilitator test item doesn't specify submitting a name that happens to already exist and asserting the response is byte-identical to the empty-collision case. Without that specific test, D8's own stated purpose (bounding the enumeration surface) has no regression coverage — the same failure mode D8 exists to prevent in the ordering itself could reappear in the response shape without any test catching it.

*Recommend:* add to 7.1: "non-facilitator rejection using an already-taken team name, asserting the response is identical (status and body) to the non-facilitator rejection with a fresh name — no signal of collision leaks pre-authorization."

**(b) `default-topic-provisioning/spec.md` has two scenarios with no corresponding test task.** The requirement's own text is explicit that the copy must be "a real, independent row per topic — not a reference," with two scenarios spelling out why: editing a team's copied topics doesn't affect the sentinel rows or any other team, and a later change to the canonical defaults doesn't retroactively affect an already-created team. Neither scenario has a task in section 4 or 7 that exercises it. I recognize the mechanism (`INSERT ... SELECT`, D5) structurally guarantees this by construction — there's no FK, so drift is architecturally impossible, not just untested-but-probably-fine. But this is also exactly the kind of guarantee that a well-meaning future refactor (e.g., someone "optimizing" the copy into a view or a lazy-materialized reference for performance) could quietly break without any test noticing, and it's the load-bearing property the entire requirement is written around.

Relatedly: task 4.3 (fixture-based mechanism test) asserts "by count and by prompt text" — narrower than the full field set the spec requires copied unmodified (`name`, `prompt`, `vote_type`, `display_order`, `is_default`, `first_session_description`). Only 4.4 (real-data test) checks the full field set, and 4.4 is scoped to the twelve-topic content, not to mechanism correctness against an arbitrary fixture. So there's a real seam: if someone weakens 4.4 later (or it's skipped in a fast test run), nothing else asserts the copy mechanism itself preserves `vote_type`/`is_default`/`first_session_description`.

*Recommend:* widen 4.3's assertion to the full field set (not just count + prompt text), and add one task — could be small — asserting row-independence post-copy: mutate a copied topic (or delete it) and confirm the sentinel team's source rows are unaffected. This doesn't need to be an elaborate test; a single assertion after the copy proves the "own row, not a reference" property directly rather than relying on the absence of an FK being self-evidently correct forever.

**(c) 7.2 doesn't name the landing-acknowledgment copy as its own assertion.** Minor, paired with the table in §3. "Happy path" likely exercises reaching the lobby view, but doesn't guarantee the acknowledgment text is asserted specifically (vs. just "did not error"). Given 5.7's copy is itself a stated requirement with its own spec scenario ("Landing view acknowledges team creation and topic assignment"), I'd want it named as its own line in 7.2 rather than folded silently into "happy path," the same way 5.4's name-echo already gets its own line.

---

## Summary

**No blockers.** Both propose-stage asks are fully resolved with real mechanisms. The four design-review-driven task additions all trace to a spec requirement, and vice versa — I didn't find anything in tasks.md without spec backing, or a spec scenario silently dropped from tasks.md, other than the three items below.

**Wants addressed before implementation, not before propose sign-off (all task-list edits, no spec or design changes needed):**
1. Add an explicit non-facilitator + existing-name test to 7.1, asserting identical rejection to the fresh-name case (closes the one untested D8 consequence).
2. Widen 4.3's assertion criteria to the full copied field set, and add a small row-independence test (mutate/delete a copy, confirm the sentinel rows are unaffected) to close the two untested `default-topic-provisioning` scenarios.
3. Name the landing-acknowledgment copy as its own assertion in 7.2, matching how 5.4's name-echo already gets one.

None of these are new scope — all three tighten an existing task the same way my propose-stage asks tightened 1.1 and 8.1.
