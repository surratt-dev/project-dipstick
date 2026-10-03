> **Ordering rule.** Every task ends with the backend compiling and the suites touched so far green. Section 6 (human merge gates) runs in parallel with sections 0 to 5 and 7. It blocks the merge, not the implementation. The implementer does not perform section 6.

## 0. Discovery (before any code change)

- [x] 0.1 Lock-dependence check (was 5.1). Grep the test suites for `00000000-0000-0000-0000-000000000001` and `SENTINEL_TEAM_ID`. Known hits: `default-topics-seed-integration.test.ts`, `default-topic-provisioning-integration.test.ts`, `facilitator-sessions.test.ts`, `helpers/real-db.ts`, `room-open-integration.test.ts`, `topic-annotation-integration.test.ts`, `topics-integration.test.ts`.
  - Confirm that `topics-integration.test.ts` "5.6" is the only assertion that depends on the lock protecting the template. If you find a second one, add a task for it next to 1.5 before starting section 1.
  - In the PR description, list each file as "unaffected" or "updated".
  - In the PR description, add one line on the known UI symptom: Topic Management shows "Team not found." inline on the template team until F1 lands. This is expected, not a regression (BA M5).

## 1. Guard implementation (`packages/backend/src/routes/topics.ts`)

- [x] 1.1 Import `DEFAULT_TOPICS_TEAM_ID` from `../sessions/default-topics.js`. Do not add a second copy of the literal.
- [x] 1.2 **Neutral refactor.** Extract the shared `TopicWriteDenialContext` type (`{ actorUserId, actorGlobalRole, teamId, endpoint, attemptedOperation }`) and retype the existing `checkCustomizationLockGate` and `writeLockDenialAudit` to use it. Behaviour does not change. Check: the existing unit and integration suites pass unchanged.
- [x] 1.3 **New helper.** Add `writeTemplateDenialAudit(request, ctx, correlationId)`.
  - It inserts one `audit_log` row with `operation = 'topic.write_denied_template'`, `actor_user_id`, `actor_global_role`, `actor_ip` and `team_id = DEFAULT_TOPICS_TEAM_ID` set from the context and request, and `metadata` containing only `{ endpoint, attempted_operation }`. `correlationId` is not in `metadata`.
  - It wraps only the insert in `try/catch`. On error it logs `request.log.error({ audit_write_failed: true, operation, correlationId, dbErrorCode: err.code, dbErrorMessage: err.message }, ...)`: never the raw `err`, never the request body.
  - On **both** outcomes it then emits `topic.write_denied_template` via `emitAuditEvent` with actor, role, IP, team, endpoint, attempted operation, `correlationId` and `auditRowWritten`, and returns normally (design D3).
- [x] 1.4 Add `checkWritableTeam(request, reply, params, startTime)` **alongside** `checkTeamExists` (both exist after this task, so the build stays green).
  - It runs the existing existence query and returns the existing 404 when there is no row.
  - Then, if `teamId === DEFAULT_TOPICS_TEAM_ID`, it builds the envelope `buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND")` first, calls `writeTemplateDenialAudit` with that envelope's `correlationId`, applies `applyTimingFloor`, and sends `404` with that same envelope through the same `reply`.
  - It sets **no** header itself, so per-endpoint header parity holds automatically.
  - Add the helper's header comment required by design D1. Update the file-header check-order comment (l.37 to 55) to name the template rule, and point it at `EXTRA_IN_SCOPE_ROUTES` in the structural test (task 3.3) as the place to register any topics-writing route outside the prefix (BA M4).
- [x] 1.5 Switch all five handlers (TOPIC-003 to 007) from `checkTeamExists` to `checkWritableTeam`, then remove `checkTeamExists`.
  - Pass each endpoint's existing method-plus-path `endpoint` string, plus `attemptedOperation`: 003 `topic.custom_added`, 004 `topic.archived`, 005 `topic.restored`, 006 `topic.reordered`, 007 `topic.annotation_updated`.
  - Update each handler's "Step 2" comment to name the template rule.
  - Confirm in every handler that the call sits after authorization and before `checkCustomizationLockGate`. This order is enforced by unit test 2.1, not by the structural test (design D1).
