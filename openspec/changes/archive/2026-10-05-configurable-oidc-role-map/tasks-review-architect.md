# Tasks review: Configurable OIDC role map (#243)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Reviewed:** `tasks.md`, read against `proposal.md`, `design.md` (revision 3) and all six spec deltas. I spot-checked the code at `c00b496`.
**Focus:** dependency ordering, task granularity, TDD sequencing, and whether each task names concrete files.

## Verdict

**Approve with required changes.** The decomposition is faithful to the design. Every decision from D1 to D11 and every accepted review item (R1–R6, C1–C8, S1–S8) maps to a task. The leaf-module discipline in 1.1 (R4) is correctly placed first. Most of what follows is about sequence. Several tasks cite an artifact or link that a later task produces. One verification cannot pass in the order written. One safety property (D11 closing S1) depends on an ordering the tasks imply but never state. These are the decisions an implementer would otherwise make by default, so I want them written down.

---

## Required changes

### A1. Follow-up issues are filed last but cited earlier (6.5 → 1.3, 4.5, 5.1, 6.1)

Task 6.5 files the follow-up issues. Four earlier tasks need those links:

- **1.3:** a cut records "an accepted risk with a follow-up link".
- **4.5:** findings go "in the live-session demotion follow-up".
- **5.1:** the urgent-revocation runbook line must "link the follow-up" (proposal follow-up 7).
- **6.1:** each point is marked `accepted with follow-up <link>`.

**Change:** Move the unconditional filings (proposal follow-ups 1, 3, 7, 8, 9) to a new task **0.1** at the very start. Follow-ups 5 (scanner cut) and 10 (demotion gaps) depend on a condition. File each one inside the task that triggers it (1.3 and 4.5 respectively). 6.5 then only verifies that every marker has been replaced. The proposal says the demotion issue "must exist before a second team goes live", which is one more reason not to leave it to the last task.

### A2. `security-review.md` gets entries before it exists (1.3, 4.5 → 6.1)

Tasks 1.3 and 4.5 both write to `security-review.md`. That file is created only in 6.1, by a different owner (Tomás Ferreira).

**Change:** Add task **0.2**. The implementer creates `security-review.md` as a skeleton: the six review points, the S1/D11 confirmation, the deferred items from `design-review-security.md`, and an empty "Implementation findings" section. Tasks 1.3 and 4.5 add their results to that section. 6.1 then becomes the reviewer's pass over a file that already exists, and nobody has to re-derive an implementation finding from a PR thread.

### A3. 2.4's verification cannot pass until 4.1

2.4 is verified by `grep -rn PERMITTED_GLOBAL_ROLES packages/backend/src docker/oidc` returning nothing. That string appears in the header comment of `docker/oidc/accounts.js` (line 6), and 4.1 is the task that rewrites it. If the tasks run in order, 2.4 fails its own check.

**Change:** Narrow 2.4's grep to `packages/backend/src`. Move the `docker/oidc` half of the grep into 4.1's verification.

### A4. 4.1 and 4.3 must land together

4.1 changes `facilitator-001`'s claim. 4.3 updates the files that assume `facilitator-001` is unseeded: `DEV_LOGIN_OPTIONS`, `DevLoginPage.test.tsx`, `auth.test.ts` and `docker/oidc/__tests__/interactions.test.js`. Doing 4.1 alone leaves the suites red and leaves `seeded: false` contradicting the stub.

**Change:** Merge 4.1 and 4.3 into one task, test-first: update the test expectations, watch them fail, then change `accounts.js` and `DEV_LOGIN_OPTIONS`. 4.1's "sign in locally" check becomes a manual smoke step. The automated proof is 4.2(a), which imports the fixture directly.

### A5. The D11 enforcement has to be in place before the resolver can produce EM + admin

S1 opens when array claims can resolve EM + admin to `application_admin`, which first becomes possible at 2.1/2.2. It closes at 3.4/3.5. The tasks put the hole-opening work ahead of the hole-closing work and say nothing about intermediate deploys. If someone splits this into PRs along section lines, which is a reasonable thing to do with 30 tasks, a deployable build would contain the S1 gap.

3.4 and 3.5 do not depend on anything in sections 1 or 2. They are edits to existing conditions in `sessions.ts`, `session-subscriber-access-helper.ts` and `facilitator-sessions.ts`.

