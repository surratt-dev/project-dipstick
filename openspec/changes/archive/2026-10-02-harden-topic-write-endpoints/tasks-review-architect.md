# Tasks Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact:** `tasks.md` (harden-topic-write-endpoints, GitHub #184), read against `design.md` and `proposal.md`
**Focus:** Does the task order respect architectural dependencies? Does any task assume something that hasn't been built yet? Is the `teams.ts` GET envelope change its own revertible commit, as the Executive asked?
**Verdict:** **Approve with required changes.** The order is mostly sound: the envelope categories come before their consumers, extraction comes before the new script, and the script comes before the helper and the wiring. There are three real ordering defects. (1) The `teams.ts` envelope swap is scheduled on day 1 but is the first thing to drop on day 4, and other tasks edit the same handler after it. (2) The structural grep test (2.6) is hard-coupled to that swap. (3) The test-harness guard (5.4a) contradicts two later test tasks (5.6, 5.10). There is also one undeclared prerequisite: `TopicWriteDenialContext` is module-private today. None of these needs a design change.

I checked each claim below against the code on this branch (`packages/backend/src/routes/*.ts`, `routes/__tests__/helpers/real-db.ts`, CI workflows).

---

## Dependency map (as written)

```
2.1 ──► 2.5 (TEAM-006 envelopes)        2.2 ──► 2.3, 2.4, 2.6
2.1 ──► 5.3 / 5.4 (429/503 bodies)      3.1 ──► 3.2, 3.3, 5.3 (lowercase team_id in audit row)
4.1 ──► 4.2 ──► 4.3                     5.1 ──► 5.2 ──► 5.3, 5.4 ──► 5.4a ──► 5.5 ──► 5.6, 5.7, 5.9, 5.10
5.2 (shared copy) ──► 6.1 ──► 6.2 ──► 6.3, 6.4      1.2 ──gate──► 2.4 ──► 7.5
```

Every arrow points forward in the numbering. Taken one task at a time, no task consumes something built later. The problems are about **commit shape and revertibility**, not raw precedence.

---

## Required changes

### R1. Move task 2.4 (`teams.ts` envelope swap) to the end of the code work, as the last commit before group 7

**Why.** Two of the Executive's conditions pull against the current position of 2.4:
- *Drop order:* "if the box is exceeded, drop 2.4 first". The box is exceeded on day 4, but 2.4 is scheduled on day 1. "Dropping" it then means reverting finished work, not skipping unstarted work.
- *Revertible on its own:* three later tasks edit `teams.ts` after 2.4 (2.5, 4.1, 5.11's fixtures). The `POST /:teamId/managers` 404 that 2.4 swaps (`teams.ts:1184-1191`) is in **the same handler**, about 20 lines below the TEAM-006 429/503 literals that 2.5 rewrites (`teams.ts:1113-1170`). A `git revert` of a 2.4 commit sitting under 2.5 is likely to apply cleanly, but nobody can promise that it will, and "likely" is not the property Rachel asked for.

**Change.** Renumber 2.4 as a new group just before verification (for example **6½ / "8. Optional: `teams.ts` envelope swap"**, or keep the id and add "do last"). The commit then sits on top of every other `teams.ts` edit, and reverting it touches nothing that came after. It also turns the time-box drop into "don't start", which is what the Executive meant. State in the task:
- The commit contains **only** the three `teams.ts` 404 sites, the `teams.test.ts` assertion updates (around line 1084), and the 2.6 allowlist removal (see R2). No other file.
- The commit message starts with `revertible:` or names #184/m5 so that it can be found later.
- 7.5's PR callout is conditional on this commit being present.

### R2. Decouple 2.6 (the "Team not found." grep test) from 2.4

**Why.** As written, 2.6 fails if 2.4 is not done. `teams.ts` holds three `"Team not found."` literals today (`:426`, `:577`, `:1188`). So 2.6 assumes something that, under the time box, may never be built, and reverting 2.4 later breaks CI.

**Change.** Write 2.6 with an explicit, commented allowlist containing `routes/teams.ts` ("removed by task 2.4; see #184 m5"). Task 2.4's commit deletes that allowlist entry. Reverting 2.4 then restores the entry along with the literals, and CI stays green either way. If 2.4 is deferred, the follow-up issue removes the entry. That way the deferral can't be forgotten, because the allowlist line points to it.

### R3. Resolve the conflict between the 5.4a harness guard and tasks 5.6 / 5.10

**Why.** 5.4a adds a guard: "fails when a non-real-Redis test file imports `topics.ts` without the helper" (the helper mocks the limiter to `"allowed"`). Two later tasks cannot satisfy that guard:
- **5.10** (Redis throw/hang gives 503 on all five routes) has to exercise the **real** `enforceTopicWriteRateLimit` against a mocked or failing `redis.js`. With the limiter mocked to `"allowed"`, it tests nothing.
- **5.6** (behavioural placement) needs a pre-seeded over-budget actor **and** a count of zero `teams` queries. If it is written as a unit file with a mocked DB, it trips the guard. If it is written as real-Redis/real-DB, the query count needs a `db.query` spy on the real pool.

**Change.** In 5.4a, define the guard's classification rule precisely: real-Redis means the file calls `probeInfra()`/`requireInfraOrThrow`, and an explicit opt-out marker (for example a `// limiter-under-test` header comment) lets a file mock `redis.js` and import the real helper. In 5.6, state which harness it uses: I recommend real-Redis/real-DB with a `vi.spyOn(mods.db, "query")` filter on `FROM teams`. Mark 5.10 as the opted-out file.

### R4. Make `TopicWriteDenialContext` importable before 5.2

**Why.** 5.2 has `enforceTopicWriteRateLimit` take `ctx: TopicWriteDenialContext`. Today that interface is **module-private** in `topics.ts` (`topics.ts:164`, `interface`, not `export`). The new `routes/topic-write-rate-limit.ts` can't name it. Exporting it from `topics.ts` would make the helper import from its only caller (a type cycle; legal with `import type`, but it muddies the import graph that 5.7's structural test reasons about).