- [x] 1.6 Fix the one existing test the guard changes (was 4.1). Update `topics-integration.test.ts` test "5.6" (l.746): expect `404 TEAM_NOT_FOUND`, no `topic.write_denied_locked` row, and one `topic.write_denied_template` row. Rename it to describe the template-team rule, and drop its parallel-files comment and `sentinelIds.length > 0` fallback. Check: the full backend suite is green again.

## 2. Unit tests (`routes/__tests__/topics.test.ts`, `topic-annotation.test.ts`)

These depend only on section 1 and give fast mocked feedback before the real-DB work.

- [x] 2.1 Check order and normal template path. The existing mock call order for non-template teams passes unchanged (design D2). For each endpoint against the template:
  - 404 `TEAM_NOT_FOUND`, and the lock helper is not called;
  - the template audit insert is issued once with `team_id = DEFAULT_TOPICS_TEAM_ID`, the actor columns, and `metadata` equal to `{ endpoint, attempted_operation }` with the mapped `attempted_operation` and no `correlationId` key (BA B3);
  - `applyTimingFloor` was called before send (BA B2);
  - `emitAuditEvent` was called once with `topic.write_denied_template`, actor, role, IP, team, endpoint, attempted operation, the response's `correlationId` and `auditRowWritten: true` (BA B3).

  Against the template, an engineer gets 403 with no audit insert, and an `application_admin` on TOPIC-007 gets 403 with no audit insert.
- [x] 2.2 Audit failure (BA B2, security B2). Make the template audit insert reject. Run on one endpoint without `no-store` (003) and one with it (006). Assert:
  - the response is the same 404 envelope, not 500;
  - headers: 003 has no `Cache-Control`; 006 has `Cache-Control: no-store` (BA M2);
  - the lock helper is not called (BA M2);
  - `applyTimingFloor` was called;
  - an error-level log is emitted with `audit_write_failed: true`, `dbErrorCode`, and the response's `correlationId`, and without an `err` object;
  - the `topic.write_denied_template` event is still emitted with actor, role, IP, endpoint, attempted operation, the response's `correlationId` and `auditRowWritten: false`.
- [x] 2.3 Non-canonical template spelling (BA M1). In the existing `describe("topic write routes — non-canonical teamId ...")` block in `topics.test.ts`, add the hyphenless and braced spellings of `DEFAULT_TOPICS_TEAM_ID` to `spellings`. The block already asserts 404 `TEAM_NOT_FOUND` with no DB query, which proves the scenario's "no `topic.write_denied_template` row" clause for the template's own non-canonical forms.

## 3. Shared real-DB harness and structural route test

- [x] 3.1 **Neutral refactor** (was 2.1). Move the "Routes" block of `buildApp()` (`packages/backend/src/app.ts` l.104 to 114) into a new module `packages/backend/src/routes/register-routes.ts` exporting `registerRoutes(app)`, keeping the `/auth` prefix inside it. `buildApp` imports and calls it at the same point. In `routes/__tests__/helpers/real-db.ts`, add `register-routes.js` to `loadModules()` and a small builder (for example `buildFullApp(mods, userId, onRoute?)`) that creates `Fastify()`, `decorateRequest("session", null)`, the `onRequest` session hook, an optional `onRoute` hook registered before `registerRoutes`, then `registerRoutes`. Do not import `app.ts`. Check: the full suite is green, no behaviour change.
- [x] 3.2 **Shared template snapshot helper** (split out of old 4.5; architect B1). Add it under `routes/__tests__/helpers/` (in `real-db.ts` or a sibling file) with three functions:
  - `snapshotTemplate(db)`: every template `topics` row in every status, keyed by `id`, with `name`, `prompt`, `vote_type`, `display_order`, `status`, `is_default`, `archived_*`, `team_annotation`, `annotation_updated_*`;
  - `assertTemplateUnchanged(db, snap)`: same ids, no extra rows, same values;
  - `restoreTemplate(db, snap)`: in one transaction, delete template rows not in the snapshot, reset status/archive/annotation fields, and restore `display_order` with the negate-then-set two-step (`topics.ts` l.1397).

  Add a short real-DB self-test for the helper: snapshot, mutate a template row's annotation and `display_order` directly, restore, assert unchanged. Follow the REQUIRE_DB rule (`probeInfra` / `requireInfraOrThrow`).