**Change:** Pull 3.4, 3.5 and 4.5 into their own section, **"Admin live-session exclusion"**, and put it **before** section 2. 3.6 stays after section 2 because it calls `resolveGlobalRole`. Also add one line at the top of `tasks.md`: *"This change ships as a single merge unit. If it is split, the admin-exclusion section must merge no later than the resolver section."* That makes the ordering a stated constraint, not an accident of numbering.

### A6. The line between 2.2 and 2.3 leaves the resolver's logging undefined in between

2.2 replaces `mapRoleClaimToGlobalRole`. That function contains today's unmapped warn, which has the wrong argument order (R2). 2.2's check is that `account-resolver.test.ts` passes, but 2.2 never says what logging the resolver does once it is done. 2.3 then rewrites the logging.

**Change:** Make the boundary explicit. **2.2** keeps the unmapped warn, rewritten object-first as `warn({ claimName }, msg)`, with its existing test updated to assert `calls[0][0]`/`calls[0][1]`. **2.3** adds the overage and discard lines and the route-level wiring and S7 tests. Every intermediate state then has defined, tested logging.

### A7. The `roleMap` wiring test can pass vacuously

2.3 checks that "`roleMap` is `config.roleMap`" in `routes/__tests__/auth.test.ts`. That file mocks `config.js` with `mockConfig` (line 49), which has no `roleMap`. The route would pass `undefined`, the assertion would compare `undefined` with `undefined`, and the test would pass. The mocked `resolveOrCreateAccount` never throws, so 2.2's missing-map guard is never exercised on the route path.

**Change:** In 2.2, add a sentinel `roleMap: new Map([["sentinel","facilitator"]])` to `mockConfig` in `auth.test.ts`. In 2.3, assert `toBe(mockConfig.roleMap)` (identity, not equality).

---

## Recommended changes

### B1. Make TDD the written order, not an implication

Every task says "Implement X … Verify with tests". Read literally, that is test-after. Two places where this matters:

- **1.2–1.5** are pure functions with test cases already listed. Write the failing tests in `auth/__tests__/role-map.test.ts` first, then implement.
- **3.4/3.5 (D11):** the denial tests must be written and **seen to fail against the current gates** before the conditions change. That is the only evidence the S1 premise check (design, "S1 premise check") gives us that each enforcement point E1–E4 was really open. Without a red run, a test could pass for the wrong reason, for example a fixture without an active membership.

Suggested wording for each task: "Write tests …; confirm they fail; implement …".

### B2. The duplicate scan sits in the middle of 1.2's pipeline. Pin the order with a test.

D4 puts the duplicate check (step 3) between the object check and the per-entry checks. 1.3 is written after 1.2, so the implementer has to insert it into an existing pipeline. Add one test to 1.3: `{"A":"engineer","A":"facilitator"}` fails with the **duplicate** message, not the `engineer` message. Also have 1.2 return the full `{ map, source, warnings, summary }` shape from the start, with empty warnings and a placeholder summary, so the 1.2 tests do not need rewriting in 1.4/1.5.

### B3. 1.6 must run the full backend suite, not just `config.test.ts`

Once `loadConfig` calls `parseRoleMap`, any test that imports the real `config.js` with a non-local `OIDC_ISSUER` stops booting. I checked: `__tests__/config.test.ts` is the only file in the repo that does this. But a developer whose shell or `.env` points `OIDC_ISSUER` at a real IdP will hit the failure locally. Add "full backend suite passes" to 1.6's verification, and note the behaviour in 4.4's docs update.

### B4. Two tasks are in the wrong section

- **3.3** (01b use-case note) is documentation and belongs in section 5.
- **4.5** (mid-session demotion integration test) is a security verification and belongs in the admin-exclusion section from A5, not under "Local development stub".

The sections are what a reviewer scans to judge completeness, so misfiled tasks hide coverage.

### B5. 3.5 misses the reveal-latency endpoint

The `websocket-session-authorization` delta ("Application Admin denials reuse existing behaviour") and design D11 both name three grant-reusing HTTP endpoints: action-items review, roster, and `POST /api/v1/sessions/:sessionId/reveal-latency` (`sessions.ts` line 548). 3.5 tests only the first two. Add a reveal-latency denial test.