**Change.** Add a step at the start of 5.2 (or a 5.1a): move `TopicWriteDenialContext` to a neutral module, either `routes/error-envelope.ts`'s neighbour or a small `routes/topic-write-context.ts`, and import it from both `topics.ts` and the helper. This is a pure type move with no behaviour change. It can go in the same commit as 5.2.

---

## Recommended changes (not blocking)

### S1. Split 5.2 so that the shared contract lands first
5.2 bundles three things: (a) `TOPIC_WRITE_LIMITS`, (b) the `@dipstick/shared` copy constant, and (c) the helper itself. Split (b) into **5.2a**: add `TOPIC_WRITE_RATE_LIMIT_MESSAGES` **and the two error-code constants** (`TOPIC_WRITE_BURST_LIMIT_EXCEEDED`, the daily code, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`) to `@dipstick/shared`. Then:
- 6.1 selects copy by `error.code` against an imported constant, not a string literal, which closes the last copy/contract duplication that Decision 12 set out to remove.
- Group 6 can proceed in parallel with groups 4–5 once 5.2a lands. That is the only real parallelism this change has, and it matters inside a four-day box.
- Build-order note: `@dipstick/shared` resolves through `dist/` (`packages/shared/package.json` `exports`). CI already builds shared first (`ci.yml:60`, `integration.yml:65`), but local backend/frontend test runs need `npm run build -w packages/shared` after 5.2a. Put one line about this in the task.

### S2. Pin 3.6–3.8 to the budget-isolation pattern from the start
3.6–3.8 add real-DB/real-Redis topic-write tests **before** the limiter exists. They pass at that point. After 5.5 they consume budget, and 5.4b's "every real-Redis file that performs topic writes" has to remember them. Have 3.6–3.8 use `randomUUID()` actors when they are written, and change 5.4b to name its file list explicitly (at minimum `topics-integration`, `remove-topic-integration`, `restore-topic-integration`, `topic-annotation-integration`, `topic-add-admin-integration`, `template-team-topic-writes-integration`, `topic-write-template-guard-structural`, `session-topic-edit-isolation-integration`, `room-open-integration`, plus the new 3.6–3.8 and 5.x files), rather than "every … file". An implicit list is an implicit decision.

### S3. Land 5.4a, 5.4b and 5.5 as one commit
5.5 is the commit at which every unmocked unit test starts answering 503 after 500 ms (Decision 13 M1), and fixed-ID integration fixtures start accumulating budget. If the harness tasks and the wiring are separate commits, the history has a red commit, either in the middle or (if 5.4a lands first and its guard has nothing to check) a vacuous one. Make the wiring and its harness atomic so `git bisect` stays usable.

### S4. 3.6–3.8 do not depend on 3.1; say so
Lock canonicalization already holds (`lockTeamTopics` uses `hashtext($1::uuid::text)`), so the uppercase-path concurrency tests pass with or without 3.1. That is correct, since they are acceptance tests for already-landed L1. But a reader may assume they verify 3.1. Add one clause, "proves L1 as landed; independent of 3.1", so that nobody later reorders 3.1 thinking these tests guard it. 3.3 is the test that guards 3.1.

### S5. Group 7 ordering
7.3 (`openspec validate --strict`) and 7.4 (`docs/deployment.md`) are cheap and catch artifact drift. Run them before 7.1/7.2 so a spec failure doesn't follow a full test run. 1.1 (file follow-up issues) is a **merge gate**, not pre-work for the code. Leave it in group 1 if you like, but also add it to the 7.x checklist so it is checked at merge time and not only at the start.

---

## Task 1.2: preliminary result (for the implementer to confirm and record)

I ran the grep that 1.2 asks for. The only frontend branches on `error.category` / `category ===` are:
- `packages/frontend/src/http/sessionExpiry.ts:32-34`: only on `status === 401 && category === "session_expired"`. It never sees a 404.
- `packages/frontend/src/pages/AuthErrorPage.tsx:13`: reads `category` from the OIDC error **query string**, not from an API body.

Nothing branches on the `GET /teams/:teamId` or `/members` 404 category. The 2.4 gate should pass. The implementer still records the result in tasks.md as 1.2 requires. My result is a head start, not a substitute.

Two facts for the 2.4 PR callout (7.5) that the tasks don't mention:
- The `POST /:teamId/managers` 404 is **already** `category: "not_found"` (`teams.ts:1186-1187`). For that route the change is only the added `code: "TEAM_NOT_FOUND"`, not a category change. The callout should say "two routes change category; three gain a code".
- `facilitator-sessions.test.ts:295` asserts with `toMatchObject`, so 2.3's added `code` will not break it. `teams.test.ts` around line 1084 is the assertion that 2.4 must deliberately update.

---

## Things I checked and found correct

- **2.1 before 2.5 / 5.3 / 5.4.** `ErrorCategory` (`error-envelope.ts`) lacks both new members today, so 2.5 cannot use `buildErrorEnvelope` without 2.1. Order is correct.
- **2.5 byte identity is achievable.** TEAM-006's inline bodies use the key order `category, code, message, correlationId`, which matches `buildErrorEnvelope`'s spread order. With no `field`, the bodies are identical.
- **4.1 before 4.2 before 5.x.** The extraction creates the module that the conditional script lives in. 4.3 tests the script in isolation before any route uses it. This is the right way to de-risk the Lua.
- **3.4 does not reorder the cascade.** Annotation calls `checkTopicExistsAndActive` immediately after its inline guard (`topics.ts:1725-1729`), and archive/restore call the helpers at the same step (`:1090`, `:1310`). Moving the guard into the helpers keeps every route's position. Both helpers already take `startTime`, so the timing floor needs no signature change.
- **3.1 before 5.3.** The breach audit row's `team_id` comes from `ctx.teamId`, so lowercasing has to land first. It does.
- **`withTimeout` exists** (`auth/audit-write-timeout.ts:33`) and **the lock-waiter helper exists** (`withTeamLockGate`, `real-db.ts:318`, already used by `room-open-integration`), so 5.2 and 3.6–3.8 build on real code.
- **5.7 keeps `facilitator-sessions.ts` untouched** apart from 2.3's envelope swap. The import-graph test runs after 5.5, so it guards the finished state.
- **Session-runtime boundary.** No task adds an import, hook or timeout to `facilitator-sessions.ts`, the session/voting modules or the WebSocket path. 3.8 drives room open through its existing route. This is the constraint I care about most, and the task list respects it.

---

## Suggested revised order (summary)

1. **Group 1** as written. Record the 1.2 result.
2. **Group 2 without 2.4.** 2.6 gets the `teams.ts` allowlist entry (R2).
3. **Group 3.** 3.6–3.8 use `randomUUID()` actors (S2).
4. **Group 4** as written.
5. **5.1 → 5.2a (shared copy + codes, S1) → 5.2 (with the `TopicWriteDenialContext` move, R4) → 5.3 → 5.4 → [5.4a + 5.4b + 5.5 as one commit] (S3, R3) → 5.6–5.11.**
6. **Group 6**, which can start any time after 5.2a.
7. **2.4 as its own final commit**, only if the time box allows (R1). It removes the 2.6 allowlist entry.
8. **Group 7**: 7.3 and 7.4 first. 7.5 is conditional on step 7. Re-check 1.1 at merge.

— Ingrid
