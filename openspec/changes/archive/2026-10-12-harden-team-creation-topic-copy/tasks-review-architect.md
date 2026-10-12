# Tasks Review: Solution Architect (Ingrid Sollenberger)

Change: harden-team-creation-topic-copy (#215). Focus: task ordering against architectural dependencies. Inputs: tasks.md, design.md, proposal.md.

## Verdict

The architecture is sound and the design is explicit. The task list is not yet safe to execute in the order written. Section 4 is a flat bucket that mixes test infrastructure, tests that depend on code from section 2, and one test (4.9) that will go red the moment 2.2 lands. Four tasks assume something that no task builds. I recommend the reorder and splits below. None of this needs a design change.

## Blocking findings (assumes something not built)

**B1. 4.3a assumes a "helper" that no task creates.** 4.3a says "The helper throws before BEGIN unless NODE_ENV === test and DATABASE_URL host is localhost/127.0.0.1". No task builds that guard helper (4.0 builds only `withTemplateLock`). Add a task, ordered before 4.3a: "test helper `withDroppedActiveOrderIndex` (or similar): guard, BEGIN, `SET LOCAL lock_timeout`, DROP INDEX, always ROLLBACK and release in `finally`". It is also where the guard has to be unit-tested, since a guard that is never exercised is nominal.

**B2. 4.4's "failing check does not fail creation" test has no seam.** The route calls `readTemplateTopicFacts(db)` directly. Nothing in 2.3 says how a test makes it throw. Options: `vi.mock` of the module, or an injectable dependency on the route plugin. Pick one in 2.3 (this is a design-of-code decision, so make it before the route is written, not during testing). Without it the implementer will invent one, or drop the test.

**B3. 4.9 (C9) is mis-ordered; the existing regression test breaks at 2.2.** `template-team-creation-regression-integration.test.ts` compares all-status defaults and un-renumbered positions. After 2.2 it can fail for reasons unrelated to the change, and the stale expectation will mask real regressions during development. Move 4.9 to immediately after 2.2 (same commit), not the end of section 4.

**B4. 4.10(f) needs a baseline-derivation step that is not a task.** The content hashes must be computed from migrations 4 and 11 and the requirements list, with a fallback if the prompt text is missing. That is research with a possible design-level outcome (which source is authoritative). Make it its own task before 4.10: "derive baseline names and hashes; record source and any fallback in the file header". Otherwise 4.10 hides an unbounded step.

**B5. 2.4 is not an implementation task and depends on 2.2.** "Confirm the zero-active path is unchanged" is verified only by 4.5. As written it can be ticked with nothing behind it. Fold it into 4.5 as an acceptance line, or keep it only as an explicit dependency "after 2.2 and 2.3".

## Required splits

**S1. 2.2 is two tasks.** (a) Implement and export `copyCanonicalDefaults` in `default-topics.ts`; (b) change the route to call it. The function must be testable on its own (4.3a) before the route is rewired.

**S2. 2.3 is three tasks.** (a) `detectTemplateAnomalies` pure function (no dependency on anything else, can be written test-first with the table in 4.4); (b) `readTemplateTopicFacts`; (c) route wiring after COMMIT with the try/catch and log shape. Wiring depends on (a), (b) and on the seam decision in B2. Task 2.3 also has the most security-relevant constraint (ids and codes only, no row text), which deserves its own reviewable step.

**S3. 4.0 is two or three tasks.** `withTemplateLock` (new helper) is independent of retrofitting `default-topic-provisioning-integration.test.ts` and of the log-capture pattern note. Retrofitting the existing test is a modification of shared tests and should land first, in the same change as the helper, before any new template-mutating test is added. The "delete extra rows in `finally`" and "do not change name/prompt/..." rules are conventions, not tasks; move them to a checklist the reviewer applies to 4.2 through 4.8.

**S4. 4.4 is three tasks.** Integration (one warn per anomaly type, two creations give two entries, healthy gives none, key set exactly pinned, correlationId equals reqId); unit table for the detector; failing-check test. They depend on different code (2.3c, 2.3a, 2.3c plus the B2 seam) and the unit table should be written with 2.3a.

**S5. 4.3 is overloaded.** It covers C4 and C11 template cases, collision, single-default, same-name and NULL description. Split into positions (C4) and column fidelity (C11). They share only the lock helper.

## Reordering

Proposed order (dependency chain, not just numbering):

1. Prep: 1.1 done. 1.2 (D7 data check) is a merge gate, not a build prerequisite. Keep it early only if its result could change scope; per the proposal it cannot, so move it to section 6 as a pre-merge gate and let work start in parallel. Note it needs live read access: name who has that access, since the implementing team may not.
2. 2.1 fragment builder, then 4.3b (its unit tests) immediately.
3. 4.0 lock helper and retrofit of the existing provisioning test; 4.1 snapshot helper reuse.
4. 2.2a function, then B1 guard helper, then 4.3a (function-level duplicate test).
5. 2.2b route rewiring with 4.9 (C9) in the same step; then 4.2, 4.3 (split), 4.5, 4.8.
6. 3.1 restore-list rewrite (needs only 2.1; can run in parallel with step 5), then 4.6 and 4.7. 4.7 (C7) requires both 2.2b and 3.1 done, since it asserts the two consumers agree. State that dependency explicitly.
7. 2.3a, 2.3b, B2 decision, 2.3c, then the three 4.4 pieces.
8. B4 baseline derivation, then 4.10.
9. Section 5 (see below), then section 6.

## Other findings

**O1. 4.3a lock interaction.** `DROP INDEX topics_team_active_order` takes ACCESS EXCLUSIVE on `topics`. The design serializes only template-mutating tests with `withTemplateLock`; tests that merely create teams do not take it, and they write to `topics`. A parallel creation test can therefore block on the drop or hold the drop past its 2 s `lock_timeout`, producing the flake the design warns about. Either run 4.3a under `withTemplateLock` and accept that team-creating tests elsewhere may still collide (state it as a known residual), or document that this file must be last/isolated. This needs a conscious decision, not an assumption.

**O2. 4.10 invariant (e) is a duplicate of migration 23 CHECKs**, acknowledged in the design. Fine, but keep it last in the file so a failure in (a) to (d) is reported first.

**O3. Section 5 sequencing.** 5.1 is a confirmation of text already written; fold into 6. 5.2 states "F5 also updates the invariants baseline", which presumes 4.10 exists; order 5.2 after 4.10. 5.3 and 5.4 name `template_anomaly`, so after 2.3c. All of section 5 must be done before merge, not after, because the declined-trigger decision lapses if the F5 lines are lost (design states this). Add that to 6 as a gate.

**O4. Missing operability task.** The design accepts that the warn log is only a signal if someone reads it and defers alerting. At minimum I want a short runbook entry (one paragraph, in the existing operations docs) saying what `template_anomaly` and `template_anomaly_check_failed` mean, how to look at the template rows, and who repairs it. I will not sign off production readiness without a basic runbook for foreseeable failures; this one is foreseeable. Add to section 5.

**O5. 6.1a validate spec deltas late.** Run `openspec validate --strict` as soon as the specs exist, not at the end. It is cheap and a header mismatch (MODIFIED vs ADDED) is an ordering hazard for archiving. If the CLI is unavailable, record it as a pre-archive gate with a named owner.

**O6. 6.2/6.2a/6.3** are correctly last. 6.3 (browser spot check) depends on every code task; it is also the only check that exercises restore end to end, so do not let it be skipped if 4.6 passes.

## What is fine

- 2.1 first, then consumers: correct. 3.1 depending only on 2.1 is correct and allows parallel work.
- Putting the anomaly read after COMMIT on the pool is well reasoned and the tasks reflect it.
- No migration, no frontend, no shared package: confirmed by 6.2 and consistent with the boundaries I care about.
- Declining the trigger is acceptable provided the F5 lines are in place before merge (see O3).