### B6. Name the files in tasks that don't

| Task | Says | Should say |
|---|---|---|
| 3.1, 3.2 | "route tests" | `packages/backend/src/routes/__tests__/auth.test.ts` |
| 3.4 | "route tests" | the `sessions.ts` route test file (name it) |
| 3.5 | "route tests showing the roster omits an admin…" | the `facilitator-sessions.ts` route test file, plus `sessions.ts` tests for reveal-latency (B5) |
| 3.6, 4.2, 4.5 | "real-DB integration test … passes in CI" | a named file. State that it follows the `describe.skipIf(!dbUp)` convention and is proven by the **integration** workflow (`.github/workflows/integration.yml`), not `ci.yml`, where it is skipped. "Passes in CI" is otherwise satisfiable by a skip. |
| 5.3 | "the release notes location used by this repo" | There isn't one. `release.yml` runs `gh release create --generate-notes`, which builds notes from PR titles, so a breaking-boot note written anywhere else is invisible on the release page. Decide explicitly. My recommendation: an "Upgrading" subsection in `docs/deployment.md` as the durable copy, an "Upgrade notes" section in the PR body, and the release owner pastes it into the GitHub release body as part of 6.2. |

### B7. Two spec scenarios have no verifying task

- `oidc-role-mapping` "Token refresh does not re-resolve the role". Add a test in `packages/backend/src/auth/__tests__/middleware.test.ts` asserting that `refreshSessionTokens` neither calls `resolveOrCreateAccount` nor writes `users.global_role`. The ~90-minute revocation bound in the docs (5.1) and the security sign-off (6.1) rest on this. Today it is asserted from reading the code, not pinned by a test.
- `oidc-role-mapping` "Map change without restart has no effect". This holds by construction (config is loaded once at module load). A one-line "verify by review" in 1.6 is enough, but it should be stated.

### B8. Check #235's status before implementation, not only at the end

6.3 says "if #235 has merged, rebase the `first-access` delta". If #235 has merged, the **resolver** (2.1) has to be reconciled too, along with re-running S1/S4. That is design work, not spec housekeeping. Add a gate to task 0.1: check #235/#241 status before starting section 2, and stop and escalate if either has merged.

### B9. 6.4 cannot be completed inside this change

6.4 runs "after archive". Mark it explicitly as a post-archive task, or move it into the archive step's checklist, so the change is not shown as incomplete forever or ticked early.

---

## Proposed order

```
0. Gates and scaffolding
   0.1 Check #235/#241 status (B8); file unconditional follow-ups (A1)
   0.2 Create security-review.md skeleton (A2)
1. Role map parsing and startup validation      1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7   (test-first, B1/B2/B3)
2. Admin live-session exclusion (D11)           3.4, 3.5 (+ reveal-latency, B5), 4.5   (independent of section 1; must precede section 3)
3. Claim resolution at sign-in                  2.1 → 2.2 (A6, A7) → 2.3 → 2.4 (A3), then 3.6
4. Audit firing condition                       3.1, 3.2, + refresh test (B7)
5. Local development stub                       4.1+4.3 merged (A4) → 4.2 → 4.4
6. Docs and release notes                       3.3 (moved), 5.1, 5.2, 5.3 (B6)
7. Review and release                           6.1 → 6.2 → 6.3 → 6.5 (verification only); 6.4 post-archive (B9)
```

Sections 1 and 2 can run in parallel. Section 2 only has to land before section 3. The critical path is 1.1 → 1.6 → 2.2 → 3.1, and everything else hangs off it.

## What is right and should not change

- **1.1 first, as a leaf.** The `role-map.ts` → `config.ts` direction and the ban on importing `config.js`/`db.js` are stated in the task, so the R4 cycle cannot creep in.
- **1.6 bundles the `config.test.ts` real-import fix with the wiring.** Splitting those would leave a red suite between commits. Keep them together.
- **3.1's single `const` for the audit row and the structured event (C1).** This removes a class of drift structurally rather than through review.
- **4.2's honest scope (C8).** Saying explicitly that this is not a browser end-to-end test is the kind of explicitness I want to see more of.
- **1.3's budget-and-cut rule.** A security control with a written exit path and a named record of the cut is how an implicit decision becomes an explicit one.
