# Design Review: reject-template-team-topic-writes (#188), Engineering

*Reviewer: Marcus Oyelaran (Senior Full Stack Engineer). I checked the design against
`packages/backend/src/routes/topics.ts`, `app.ts`, `routes/uuid.ts`, `routes/error-envelope.ts`,
`routes/facilitator-sessions.ts` (team-creation copy), `migrations/8_audit_log.sql`, and the
existing harnesses in `routes/__tests__/topics.test.ts` and `topics-integration.test.ts`.*

## Verdict

**Approve with changes.** The guard itself (D1 to D3) can be built as written, and it fits the
file's existing patterns. The problems are in the tests: the team-creation regression (D5/4.5)
cannot catch an add regression, the structural test (D4) has unstated harness requirements, and
it leans on a lock state it cannot rely on. None of this changes the architecture. All of it has
to be settled before tasks are picked up.

## What I verified (holds up)

- **The five call sites match the design.** Each handler runs `rejectNonCanonicalTeamId`, then
  auth, then `checkTeamExists`, then `checkCustomizationLockGate`, at the stated lines.
  `checkTeamExists` has exactly five callers, so removing it is safe. Every handler already has
  `authResult.actorGlobalRole` and `endpoint` in scope by the time it reaches the existence check,
  so `checkWritableTeam`'s signature needs nothing new.
- **The `===` comparison is sound.** `isCanonicalUuid` accepts either case, but the sentinel
  `00000000-0000-0000-0000-000000000001` has no hex letters, so there is only one canonical
  spelling.
- **Header parity is automatic.** `no-store` is set at handler entry on 006 and 007 only, and
  `checkWritableTeam` sends through the same `reply`. `correlationId` is always a
  `crypto.randomUUID()` of fixed length, so `content-length` matches too and parity tests don't
  need to exclude it.
- **D2 is right.** The mocked `mockExists` helper in `topics.test.ts` returns a row whatever the
  id, so the call order for non-template teams doesn't change. Template unit cases add exactly one
  mock after the existence query: the audit insert.
- **Scope is complete.** `topics` is written only in `topics.ts` (the five handlers) and in the
  team-creation copy (`facilitator-sessions.ts` l.654), which writes the *new* team's id. The
  session snapshot only reads `topics`. So `EXTRA_IN_SCOPE_ROUTES = []` is correct today.
- **Rejecting the preHandler alternative is right.** Auth runs inside the handler, so a route-level
  hook would answer 404 before 403.
- **No migration is needed.** `audit_log.operation` is free `TEXT`, and `team_id` has no FK.

## Must fix

### M1. The team-creation regression (D5, task 4.5) can't detect an add regression, and its cleanup is underspecified

- The copy is `WHERE team_id = $2 AND is_default = true`. A topic that TOPIC-003 adds has
  `is_default = false`, so a regressed add puts a row on the template that the new team never
  inherits. "New team's topics equal the snapshot" still passes. **Fix:** 4.5 must also compare
  the template's own rows (all statuses) to the snapshot directly, not only through the new team.
- The copy ignores `status`, so the snapshot should be the template's `is_default = true` rows in
  every status. Compare them to the new team's rows, not "active topics" on both sides. Otherwise
  an archive regression shows up as a confusing mismatch, or not at all.
- **`finally` restore is non-trivial.** Undoing a regression means deleting rows added during the
  test (snapshot by `id`), resetting `status`/`archived_*`, clearing `team_annotation` and
  `annotation_updated_*`, and restoring `display_order`. That last one runs into the
  `topics_team_active_order` partial unique index, so it needs the same negate-then-set two-step
  that TOPIC-006 uses (l.1397) inside one transaction. Spell this out in the task, or the
  "must not break other tests" promise won't hold.
- `POST /api/v1/teams` creates a team and a lobby session, and both need cleanup. The test also has
  to register `teamRoutes` and `facilitatorSessionRoutes` with a session hook, and
  `topics-integration.test.ts` does neither today.

### M2. The structural test must assert `error.code`, and must not rely on the template being locked

D4 says it runs "while the template is locked". It can't guarantee that: 4.2 and 4.5 insert a
`complete` sentinel session, and vitest runs files in parallel (there's no `fileParallelism`
override in `vitest.config.ts`). If the guard regresses while the template is unlocked, the `{}`
or `ffff…` requests return **404 `TOPIC_NOT_FOUND`** on 004/005 and 422 on 003/006/007. A
status-only assertion would wrongly pass on 004/005.