- [x] 3.3 **Structural route test** (was 2.2; design D4).
  - Use the shared harness from `helpers/real-db.ts` (env defaults, `loadModules`, `Fixture`) and the builder from 3.1. Do not copy the `topics-integration.test.ts` l.18 to 71 harness. Use a `Fixture` standing-facilitator user, and clean up through `fx.cleanup()` and `redis.quit()` in `afterAll`.
  - **REQUIRE_DB rule:** call `requireInfraOrThrow` so the test fails loudly in the `integration.yml` lane and never skips silently there. It is the only mechanism that enforces coverage for future routes.
  - It collects routes through the `onRoute` hook. In scope: `url` matches `^/api(/v\d+)?/teams/:[^/]+/topics(/|$)` (widened from `/api/v1` only by S-1 below) and the method set (normalize `routeOptions.method` to an array) contains `POST`/`PUT`/`PATCH`/`DELETE`/`ALL`/`*`; plus the `EXTRA_IN_SCOPE_ROUTES` list (empty, with a comment saying that the author of any `topics`-writing route outside the prefix adds it here). No exemption list.
  - It asserts the five known routes are present.
  - It sends each route the deterministic request: the fixture facilitator, the first path parameter (whatever its name) = `DEFAULT_TOPICS_TEAM_ID`, other path parameters `ffffffff-ffff-4fff-bfff-ffffffffffff`, body `{}`. It asserts `404` **and** `error.code === "TEAM_NOT_FOUND"` **and** exactly one `topic.write_denied_template` row scoped by fixture `actor_user_id`, `timestamp >=` request start, and `metadata->>'endpoint'`. No lock-state precondition.
  - It takes `snapshotTemplate` (3.2) before the requests, calls `assertTemplateUnchanged` after each request, and calls `restoreTemplate` in `finally`.
  - Check that the test can fail: bypass the guard locally once, confirm it fails (409 when locked, or 404 `TOPIC_NOT_FOUND`/422 when unlocked), and note this in the PR description.

## 4. Integration tests (real DB, design D5)

All files in this section use `helpers/real-db.ts` (`Fixture`, `probeInfra` / `requireInfraOrThrow`). **Never call `fx.track(SENTINEL_TEAM_ID)`**: `Fixture.cleanup()` deletes a tracked team's topics, sessions and team row. Sentinel sessions and sentinel membership rows are inserted and deleted by id in each test's own `try/finally`.

- [x] 4.1 **One table-driven parity suite.** Rows: the five endpoints × {locked, unlocked} × {facilitator; admin for 003 to 006}, using the harmless bodies from D5. Use a `try/finally` to insert and remove the `complete` sentinel session for the unlocked rows. Send each row against the template and against a canonical nonexistent `teamId`, then assert:
  - the status, the body (apart from `correlationId`), and the header names and values (apart from `date`) are equal;
  - exactly one `topic.write_denied_template` row exists, scoped by a distinct fixture actor per row, `timestamp >=` row start and `metadata->>'endpoint'`, with exact `metadata` and no extra keys, `team_id = DEFAULT_TOPICS_TEAM_ID`, `actor_global_role` equal to the row's role (`facilitator` or `application_admin`) on every row, and `actor_ip` not null (BA B1);
  - no lock-denial row and no success row exist, and no audit row exists for the nonexistent-team request.
