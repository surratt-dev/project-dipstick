# Tasks Review: template-team-not-usable (#214)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering against architectural dependencies. Does any task assume something that hasn't been built yet? Which tasks should be split or reordered?
**Inputs:** `tasks.md`, `design.md`, `proposal.md`, checked against the code on `agent-team/214-template-team-not-usable`.
**Verdict:** **Approve with changes.** The order is mostly right: the backstop comes first, the shared module comes before its consumers, guards come before the structural test, and types come before the frontend. I found two blockers. Both are cases where a task depends on something that cannot exist when the task runs. There are also four reorder or split items and a few minor corrections.

---

## What I verified in code

- **Route inventory matches D3 and §3.** The `/api(/v\d+)?/teams/:teamId/(sessions|members|managers|join-links)` prefix selects exactly 12 routes today: `draft`, `advance`, `reveal`, `complete`, `topics/advance`, `facilitator-state`, the two `content.ts` reads, `members`, `members/:userId/role`, `managers` and `join-links`. Every one has a guard task or an explicit `refused-before-guard` entry. I found no hidden route that 5.1 would surface late, so writing the structural test after sections 3–4 is acceptable.
- **The scratch-schema precedent** (`auth/__tests__/users-roles-schema-integration.test.ts`) runs migration SQL on a single client with `SET LOCAL search_path TO <scratch>, public`. `buildFullApp` and `evaluateTeamAccess` use the global `db` pool, which takes no client parameter.
- **#188's test file** `template-team-topic-writes-integration.test.ts` seeds template memberships in **three** tests (l.256, l.275, l.324) and a template session in another. The test at l.324 ("4.3") also asserts `isCustomizationLocked: false` on `/topics/all`.
- `audit_log.actor_global_role` is free `TEXT NOT NULL` with no CHECK, so `'system'` in 1.1 is safe. CI applies migrations to `public` before integration tests run (`integration.yml` l.66). I found no deploy on merge, so H1 gates the deploy, not the merge, as written.

---

## Blockers

### B1. Tasks 1.2 and 3.4 assume an HTTP harness against the scratch schema, which does not exist

Task 1.2 asks the migration test to assert that the facilitator of a completed template session "gets the missing-team answer from `/trends`, `/action-items`, `/sessions` and `/sessions/:sessionId`". Task 3.4 reuses "the fixture from 1.2" in an integration test.

Neither can run as written:
- The fixture can exist **only** in the scratch schema. In `public`, the validated constraint refuses the seed, and an `UPDATE` to the template id is refused too.
- The routes run through `buildFullApp` → global `db` pool → `public`. `SET LOCAL search_path` on one test client does not reach the app's pool. The scratch copies would also need `teams`, `votes`, `topics`, `action_items` and `users` cloned before `/trends` could answer at all.

So 3.4 depends on infrastructure that no task builds, and 1.2 mixes a migration-level test with an app-level test across two different databases in practice.

**Required: pick one, and say which in `tasks.md`.**
- **(a) Recommended. Narrow both tasks to the data property and compose.** In 1.2, assert in the scratch schema that the completed template session has `facilitator_access_expires_at <= now()` after the migration, and that path 3's predicate (`status = 'complete' AND facilitator_access_expires_at > NOW()`), run in the scratch schema, returns no row. Expiry denial for the HTTP routes is already a property of `evaluateTeamAccess` on real teams. Point 3.4 at that existing coverage, or add one real-team test for an *expired* grant on `/sessions` and `/sessions/:sessionId` if none exists. In 3.4, drop the "fixture from 1.2" case and keep the zero-membership facilitator and admin cases, which run in `public`. This keeps the Exec advisory against gold-plating, and it tests the decision D7 actually made: the grant is closed in the data, not in the route.
- **(b)** Add a new task **before** 1.2 that builds a scratch-schema app harness (`buildFullApp` taking an injected pool whose connections set `search_path`, plus full table cloning). That is real test infrastructure with its own risk, and I don't think this change should carry it.

### B2. Task 1.1 turns the suite red until 1.4 is done; 1.4 must be split around it

CI migrates `public` first, so once 1.1 is on the branch the validated constraint refuses #188's seeds (B-items above), and the full suite stays red through 1.2, 1.3 and 1.5 until 1.4 lands. Every intermediate "Verify the test passes" in section 1 is unverifiable against a green baseline.

1.4 is two pieces of work with opposite dependencies:
- **1.4a, before 1.1:** move #188's "unlocked" coverage to the hoisted `vi.mock` of `auth/topic-lock-helper.js`, and remove every template `sessions`/`team_memberships` seed. That is **all three** membership-seeding tests (l.256, l.275, l.324), not just the `FACILITATOR_IS_TEAM_MEMBER` case the task names. This has no dependency on the constraint and should run green on the current schema.
- **1.4b, after 1.1:** replace the `403 FACILITATOR_IS_TEAM_MEMBER` case with "the membership insert is refused (`23514`)". This needs the constraint.

