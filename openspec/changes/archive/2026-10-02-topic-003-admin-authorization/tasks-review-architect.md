# Tasks review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact:** `tasks.md` (read with `proposal.md` and `design.md`)
**Focus:** Does the order respect architectural dependencies, can an apply agent finish it on its own, and which tasks need a person?
**Verdict:** **Approve with required changes.** The decisions are sound and the task contents are accurate. I spot-checked them against `topics.ts`, `content.ts`, the parity test and the frontend files. The problems are in the sequencing. As written, several tasks leave the tree uncompilable or red for longer than one task. Three tasks also either cannot be done by an agent or cannot be done during apply. Nothing here changes the design.

---

## 1. Dependency findings (blocking)

### A1. Task 1.2 deletes a constant that is still in use until 1.3

1.2 says to delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` "(no callers after 1.3)". But 1.2 runs before 1.3, and the constant is still passed at `topics.ts:730`, so doing 1.2 as written breaks typecheck. The task also asserts its own precondition in the wrong order.

**Fix:** split 1.2.
- **1.2a** (stays where it is): write the new wrapper's inline 403 copy.
- **1.2b** (moves to after 1.3): delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` and run the "Only a facilitator can add a custom topic" grep.

The simpler alternative is to merge 1.1, 1.2 and 1.3 into one task: add the wrapper, switch the call site, delete the constant.

### A2. The endpoint, the flag and the parity test have to change in one step, but the tasks spread them over three sections

`topic-add-flag-parity.test.ts` exists to fail when only one side flips. That is design D3's only drift guard. With the current order:
- After **1.3**, TOPIC-003 admits admins while the parity file still expects `ADMITTED_CANNOT_ADD`, so the parity test fails.
- After **2.1**, `content.test.ts`'s "cannot add while #176 is open" assertion fails until **3.8**.
- The parity file isn't fixed until **3.9**.

The tree stays red from 1.3 until 3.9. The previous change in this area (`2026-10-01-session-topics-snapshot-at-creation`) set the convention "unit lane stays green after every task". An apply agent that follows that convention, or that runs the suite after each task, will either stall at 1.3 or "fix" the parity test the wrong way. The worst case is that it flips the admin rows back so they match a half-done state. That would quietly defeat the guard.

**Fix:** reorganize sections 1–3 into vertical slices, each of which ends green:
1. **Slice 1, wrapper only (no behaviour change):** 1.1 and 1.2a. Add the wrapper with its unit tests for the 403 branches and the timing floor (the 403 half of 3.5). Nothing calls it yet.
2. **Slice 2, the atomic flip (one task):** 1.3, 1.2b, 2.1, 2.2, 3.6 (old-copy assertions), 3.8 and 3.9. Endpoint, flag, shared type doc and parity test change together. The parity test is the exit condition of this task.
3. **Slice 3, admin behaviour tests:** 3.1–3.4, the 404/409 half of 3.5, and 3.7. These only need slice 2.
4. **Slice 4, comments and TOPIC-007 non-regression:** 1.4, 1.5 and 3.10. The 1.4 grep ("TOPIC-007 is now its only caller") depends on 1.3 having happened, so 1.4 can't come before slice 2 in any case.

If the team would rather keep the current section headings, state explicitly at the top of `tasks.md` that **the unit lane is expected red from 1.3 until 3.9, and the parity test must not be edited except as 3.9 says**. I prefer the slices. A stated exception is the weaker option.

### A3. Frontend: 4.1 leaves typecheck and `addCustomTopic.test.ts` broken until 4.3 and 4.5

4.1 changes `activeEmptyStateVariant`'s signature and its return type. Its only consumers are `ActiveTopicsEmptyState.tsx` (4.2), `TopicManagementPage.tsx` (4.3) and `pages/__tests__/addCustomTopic.test.ts`. 4.2 adds a **required** prop that has no call site until 4.3. Updating `addCustomTopic.test.ts` is buried at the end of 4.5 ("Update any unit tests of `activeEmptyStateVariant`").

**Fix:** merge 4.1, 4.2 and 4.3 into one task, and move the `addCustomTopic.test.ts` update into it. That file is the direct unit test of the function 4.1 changes. 4.5(a)–(e) can stay a separate test task. 4.4 (help text) is independent and can go anywhere.

### A4. Task 6.2 would push the agent into editing living specs before archive

6.2 says: "Grep the source **and living specs** for leftover '#176', 'temporar' and 'Topics can't be added from this account yet' references, and resolve each one." I confirmed that `openspec/specs/topic-management-screen/spec.md` and `openspec/specs/topic-customization-lock/spec.md` contain those strings today. They are supposed to. The deltas in this change remove them when the change is archived. An apply agent told to "resolve each one" would edit `openspec/specs/` directly. That pre-empts the delta merge, and archive could then fail or apply twice.

**Fix:** limit 6.2 to `packages/`, `requirements/` and this change's `specs/` deltas. Move the living-spec grep into 6.4, which is already post-archive (see B2).

### A5. 6.1 runs before the last code edits

6.1 runs the test suites, typecheck and lint, and then 6.2 can still edit source and comments. **Fix:** swap them so the grep cleanup (6.2) comes first and the full verification (6.1) comes last. Keep `openspec validate --strict` in the last task.