- [x] 4.2 **403, membership and real-team rows** (a few extra cases in the same file):
  - an engineer gets 403 `NOT_A_FACILITATOR` on every endpoint (BA M3), and an admin on TOPIC-007 gets 403, with no template-denial row in either case;
  - with a sentinel membership row for another user, a facilitator gets 404 on every endpoint (003 to 007);
  - with a sentinel membership row for the caller, a facilitator gets 403 `FACILITATOR_IS_TEAM_MEMBER` on every endpoint (003 to 007) **and no template-denial row is written** (BA B4), and an admin gets 404 on 003 to 006;
  - on an unlocked real team, archiving and then restoring a default topic gives 200/200 with `topic.archived` and `topic.restored` rows.

  Clean up membership rows by id in `try/finally`.
- [x] 4.3 **Reads** (TOPIC-002 and `/topics/all` on the template). TOPIC-002 returns the same rows and order. `/topics/all` returns 200 with `canAddTopics: true`, and `isCustomizationLocked` follows the lock.
- [x] 4.4 **Team-creation regression (BA S6, engineer M1)**, in its own integration file, built with the 3.1 builder (or `teamRoutes` + `facilitatorSessionRoutes`) and the session hook.
  - With a completed sentinel session in place, take `snapshotTemplate` (3.2).
  - Send *valid* writes to 003 to 007 and assert each returns `404 TEAM_NOT_FOUND`.
  - Call `assertTemplateUnchanged`. This catches an add regression, which the copy would never pass on.
  - Call `POST /api/v1/teams` and assert 201. The new team's rows, in every status, must equal the snapshot's `is_default = true` rows.
  - In a `finally`: `restoreTemplate`, then remove the sentinel session by id, and the new team's lobby session, topics, memberships and team row (tracking the new team in the `Fixture` is fine). The test must not make other tests fail.

## 5. Full-suite check

- [x] 5.1 Run the full backend suite (unit lane and real-DB lane with `REQUIRE_DB` set). Both must pass. The old 5.1 grep moved to 0.1.

## 6. Pre-merge human actions (MERGE GATES: the implementer does not perform these)

These run in parallel with the implementation and block only the merge.

> **Archive note (2026-10-02):** This change was archived with 6.1, 6.2 and 6.3 intentionally still open. They are human-only merge gates and must be completed before the PR for #188 merges.

- [ ] 6.1 **[Human, named owner]** Name the data check owner in `proposal.md`, then run read-only queries in dev, staging and prod against the pass criteria in `proposal.md` "Pre-merge human actions":
  - zero `complete` sentinel sessions (record the count in any status);
  - every sentinel topic has `is_default = true` and `active`, with no annotation;
  - sentinel `(name, prompt, vote_type, display_order)` equals `4_seed_data.sql` + `11_default_topics_correction.sql`;
  - no duplicate active `display_order`;
  - zero `team_memberships` rows with `team_id = DEFAULT_TOPICS_TEAM_ID`, whatever `removed_at` is (security B1).

  Make no writes.
- [ ] 6.2 **[Human]** Record environment, date, operator and pass/fail for each environment in `proposal.md`. If any check fails, file F4 and treat it as blocking. Do not fix data inside this change.
- [ ] 6.3 **[Human]** File F1 (high priority, next in the Topic Management milestone, with F2 folded in, carrying the required content in `design.md` Open Questions: the managers, member-role, join-link and join-redemption routes named as in-scope, the structural-test pattern carried over, and a security-review tag), F5 (administrator maintenance path for the defaults, or link an existing issue), and F3. Link the issue numbers in `proposal.md` and `design.md` Open Questions. F1 must be linked before merge.

## 7. Documentation and validation

