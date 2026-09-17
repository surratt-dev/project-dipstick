# BA Review: tasks.md — auth-audit-correlation-fields

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-09-17
**Verdict:** Buildable, with one specific gap between proposal.md's AC1 and tasks.md's operationalization of it. Not blocking for this change's scope, but it should be an explicit, acknowledged decision rather than a silent gap — see finding below.

This is a continuity check on top of my propose-stage review (`propose-review-ba.md`), which confirmed AC1 (cross-event identity), AC2 (field presence), the join-flow exclusion, and failure-path test coverage were all correctly present in proposal.md/design.md/tasks.md at that stage. tasks.md hasn't changed shape since; this pass re-verifies the checkboxes against current code rather than re-litigating what I already signed off on.

---

## Grounding check (re-verified against current code)

- `correlationId` is minted once via `crypto.randomUUID()` at `auth.ts:119`. Confirmed still true.
- Emit-site line numbers in tasks.md 1.1–1.3 match current code exactly: `auth.callback_received` at line 171, `auth.session_created` at line 279, `auth.success` at line 284. No drift since the proposal was written.
- The catch-all handler (`auth.ts:332–354`) already builds its `auth.failure` audit fields from the same closure-scoped `correlationId` constant — confirmed at line 345. This means task 2.3's assertion (`auth.callback_received`'s `correlationId` equals `auth.failure`'s) will pass by construction once task 1.1 is done; it isn't a coin-flip test.
- The three "missing claims rejection" tests (`auth.test.ts:469–567`, sub empty / iss empty / claims() null) all reject *after* `handleCallback` succeeds, which is after `auth.callback_received` (line 171) has already fired. All three are valid vehicles for task 2.3's failure-path identity check, not just the one tasks.md names as an example.
- The new-user test at `auth.test.ts:408` (`isNewUser: true`, redirect to `/no-team`) is a clean vehicle for task 2.2: it exercises `auth.callback_received` → `auth.session_created` → `auth.success` → `auth.first_access_created` with no join-flow branching in between. Confirmed it doesn't currently capture `correlationId` from anywhere but `auth.first_access_created` (line 458), so task 2.2's extension is additive, not a rewrite.

## AC2 (presence) — fully operationalized, no gap

Task 2.1 maps one-to-one onto AC2's text: `auth.success` and `auth.session_created` each get `sourceIp`/`correlationId` presence assertions, `auth.callback_received` gets a `correlationId` presence assertion (it already has `sourceIp` covered by existing tests). Nothing lost here.

## AC1 (identity) — partially operationalized; one branch of the proposal's own stated scope has no task

This is the finding. Proposal.md's AC1 states the identity invariant applies to:

> `auth.callback_received`, `auth.session_created`, `auth.success`, and **whichever of `auth.first_access_created`/`auth.role_claim_mapped` fires**, and holds on the failure path... as well as the success path.

Tasks.md operationalizes:
- the failure path (task 2.3) — covers `auth.callback_received` → `auth.failure`. Complete.
- the success path (task 2.2) — covers `auth.callback_received` → `auth.session_created` → `auth.success` → **`auth.first_access_created`** only, via "(for the new-user case)."

There is no task anywhere that asserts correlationId identity for the **`auth.role_claim_mapped`** branch — the returning-user-with-non-default-role case. I checked: `auth.role_claim_mapped` is not referenced anywhere in `auth.test.ts` today (`grep` returns nothing). It has zero test coverage at present — not for field presence, not for identity, not at all. Tasks.md doesn't add any. So the proposal's own AC1 sentence names a branch that ships untested.

**Why I'm not calling this blocking:** the `role_claim_mapped` emit call (`auth.ts:242`) already uses the same closure-scoped `correlationId` — it's built the identical way `auth.first_access_created` is, and task 3.2's scope fence prevents anyone from touching that call site as part of this change. So the invariant is almost certainly true by construction, same as the failure-path case. This isn't a "the code is probably wrong" concern.

**Why it's still worth naming out loud:** it's the difference between "AC1 is verified" and "AC1 is verified for one of the two branches the proposal itself says it covers." If a future change touches `role_claim_mapped` (e.g., someone refactors role-mapping logic and fat-fingers a fresh `crypto.randomUUID()` call by analogy with `auth.first_access_created`), nothing in this test suite would catch it, because nothing asserts that branch's correlationId today or after this change ships. That's exactly the kind of silent regression a correlation-id audit-logging change exists to prevent.

**Recommendation:** one of two paths, either is fine by me:
1. Add a task (2.2b or folded into 2.2) that adds a minimal `role_claim_mapped` test fixture — a returning user with a non-default `globalRole` — and asserts its `correlationId` matches `auth.callback_received`'s, the same shape as the existing `first_access_created` assertion. This is a small addition; `role_claim_mapped` has no existing test to extend, so it would be a new test, not a modification.
2. Or, narrow proposal.md's AC1 wording to say the identity invariant is *asserted* for `auth.first_access_created` and *holds by construction* (not independently tested) for `auth.role_claim_mapped`, and note that as a known, accepted gap — consistent with how the "Explicitly out of scope" section already handles other adjacent gaps (join-flow fields, `missingClaim` precision, `session.destroy()` coverage).

Either resolves the mismatch. What I'd flag against is leaving it as-is: proposal.md currently reads as if both branches are equally covered by the test plan, and they aren't.

## Everything else — no new gaps found

- Task 1.1–1.3 map exactly onto AC2's field list and the "do not call `crypto.randomUUID()` again" guardrail from my propose-stage review. Unchanged, still correct.
- Task 3.1 (run the suite) and 3.2 (scope fence: no other emit site/test/type touched) are unchanged from what I reviewed at propose stage and still read as good practice — 3.2 in particular gives the implementer a checkable definition of "did I stay in scope."
- The join-flow exclusion, the `missingClaim` precision note, and the `session.destroy()` gap are correctly left out of tasks.md, consistent with proposal.md's "Explicitly out of scope" bullet. No scope creep, no accidental omission of something that should have been in scope.

## Traceability

GitHub issue #4 → SEC-12 → `auth-error-handling` spec → proposal.md AC1/AC2 → tasks.md 1.1–1.3 (full), 2.1 (full), 2.3 (full), 2.2 (partial — first_access_created branch only, role_claim_mapped branch un-asserted despite being named in AC1's own text). This is the one link in the chain that doesn't fully close; everything else traces end to end.