**Fix:** assert `status === 404 && error.code === 'TEAM_NOT_FOUND'`. Reword D4 to say the test is
*safe in either lock state* (with `{}` bodies and the random topic id, no route can write) and
*fails in either state* when it asserts the code. Drop "while locked" as a precondition. Task 2.2's
"confirm it fails with 409" then becomes "confirm it fails" (409 or 404 `TOPIC_NOT_FOUND`).

### M3. Pin down the structural test harness

- It has to be a **real-DB** test. A generic request loop can't be driven by the per-route mock
  sequences in `topics.test.ts`. D4's "same auth/session setup used by the existing route tests"
  should name the integration pattern: `Fastify()` + `decorateRequest("session")` + a hook that
  injects `{ userId }`, with modules imported dynamically after the env defaults are set
  (`topics-integration.test.ts` l.18 to 71). It also needs a standing-facilitator fixture user.
- `registerRoutes` pulls in `health.ts`, `auth.ts` and `teams.ts`, which import `redis.ts`, and
  `redis.ts` creates an eager `ioredis` client at import. The test must set `REDIS_URL` the way the
  other integration files do and call `redis.quit()` in `afterAll`, or it will leave open handles.
- Put `registerRoutes` in its own module (for example `src/routes/register-routes.ts`) and import
  it into `app.ts`. That way the test doesn't import `app.ts` itself, which also loads
  `@fastify/session`, the Redis store and helmet, and which coverage excludes. Keep the `/auth`
  prefix inside `registerRoutes` so the extraction really doesn't change behaviour.

## Should fix

- **S1. Prefix matching is brittle on the param name.** A future route declared as
  `/api/v1/teams/:id/topics/...` would slip past a literal `startsWith('/api/v1/teams/:teamId/topics')`.
  Match on `^/api/v1/teams/:[^/]+/topics(/|$)` instead, and substitute the sentinel into whatever
  the first param is called. Also handle `routeOptions.method` being an array, and treat any
  route with `ALL`/`*` in scope.
- **S2. Scope the audit-row assertions in 4.2.** The table sends many rows with the same
  facilitator, and other files (5.6, 4.5) write template-denial rows at the same time. "Exactly one
  row" needs a filter: `actor_user_id`, plus `timestamp >= rowStart`, plus `metadata->>'endpoint'`.
  A distinct actor per row is cleaner still.
- **S3. Unit test 3.2 should also assert that `applyTimingFloor` was called** on the audit-failure
  path, since that path's whole point is that it is indistinguishable from the missing-team path.
  It's mocked already, so this costs one line.
- **S4. The error log on audit failure.** `request.log.error({ err, ... })` serializes the pg
  error, and its `detail` can echo parameter values (actor IP, ids). That's acceptable (no body, no
  secrets), but note it in D3 so nobody later "fixes" it by logging the query parameters.

## Minor

- Extract the `{ actorUserId, actorGlobalRole, teamId, endpoint, attemptedOperation }` params type
  that `checkCustomizationLockGate`, `writeLockDenialAudit`, `checkWritableTeam` and
  `writeTemplateDenialAudit` all share, instead of declaring it inline a fourth time.
- Update the file-header check-order comment (l.37 to 55) and each handler's "Step 2" comment to
  mention the template rule. Otherwise the per-handler comments contradict the new helper.
- Task 1.4's "Confirm the call sits after authorization" can't be checked by the structural test,
  because it uses a facilitator who passes auth. It is covered by unit 3.1's engineer and admin-007
  `403` cases. Say so, so nobody assumes D4 enforces the order.
- Test 5.6's comment about parallel files touching sentinel rows becomes moot once the guard is in.
  When renaming the test, drop the `sentinelIds.length > 0` fallback too.

## Coupling and error-path summary

| Area | Assessment |
|---|---|
| Guard ↔ lock | Decoupled correctly. The guard runs before `hasCompletedFirstSession` and never calls it. |
| Guard ↔ seed/constant | Single import of `DEFAULT_TOPICS_TEAM_ID`. Fine. |
| Structural test ↔ app bootstrap | **Coupled through Redis import side effects** (M3). |
| Regression test ↔ copy semantics | **Coupled to `is_default` filter and status-blind copy** (M1). |
| Parallel tests ↔ sentinel lock state | **Shared mutable state** (M2, S2). The guard makes production lock-independent, but the tests still have to be written for it. |
| Audit failure | Caught, logged, same 404. Correct trade-off; no `500` unique to the template. |
| Slow DB beyond the 150 ms floor | Accepted residual. I agree it isn't worth a statement timeout. |