- [x] 7.1 Add a *Rationale* under FR-8.1 in `requirements/BRD.md`, in the style of the FR-8.7 note: "the team-scoped topic-write endpoints (TOPIC-003 to TOPIC-007) are not the Application Administrator maintenance path and reject the template team. Until a dedicated maintenance endpoint exists (F5), the default set is maintained through database migrations only, and the 'maintainable by an Application Administrator' clause is not yet met through the UI." Cite `default-topic-provisioning` and #188. This task has no code dependency and can be done at any point.
- [x] 7.2 Run `openspec validate reject-template-team-topic-writes --strict` and the full backend test suite. Both must pass.

## Task review disposition

**Architect (Ingrid Sollenberger).** All accepted.
- B1: snapshot helper split out as 3.2, placed before the structural test (3.3) and the team-creation test (4.4), with its own self-test.
- B2: the "5.6" fix moved to 1.6, directly after the handler switch.
- B3: the lock-dependence grep moved to 0.1, before any code change.
- S1: old 1.2 split into 1.2 (neutral refactor) and 1.3 (new helper).
- S2/S3: 1.4 adds `checkWritableTeam` alongside `checkTeamExists`. 1.5 switches call sites, updates the "Step 2" comments and removes `checkTeamExists`.
- S4: unit tests are now section 2, right after the guard.
- S5: 3.1 extends `helpers/real-db.ts` with `registerRoutes` and a builder. Sections 3 and 4 reuse it. The rule "never track the sentinel" is stated at the head of section 4. 3.3 states the REQUIRE_DB rule.
- S6: 7.1 is marked independent. The human-gates note is in the ordering rule at the top and in section 6.

**BA (Marcus Delgado).** All accepted.
- B1: the columns are named in 1.3 and asserted in 4.1.
- B2/B3: the floor, the event with `auditRowWritten: true`, and "no `correlationId` in metadata" are asserted in 2.1.
- B4: the no-row assertion and endpoint coverage are added to 4.2.
- M1: resolved by adding the template's non-canonical spellings to the existing non-canonical unit block (2.3). It already asserts zero DB queries, which proves no audit row is written. We did not add a new real-DB test, because the rejection runs before any query.
- M2: added to 2.2.
- M3: added to 4.2.
- M4: added to the file-header comment in 1.4.
- M5: added as a PR-description line in 0.1.

**Rejected:** none.

## Implementation review disposition

**Architect (Ingrid Sollenberger).**
- B1 (self-test races the parallel snapshot users): **fixed** with option (a). The snapshot helpers take an optional `PoolClient`. The self-test snapshots, mutates, restores and asserts inside one transaction and rolls it back, so it never commits a mutation.
- S1 (residual flake risk): **recorded here as a known residual.** The structural test and the team-creation regression can still fail `assertTemplateUnchanged` if `default-topic-provisioning-integration.test.ts` (atomic `is_default` swap) or `topic-annotation-integration.test.ts` (direct template annotation) mutates the template inside their window. Once B1 is fixed this can cause a flake, never corruption. **On the first such flake, serialize the template-touching files** (move them into one file, or share an advisory lock between the swap and the snapshot helper). Do not loosen the assertion.
- S2: **accepted**, note added to `design.md` D5 "Restore".
- S3: **accepted**, the fields the restore skips are listed in `restoreTemplate`'s doc comment.
- S4: **accepted**, `teamNotFoundEnvelope()` in `topics.ts` is used by the non-canonical, missing-team and template 404s.

**Security (Tomás Ferreira).**
- S-1: **accepted**, the structural prefix is now `^/api(/v\d+)?/teams/:[^/]+/topics(/|$)`.
- S-2 (serialize template-touching files now): **declined for this change**, same residual as architect S1 above. Serializing needs a vitest config change or an edit to the provisioning suite, and three consecutive full real-DB runs showed no flake. Apply the remedy above on the first flake.
- S-3: **accepted**, comment on `dbErrorMessage` in `writeTemplateDenialAudit`.
- S-4: **accepted**, comment on `templateUrl` in the structural test.