### A6 (minor). The line numbers in 1.4 will be stale by the time it runs

1.4 gives locations by line number (~L58–72, ~L79, ~L99–103, ~L352–358, ~L492–496, ~L1472). 1.1 adds a wrapper "beside" the archive wrapper (~L352), and 1.2 and 1.3 delete lines above, so every later line number moves. Under the slice order in A2 that drift gets worse. The quoted comment text in 1.4 is enough to find each location. Say "locate by the quoted text; line numbers are approximate as of the pre-change tree."

---

## 2. Tasks an agent cannot complete during apply

Use the labels that `2026-10-01-session-topics-snapshot-at-creation/tasks.md` already defines, and copy its legend to the top of this `tasks.md` so the apply agent has the rules in front of it:

> - **[HUMAN]** tasks need a person (credentials, sign-off, an accountable decision, filing in an external tracker). The implementing agent does not attempt them and leaves them unchecked.
> - **[AT ARCHIVE]** tasks are done during archive, not during apply.

Apply is complete when every task without one of these labels is checked.

### B1. Task 6.3 mixes agent work with human work. Split it.

As written, 6.3 asks the agent to file GitHub issues, record their numbers, and name the per-provider IdP role-assignment administrator. The design is explicit on both points. The proposal says "Filing is left to a human." The design says the IdP owner "is not named anywhere in the repo … rather than something I invent." An agent that tries 6.3 will either stall or make up names. Making up an accountable owner is the outcome I most want to prevent, because that line is the control-owner record for the `application_admin` grant path.

- **6.3a (agent):** check that `follow-up-issues.md` has a ready-to-file draft for each of F1–F7. Then draft the PR-description section with placeholders: `F1: #____`, `F2: #____`, and one line per configured OIDC provider for the role-assignment administrator. Enumerate the providers from config rather than assuming Entra; Entra is primary but not the only one. Also mark which items gate merge.
- **6.3b [HUMAN] (merge gate):** file F1 and F2, and record their numbers in this task and the PR description.
- **6.3c [HUMAN] (merge gate):** name the IdP role-assignment administrator for **each** configured OIDC provider in the PR description (security review condition 1).
- **6.3d [HUMAN] (not merge-gating):** file F3, post F4 as a comment on #200, file F5 and F6 with the identity/session backlog, and file F7 with ops/monitoring.

The merge gates belong in the PR description, where the reviewer will see them. A box left unchecked in `tasks.md` is not enough.

### B2. Task 6.4 is post-archive by definition

6.4 starts with "After `openspec archive`". It cannot be done during apply. Label it **[AT ARCHIVE]**, and add the living-spec part of the 6.2 grep to it (A4). It's a good task. The deltas can't carry Purpose or implementation-note prose, and stale "facilitator only" wording in a living spec is how a future reader reinstates the old rule. Its home is the archive stage.

### B3. Everything else can be done by an agent

Sections 1–5 and 6.1/6.2 need nothing outside the repo. Task 3.7 is a real-Postgres integration test, so it should follow the house `describe.skipIf(!dbUp)` / `REQUIRE_DB` pattern. That is a convention, not a blocker.

---

## 3. Things I checked that are correct

- **No dependency on unbuilt work.** The snapshot-at-room-open behaviour that 3.7 relies on is already on `main` (#175/#205). `checkStandingFacilitatorOrAdminAuthorization` already exists and runs the same `evaluateStandingFacilitatorAccess` query, so the TOPIC-003 unit tests' positional `mockAuthQuery` sequence stays valid after the swap. No mock rewrites are hidden in 1.3.
- **No existing test asserts admin → 403 on TOPIC-003.** The admin assertions in `topics.test.ts` are on TOPIC-004/005/006. The only tests that encode the old admin behaviour are `content.test.ts` (3.8) and the parity file (3.9), and the tasks name both.
- **TOPIC-007 isolation (D1)** is protected correctly. 1.4 restricts it to comment-only edits, and 3.10 runs the annotation suites unmodified.
- **Section 5 (contract and requirements prose)** has no code dependencies and can run in parallel with anything.
- **Provider-agnosticism.** No task couples to Entra-specific behaviour. 6.3 already asks for an owner per provider. B1 keeps that and makes the agent enumerate the providers from config.

---

## 4. Required changes, in summary

| # | Change | Type |
|---|---|---|
| A1 | Split 1.2; delete the constant only after 1.3 | Reorder |
| A2 | Make endpoint, flag, shared doc, old-copy assertions and parity test one atomic task (or state a red window explicitly) | Regroup |
| A3 | Merge 4.1–4.3 and move the `addCustomTopic.test.ts` update into that task | Regroup |
| A4 | Limit the 6.2 grep to source, requirements and deltas; living specs go to 6.4 | Rescope |
| A5 | Run the 6.1 verification after the 6.2 cleanup | Reorder |
| A6 | Anchor 1.4 by quoted text, not line numbers | Clarify |
| B1 | Split 6.3 into agent prep (6.3a) and [HUMAN] 6.3b–d | Split and label |
| B2 | Label 6.4 [AT ARCHIVE] | Label |
| — | Add the [HUMAN] / [AT ARCHIVE] legend and a "unit lane green after every task" convention to the top of `tasks.md` | Add |