Also state in 1.4a what happens to the l.324 "TOPIC-001 (a member) reads the template" assertion. After this change no template member can exist, so the TOPIC-001 read becomes unreachable for a member. That is why 6.1 uses a unit-level test. The test should be retired in 1.4a and point to 6.1. It should not be quietly deleted.

---

## Reorder / split

### R1. Tasks 6.1 and 6.3 must land together

Once 6.1 switches TOPIC-002 to `getTopicLockState`, the existing test at l.324 (`isCustomizationLocked: false` on the template) fails. 6.3 is the fix. Run them as one task, or make 6.3 a sub-step of 6.1. Otherwise there is a red window between them.

### R2. `getTopicLockState`'s file location interacts with 1.4's module mock

1.4 mocks the whole `auth/topic-lock-helper.js` module. If 6.1 puts `getTopicLockState` *in* that module, the mock replaces it, and #188's tests stop exercising the real wrapper. 6.2 also requires the helper not to reference the template. D6 says "beside", so make it explicit in 6.1: a **separate file** (for example `auth/topic-lock-state.ts`) that imports `hasCompletedFirstSession` and `isTemplateTeam`. Then 1.4's mock stubs only the inner call, and 6.1's "stays `canonical_defaults` even when `hasCompletedFirstSession` returns true" test is the same mock reused.

### R3. Move 1.5 after 2.1, or give the predicate its own home

1.5 builds "the shared predicate and marker logger" (`isTemplateConstraintViolation`, `logTemplateConstraintViolation`) before 2.1 creates the shared module. Either do 2.1 first and put the predicate in `teams/template-team-guard.ts`, or name a separate file in 1.5 (for example `teams/template-constraint-violation.ts`). As written, 1.5 creates the file that 2.1 then says it creates. The dependency doesn't care which you choose, as long as the task names the file. I prefer the separate file: the predicate is about the database backstop, the guard is about the app layer, and D1 keeps those two layers independent on purpose.

### R4. Split 2.1's source-inspection test

2.1 ends with a source-inspection test that "the eligible-teams query" reads no config. That query is changed in 3.1. A test written in 2.1 would inspect the *pre-change* query and pass trivially. Keep the module half in 2.1 and move the eligible-teams half into 3.1's verification.

---

## Minor

- **M1. Task 8.4's route list is missing two EM routes.** `GET /api/v1/teams/:teamId/em/sessions` and `…/em/sessions/:sessionId` (`em-views.ts` l.98, l.289) are outside the structural prefix, because `em/` sits between `:teamId` and `sessions`, and they are not in the "today:" list. 8.1 covers their gate, but the 8.4 table should name them so the PR inventory is complete.
- **M2. 5.2 before 5.1, or together.** The probe self-test is what proves the 5.1 checker can fail. Without it, a green 5.1 proves nothing about fail-closed behaviour. I'd write 5.2's `extraRoutes` option and probe first, watch it fail with no table entry, and then fill in the table. The current order isn't wrong, but the 5.1 verification ("the test passes") is weaker than it looks until 5.2 exists.
- **M3. Name the type change in 4.4.** 4.4 adds `reason: "template"` to `join.link_rejected`. If that reason is a typed union, as `AuditEventName` is in 2.1, extending it belongs in 4.4. Mention it so it isn't discovered at compile time.
- **M4. 10.2 needs migrations applied locally.** A developer database with leftover template rows ends up `NOT VALID` (D9), which is fine. The manual check should still note that the migration ran, or the "template absent" result is untrustworthy.
- **M5. Workflow gate.** H1 is correctly tied to deploy, not merge (no deploy on merge in `.github/workflows`). Add "H1 recorded" to the release checklist that runs the migration, because nothing in the repo enforces it.

---

## Suggested order

1. 1.4a: rework #188 seeds to mocks (green on the current schema)
2. 1.1: migration
3. 1.4b: constraint-refusal test replacing `FACILITATOR_IS_TEAM_MEMBER`
4. 1.2 (narrowed per B1a) and 1.3
5. 2.1: guard module (module half of the source test)
6. 1.5: predicate in its own file, plus the error handler
7. 3.1 (with the eligible-teams source test), 3.2, 3.3, 3.4 (narrowed per B1a)
8. 4.1–4.4
9. 5.2 → 5.1 → 5.3
10. 6.1 + 6.3 together, then 6.2
11. 7.1–7.3
12. 8.1–8.4 (these are independent and can run any time after 1.1; 8.4 should include the M1 routes)
13. 9.1, then 10.1, then 10.2

Sections 8 and 9 have no code dependency on anything else and can run in parallel with sections 2–7.
