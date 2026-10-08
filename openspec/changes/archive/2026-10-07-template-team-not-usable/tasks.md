# Tasks: template-team-not-usable (#214)

Tasks are listed in implementation order. Every task must leave the full backend suite green. Section 8 (read-surface verification) and section 9 (BRD note) have no code dependency on sections 2–7. They can run in parallel with those sections at any point after 1.2.

## 1. Database backstop

- [x] 1.1 **Before the migration**, rework #188's tests that seed template rows (design D9), so the suite stays green on the current schema and keeps passing once the constraint lands. In `routes/__tests__/template-team-topic-writes-integration.test.ts` and `routes/__tests__/template-team-creation-regression-integration.test.ts`, remove every template `sessions` and `team_memberships` seed. That means the `insertSentinelSession`/`insertSentinelMembership` helpers, all three membership-seeding tests (the "another user's sentinel membership" 404 test, the "`403 FACILITATOR_IS_TEAM_MEMBER`" test and the "4.3: TOPIC-001 (a member) reads the template" test) and the creation-regression test's `complete` template session. Replace each lock-state dimension with a hoisted `vi.mock` of `auth/topic-lock-helper.js` (not `vi.spyOn`) that stubs `hasCompletedFirstSession` for both the "unlocked" and "locked" states. Keep one test per dimension. Delete the "another user's sentinel membership" test with a comment pointing to 1.3, since no template membership can exist after this change. Leave the `403 FACILITATOR_IS_TEAM_MEMBER` test in place, still seeding its membership, until 1.2 replaces it in the same commit as the migration. Retire the TOPIC-001-member read with a comment pointing to 6.1's unit-level test, since no template member can exist after this change. Do not delete it silently. Move the remaining `/topics/all` part of that test (`canAddTopics`, lock flag) to the mocked form; 6.1 will update its expected lock values. Verify that the full backend suite passes on the current schema.
- [x] 1.2 Add migration `packages/backend/migrations/NN_template_team_not_a_subject.sql` using the next free number and the `-- Up Migration` / `-- Down Migration` form, per design D4. Steps, in order:
  - Run `SET LOCAL lock_timeout = '200ms'` and `LOCK TABLE sessions, team_memberships, join_links IN ACCESS EXCLUSIVE MODE` first. Add a header comment on retrying after a lock timeout, as migration 22 does.
  - Clean up before any constraint is added: revoke links, soft-remove memberships, abandon sessions in `draft`/`lobby`/`pre_session`/`active`/`wrap_up`, and clamp `complete` sessions' unexpired `facilitator_access_expires_at` to `now()`.
  - Write one `team.template_cleanup` audit row per changed table. The actor is the system user with `actor_global_role = 'system'`. Capture prior values before the update.
  - Add three `<table>_not_template_team` `CHECK … NOT VALID` constraints, with a comment pointing at `DEFAULT_TOPICS_TEAM_ID`.
  - Add a conditional `VALIDATE` `DO` block.
  - The down section drops the constraints only.

  Same task, because the suite is red without it: change 1.1's remaining `403 FACILITATOR_IS_TEAM_MEMBER` test to assert that the template membership insert is refused with SQLSTATE `23514`. Verify by running migrations on a fresh test DB, confirming `pg_constraint.convalidated = true` for all three tables, and checking that the full backend suite passes against the validated constraint. Also verify that `grep -rn "INSERT INTO \(sessions\|team_memberships\|join_links\)"` over the test tree finds no template-team seed outside the 1.4 scratch-schema test and the 1.3 refusal assertions.
  - *Implementation note (1.2, smallest adjustment):* `template-team-topic-writes-integration.test.ts` also held #187's task-4.8 pair ("TOPIC-001 on the template is 403 for an EM membership / a global EM with a participant membership"), which seeds template memberships and was not listed in D9. Both set-ups are now impossible, so the pair was collapsed into one test of the reachable case (a global EM with no membership gets 403 and no lock state), with a comment. The `insertSentinelMembership` helper is kept only for the `23514` refusal assertion. Migration file: `23_template_team_not_a_subject.sql`.
- [x] 1.3 Add a fresh-database constraint test in `public`. It runs after CI's migrations and needs no scratch schema. Assert that a direct template `INSERT` into **each** of `sessions`, `team_memberships` and `join_links` fails with `23514`, and that `UPDATE sessions SET team_id = <template>` on a real-team row fails with `23514` (default-topic-provisioning fresh-database and history scenarios). Verify the test passes.
- [x] 1.4 Add a migration integration test with history in the scratch schema (design-review B1, option (a): narrow to the data property). Follow `auth/__tests__/users-roles-schema-integration.test.ts`: split Up/Down, run on a single client with `SET LOCAL search_path TO <scratch>, public`, and assert `convalidated` only there. Before the migration, seed:
  - an open template link
  - an active template membership
  - a `lobby` template session
  - a `complete` template session with votes and `facilitator_access_expires_at` set to tomorrow

  Run the migration, then assert:
  - The scenario "Open template rows are closed and terminal history is kept".
  - The scenario "A recently completed template session no longer grants its facilitator access", **at the data level**. The completed session has `facilitator_access_expires_at <= now()`. `evaluateTeamAccess`'s path-3 predicate (`status = 'complete' AND facilitator_access_expires_at > NOW()`) returns no row for that facilitator when run in the scratch schema. No template session is in a status from `LIVE_FACILITATOR_STATUSES` (imported, not copied), and no template membership has `removed_at IS NULL`. Together, these are the rows `evaluateSessionSubscriberAccess` admits on (see 8.5).
  - The `team.template_cleanup` rows, with their prior values.
  - `convalidated = false` for `sessions`.
  - `23514` on a new template insert into each of the three tables, and on an `UPDATE sessions SET team_id = <template>`.

  Also assert that, while one connection holds the migration's lock, a concurrent template `INSERT` from another connection waits and is then refused, so no template row lands between cleanup and constraint. Verify the test passes.
- [x] 1.5 Add a no-op test: with no template rows, the migration changes no row in the three tables and writes no `team.template_cleanup` row. Verify the test passes.

## 2. Shared guard module and constraint-violation handling

- [x] 2.1 Create `packages/backend/src/teams/template-team-guard.ts` (design D2) with these functions:
  - `isTemplateTeam(id)`: normalises the value (strip one `{}` pair and all `-`, lowercase) and compares it with the imported `DEFAULT_TOPICS_TEAM_ID`.
  - `writeTemplateAccessDenial`: fail-open, and takes primitives (`actorUserId` nullable, optional `actorGlobalRole`, `actorIp`, `log`, `endpoint`, `surface`, `correlationId`). It writes `team.template_access_denied` with `metadata = { endpoint, surface }` only. It emits the structured event, which is added to `AuditEventName`. It resolves the role from `users` when none is supplied, and writes no row for a null actor. It deduplicates the row per actor and endpoint for 60 seconds with Redis `SET NX PX` (D2a), and writes the row if Redis errors. `AUDIT_WRITE_TIMEOUT_MS` bounds the lookup and the insert.

  Verify with unit tests:
  - `isTemplateTeam` is true for the canonical, upper-case, no-hyphen and braced template spellings, and false for a real team id and for non-strings.
  - The row has the correct shape and role, and its metadata holds no token or body.
  - A null actor writes no row.
  - **Both halves of the dedupe scenario:** a second refusal by the same actor on the same endpoint within the window writes no row and emits `audit_row_suppressed: true`. A refusal by that actor on a **different endpoint**, or on the same endpoint **after the window** (fake timers or a short test TTL), writes a row.
  - An insert failure or timeout logs `audit_write_failed: true` (code and message only) and does not throw.

  Add the module half of the source-inspection test: the module imports no config module and reads no `process.env` (default-topic-provisioning "The guard reads no configuration"). 3.1 adds the eligible-teams half.
- [x] 2.2 Handle constraint violations per design D5. Put the predicate and the marker logger (`isTemplateConstraintViolation`, `logTemplateConstraintViolation`) in their own file, `packages/backend/src/teams/template-constraint-violation.ts`. They belong to the database backstop and are kept separate from the app guard on purpose (D1). Wire them in as follows:
  - Register a narrow `setErrorHandler` at the top of `registerRoutes`. For a template violation it answers a fixed `500` that does not name the constraint. It rethrows every other error.
  - Add marker calls to the writer routes' existing fixed-`500` catches.
  - Add a marker call to the `/auth/callback` catch, before `mapAuthError`.

  Verify with tests:
  - A simulated template `23514` produces the marker and a `500` whose body has no `_not_template_team`.
  - A different `23514` and an unrelated thrown error produce no marker and the same body as before this change.
  - A template `23514` from `executeJoinFlow` is logged with the marker.

## 3. Session routes and picker

- [x] 3.1 Exclude the template from `GET /api/v1/teams/eligible-for-session` by binding `DEFAULT_TOPICS_TEAM_ID` as a parameter. Verify with integration tests for the session-creation scenarios "The template team is never listed", "Facilitator with zero home-team memberships still receives eligible teams" and "Fresh install where the template is the only team", and for the default-topic-provisioning FR-1.7 scenario "absent from the picker although it has no completed session". Add the eligible-teams half of 2.1's source-inspection test: the query's module reads no config module and no `process.env`. Inspect the changed query here.
- [x] 3.2 Guard `POST /api/v1/teams/:teamId/sessions/draft` per design D3, before the cross-team check and before any join-link minting. Verify with an integration test:
  - The response equals the missing-team response: same status, and same body apart from `correlationId`. There is no header or timing comparison.
  - No `sessions` or `join_links` row is created, and one audit row is written.
  - A non-facilitator still gets `403` with no audit row.
  - No cross-team denial row is written.
- [x] 3.3 Guard `advance`, `reveal`, `complete`, `topics/advance` and `GET facilitator-state` immediately after authentication, before the session lookup and before `getOrCreateJoinLink` (design D3). Verify with a table-driven integration test using an authenticated caller:
  - Each route returns its "Session not found." `404` with one audit row.
  - `facilitator-state` creates no `join_links` row.
  - The template's lock state is unchanged after `complete`.
  - A participant-role caller on `advance` gets the same `404` and one audit row, and the row's `actor_global_role` is `participant` (session-creation "The denial row records the actor's real role").
  - An unauthenticated caller gets `401` and no audit row.
- [x] 3.4 Verify that `GET /api/v1/teams/:teamId/sessions` and `GET …/sessions/:sessionId` answer the template as a missing team for a zero-membership facilitator and for an admin (session-creation "Team session-history reads never serve the template team"). No route-level guard is added. The completed-template-session facilitator case is covered by composing two things: 1.4's data-level assertion that the grant is closed, and the existing real-team expiry behaviour of `evaluateTeamAccess`. If no test yet shows that a real team's **expired** facilitator grant gets the missing-team answer on `/sessions` and `/sessions/:sessionId`, add one here. If a real-team expired grant is ever served, stop and fix `evaluateTeamAccess`, not the route. Verify with an integration test in `public`.

## 4. Membership and join-link routes

- [x] 4.1 Guard TEAM-006 `POST /api/v1/teams/:teamId/managers` after the admin `403` and the rate limiter. Verify with integration tests for all three manager-team-association scenarios.
- [x] 4.2 Guard `GET /api/v1/teams/:teamId/members` and TEAM-005 `PATCH …/members/:userId/role` per design D3. Verify with integration tests for the four role-assignment scenarios, including the non-admin members listing, which gets `403` and no audit row.
- [x] 4.3 Guard `POST /api/teams/:teamId/join-links` after `401` and before the membership check. Verify with an integration test: `403` "You are not a member of this team.", no `join_links` row, and one audit row with `surface: "join_link"`.
- [x] 4.4 Guard `GET /api/join/:token` and `executeJoinFlow` in `/auth/callback` on the link's `team_id`, immediately after the row is found and before the `is_active` check and the unauthenticated login redirect (design D3). Emit `join.link_rejected` with `reason: "template"`. `emitAuditEvent` takes untyped `fields`, so no type changes. Update the `join.link_rejected` field comment in `auth/audit-logger.ts` to list `"template"` next to `"not_found" | "revoked" | "expired"`. Verify with unit tests that stub the token lookup to return a template row, both active and revoked:
  - The response redirects to `/join-error?joinError=invalid`, never `expired`.
  - No membership is inserted.
  - A logged-in caller gets an audit row without the token.
  - A logged-out caller gets no login redirect and no audit row (event only).
  - Login completes on the callback path.

## 5. Structural coverage

- [x] 5.1 Add an `extraRoutes` option to `buildFullApp` and write the structural checker's probe self-test first, using an unguarded `POST …/sessions/__probe`. Verify that the checker reports failure both when the probe has no table entry and when it has an entry (sanitized `500` instead of `404`). This task comes before 5.2 so that 5.2's green result is shown to be able to fail.
- [x] 5.2 Add `team-template-guard-structural.test.ts` per design D8 and fill in its table:
  - Enumerate the routes: the prefix in any method, plus `EXTRA_IN_SCOPE_ROUTES`.
  - Give each route an entry with actor, request, expected response, evidence and floor. The floor column records each route's expected timing-floor behaviour as data. Nothing measures timing.
  - Fail for any selected route that has no entry.
  - Allow `refused-before-guard` only for the closed set of four keys in design D8, asserted by equality.
  - Send each `audit` route the no-hyphen and braced template spellings, and expect the same parity response and never `500`.
  - **Admin pass:** send each `audit` route an `application_admin` caller as well, expecting the same parity response and one denial row (design: "An administrator has no override").
  - **Unauthenticated pass:** every guarded route gets `401` and writes no denial row (scenario "Requests refused before the guard").
  - Clear the D2a Redis keys before each request.
  - No response body contains `_not_template_team`.
  - Zero new template rows exist after each request and in `afterAll`.

  Verify the test passes and lists every route found in exploration §3 plus the two `content.ts` reads.
- [x] 5.3 Add `team-template-guard-real-team-spelling.test.ts` for the default-topic-provisioning scenario "A real team's non-canonical spelling is unchanged" and the proposal's statement that no route gains a new rejection. For each `audit` route in 5.2's table, send the braced and no-hyphen spellings of a **real** team's id through two apps:
  - one built normally
  - one built after `vi.doMock` of `teams/template-team-guard.js` with `isTemplateTeam` stubbed to `false`, which is the "before the guard" baseline

  Assert the same status and body (apart from `correlationId`) from both apps, and no `team.template_access_denied` row. Verify the test passes.
- [x] 5.4 Add a source check that no new template UUID literal appears outside `migrations/` and the shared constant file. Verify by running it in CI with the test suite.

## 6. Topic lock reason

- [x] 6.1 Add `getTopicLockState` (design D6) in a **separate file**, `packages/backend/src/auth/topic-lock-state.ts`, which imports `hasCompletedFirstSession` from `auth/topic-lock-helper.js` and `isTemplateTeam` from 2.1. It must not live inside `topic-lock-helper.ts`: 1.1's module mock would replace it, and 6.2 forbids template references there. Switch TOPIC-001 and TOPIC-002 to it, and add `lockReason` to both responses. In `packages/shared/src/types/topic.ts`, add `TopicLockReason`, `lockReason` on `GetAllTopicsResponse`, and a new `GetActiveTopicsResponse` for TOPIC-001. Both handlers and the frontend use these types. In the same task, so no red window opens, update the template-reads tests that 1.1 moved to the mocked form ("Reads of the template are unaffected") to expect `isCustomizationLocked: true` and `lockReason: "canonical_defaults"`. Verify with:
  - API tests for the three topic-customization-lock cases (template via TOPIC-002, real locked team, real unlocked team) on both endpoints where reachable.
  - A unit-level test that TOPIC-001's handler calls `getTopicLockState`. This replaces the template-member read retired in 1.1.
  - A test that reuses 1.1's mock: the template stays `canonical_defaults` even when `hasCompletedFirstSession` returns true.
  - An extension of the TOPIC-001 denial test in `routes/__tests__/content.test.ts` (`expectTopicAndLockQueriesSkipped`) asserting that `getTopicLockState` is not called for a denied request, in addition to the existing SQL-text check (modified TOPIC-001 denied-caller clause).
- [x] 6.2 Add a source-level test that `auth/topic-lock-helper.ts` does not reference `DEFAULT_TOPICS_TEAM_ID` or the template literal. Verify the test passes.

## 7. Frontend

- [x] 7.1 In `TopicManagementPage`, choose the lock copy from `lockReason`. For `canonical_defaults`, show the "Default topics" heading, the canonical-defaults notice and no edit controls. For `first_session`, show the existing notice unchanged. Verify with component tests for all three topic-management-screen scenarios and the modified "A locked team shows no definition controls" scenario. The tests must show that `__default_topics__` appears nowhere in the rendered page or `document.title`, including the page's back links ("Back to team", `back-to-team-page`). No breadcrumb component exists today. If one is added before this lands, include it in the assertion.
- [x] 7.2 In `SessionCreationPage`, add the `404` branch with "This team is no longer available. Go back to choose another team." and a "Choose another team" button that returns to the picker step and re-fetches `eligible-for-session`. Keep the generic error for `5xx` and network failures, and the existing copy for `409` and `403`. Verify with component tests for all four session-creation confirm-step scenarios.
- [x] 7.3 Add regression tests that the existing empty state renders when the eligible list is empty because the template was the only otherwise-eligible team. Cover two cases: a facilitator who belongs to every real team, and a fresh install (zero memberships, the template is the only team), which shows the zero-home-team empty state with its Create control. Verify the tests pass.

## 8. Read-surface verification (design D7; a short checklist, one test per gate)

- [x] 8.1 Verify that EM views (`em-views.ts`: sessions, trends, action items) admit only active (`removed_at IS NULL`) EM memberships. Do this with an integration test in which a soft-removed EM membership gets no data. If the gate does not filter `removed_at`, file a separate issue linked to #214 and record it in the PR. Do not grow this change.
- [x] 8.2 Verify that action-item routes (`/api/v1/action-items/:id/*`) are membership-gated and ignore removed memberships. Do this with an integration test. If they are not, file a separate issue as in 8.1.
- [x] 8.3 Confirm that the registered route list has no cross-team admin session or trend view. Record the result in the PR description.
- [x] 8.4 List every registered `GET` route that has a `:teamId` parameter and sits outside the structural prefix. Today these are `/teams/:teamId`, `/trends`, `/action-items`, `/em/sessions`, `/em/sessions/:sessionId`, `/em/trends`, `/em/trends/:topicId`, `/em/action-items`, `/em/action-items/:actionItemId`, `/topics` and `/topics/all`. Put them in the PR description as a table with one line per route, naming the gate that closes it for the template (`evaluateTeamAccess`, EM membership, or other). The facilitator-grant path is covered at the data level by 1.4 and by `evaluateTeamAccess`'s real-team expiry behaviour (3.4). No further per-route tests are needed unless a route names a gate other than those two.
- [x] 8.5 Realtime layer. The proposal says the realtime layer is closed by the same gating. New subscriptions go through `evaluateSessionSubscriberAccess`, which admits a facilitator only for a session in `LIVE_FACILITATOR_STATUSES` and a participant only with a membership where `removed_at IS NULL`. 1.4 shows that, after the migration, neither kind of template row exists. Add one unit test in `realtime/__tests__/connection-reauthorization.test.ts`: when `evaluateTeamAccess` returns no grant for a connection on the template team, a single reauthorization sweep closes it. If an equivalent generic "no grant closes the connection" test already exists, cite it in the PR instead. Already-open sockets keep the residual of up to 5 minutes that design D4 accepts. If the sweep does not close the connection, file a separate issue as in 8.1.

## 9. Requirements traceability

- [x] 9.1 Append to `requirements/BRD.md` directly under FR-1.7, in the existing rationale-note style: "*Rationale (added by `template-team-not-usable`, #214; owning requirement: `default-topic-provisioning`):* the `__default_topics__` template row holds the canonical default topics and is not a team for this requirement. It never appears in the facilitator's list of available teams." Verify that `grep -n "#214" requirements/BRD.md` shows the note under FR-1.7.

## 10. Integration check

- [x] 10.1 Run the full backend and frontend suites and `openspec validate template-team-not-usable --strict`. Verify that all pass.
- [ ] 10.2 End-to-end check, manual or Playwright. First confirm that the local database has run all migrations, including 1.2. A local database with leftover template rows will show the constraints as `NOT VALID` (D9), which is expected. Then:
  - (a) As a facilitator with no memberships, open the picker from the team page's "Facilitate another team's session" link and confirm the template is absent.
  - (b) Open Topic Management for the template and confirm the canonical-defaults view, including the heading, the tab title and the back link.
  - (c) With the picker open, make the selected team unavailable and confirm the "This team is no longer available" message and the "Choose another team" button.
  - (d) Open an old template join link, logged out and logged in, and confirm the existing invalid-link page with no login detour.

  Record the result in the PR.

## Implementation notes (recorded during apply)

Smallest design-consistent adjustments, with rationale:

- **1.2:** the #187 task-4.8 pair in `template-team-topic-writes-integration.test.ts` (EM / global-EM template memberships) was not listed in D9 but seeds template memberships. Collapsed into one test of the reachable case (a global EM with no membership gets 403 and no lock state).
- **1.4:** to run the exact production predicates in the scratch schema, `FACILITATOR_GRANT_SQL` was extracted (unchanged) from `evaluateTeamAccess` and `LIVE_FACILITATOR_STATUSES` was exported from `session-subscriber-access-helper.ts`.
- **2.1:** the guard imports `redis.js` lazily (on the first refusal with an actor), so route unit tests that mock `db.js` but not `redis.js` never open an ioredis client against their fake `REDIS_URL`. A user with no `users` row writes no denial row (logged `audit_write_failed`), rather than a placeholder role.
- **3.3 (reveal):** `reveal` answers a session it cannot find for the team with its non-recoverable `409 reveal_failure`, not "Session not found." `404`. The template gets that `409` (parity with the missing-team answer, which is the governing rule in D3), with the audit row.
- **3.3 / 5.2 ("participant" role):** `user_role` has no `participant` value (that is a membership role). Tests use `engineer`, the global role of a participant, and assert `actor_global_role = 'engineer'`.
- **5.2 (draft, non-canonical spellings):** draft rejects a non-canonical `teamId` at its boundary before authorization (existing behaviour, not changed). Its braced/no-hyphen template spellings therefore get the same `404 TEAM_NOT_FOUND` parity response but no audit row, as #188's topic routes do. Recorded per entry (`boundaryRejectsNonCanonical`).
- **5.2 (admin pass on draft):** an admin fails draft's facilitator check, so the admin pass expects that `403` and no row there (`adminRefusedBeforeGuard`); every other audit route gives the admin the parity response and one row.
- **4.4:** `audit-logger.ts` had no `join.link_rejected` field comment to extend; one was added listing `"not_found" | "revoked" | "expired" | "template"`.
- **5.4:** the literal check covers backend/frontend/shared `src`; the seven test files that already spelled the literal out before #214 are a frozen baseline that may only shrink. New tests use the constant.

Implementation-review fixes (no design change):

- **Security F1:** the D2a slot is still claimed before the insert (so concurrent refusals cannot both write), but it is now released (`DEL`) when the insert fails or times out, so a lost row never suppresses the next one for 60 s. Unit-tested in `teams/__tests__/template-team-guard.test.ts`.
- **Security F2:** `reveal`'s template refusal passes a `correlationId` to the writer, like the other routes (its 409 body still carries none, matching the missing-session answer).
- **Security F3:** the dedupe key is now `dipstick:template-denial:<actor>:<endpoint>`.
- **Architect A1:** `boundaryRejectsNonCanonical` and `adminRefusedBeforeGuard` are closed sets (`BOUNDARY_REJECTS_NON_CANONICAL`, `ADMIN_REFUSED_BEFORE_GUARD`, draft only), asserted by equality in the structural test.

Findings needing a human:

- **8.2:** action-item routes (`/api/v1/action-items/:id/{status,owner}`) also admit the item's **owner** and anyone who **ever facilitated** a session for the team, independent of membership. The membership half ignores removed memberships (tested). A past template facilitator or template action-item owner can therefore still update template action items. Per 8.2, this needs a **separate issue linked to #214** (not filed by the implementing agent; no external writes were made).
- **8.3:** no cross-team admin session or trend view is registered (asserted in `template-team-read-surfaces-integration.test.ts`).
- **8.4:** team-addressed `GET` routes outside the structural prefix, and the gate that closes each for the template:

  | Route | Gate |
  |---|---|
  | `/api/v1/teams/:teamId` | other: active membership (`removed_at IS NULL`) or `application_admin`. Non-admins are closed (no template member can exist); an admin still reads the template's team record (its stored name and an empty member list, no session data). Not a session/membership/join-link write; noted for review |
  | `/api/v1/teams/:teamId/trends` | `evaluateTeamAccess` |
  | `/api/v1/teams/:teamId/action-items` | `evaluateTeamAccess` |
  | `/api/v1/teams/:teamId/em/sessions`, `/em/sessions/:sessionId` | EM membership (via `evaluateTeamAccess`, active only) |
  | `/api/v1/teams/:teamId/em/trends`, `/em/trends/:topicId` | EM membership |
  | `/api/v1/teams/:teamId/em/action-items`, `/em/action-items/:actionItemId` | EM membership |
  | `/api/v1/teams/:teamId/topics` | `evaluateTeamAccess` (TOPIC-001) |
  | `/api/v1/teams/:teamId/topics/all` | other: standing facilitator/admin (TOPIC-002); serves the template read-only by design (FR-8.6) |

- **8.5:** the generic "team-scoped: closes when the grant is null" test already existed; an explicit template-team case was added as well.
- **10.1:** backend, shared and frontend suites, lint and build pass. `openspec validate template-team-not-usable --strict` could **not** be run: the `openspec` CLI is not installed in this environment.
- **10.2:** not done (manual / Playwright end-to-end check against a running stack); left for a human.

## Workflow follow-up (non-code; tracked here, not implementation tasks)

- **Deploy gate: H1 must be recorded before deploy.** This PR may merge on approval, but it **must not be deployed** to any environment until the H1 pre-deploy counts for that environment are recorded in `proposal.md`. Add "H1 counts recorded" as a checklist item in the release step that runs the migration. Nothing in the repository enforces this gate, and CI does not deploy on merge. The H1 owner (Devon Calloway by default) is **pending Brian's confirmation**. That confirmation is a human decision and is not part of implementation.
- H1 (due before deploy): run the pre-deploy data check in each environment and record the counts in `proposal.md`. If any non-terminal template session exists, the deploy must run in a window with no running sessions (design D4). If any template `sessions` row exists, file a "Facilitator practice mode" issue linked to #214, labelled for the onboarding backlog and Rachel Okonkwo's review, before archive. Otherwise record "no evidence of practice use".
- H3 (owner: Devon Calloway; **non-blocking**, so neither deploy nor archive waits on it): ask the current champions whether they would have used a rehearsal mode, and record the answer in `proposal.md`. This happens whatever H1 finds.
- H2: Brian confirms the default, which is to keep historical terminal template sessions and votes, frozen. If he chooses deletion instead, it becomes a separate data-remediation task.
- Request a security review on the PR (follow-up to #188 design-review-security B1).
- Archive the change once the reviews, H1 and H2 are recorded.

## Task-review feedback disposition

**Architect (Ingrid Sollenberger)**
- B1 HTTP tests against a scratch-schema fixture: **accepted, option (a).** The app's pool cannot see the scratch schema. 1.4 now asserts the grant is closed in the data, and 3.4 composes that with the real-team expired-grant coverage and keeps the zero-membership and admin cases in `public`. Option (b), a scratch-schema app harness, was rejected as test infrastructure this change should not carry.
- B2 suite red from the migration until #188's rework: **accepted.** The mock rework (1.1) comes before the migration. The `23514` replacement for `FACILITATOR_IS_TEAM_MEMBER` lands in the migration task (1.2), because the test cannot stay green on either side of the constraint. The TOPIC-001-member read is retired with a pointer to 6.1.
- R1 6.1 and 6.3 together: **accepted.** They are merged into 6.1.
- R2 lock-state function file: **accepted.** It goes in a separate file, `auth/topic-lock-state.ts`.
- R3 predicate home: **accepted, separate file.** `teams/template-constraint-violation.ts` is built in 2.2, after the guard module.
- R4 split the source-inspection test: **accepted.** The eligible-teams half moves to 3.1.
- M1 `/em/sessions` routes: **accepted** (8.4). M2 probe before the checker: **accepted** (5.1 before 5.2). M3 type change: **accepted with a correction.** The code shows `emitAuditEvent` fields are untyped, so only the field comment changes (4.4). M4 migrations applied before 10.2: **accepted.** M5 H1 on the release checklist: **accepted** (deploy-gate follow-up).

**BA (Marcus Delgado)**
- B1 real-team non-canonical ids unchanged: **accepted** (5.3, comparing against a baseline with the guard stubbed out).
- B2 realtime layer: **accepted with a change.** A test that uses 1.4's fixture through the app is impossible (see Architect B1). 1.4 instead asserts the rows that subscriber access admits on, and 8.5 tests that the reauthorization sweep closes the connection.
- B3 H1 owner: **accepted as a deploy gate, not an implementation blocker.** It is recorded as a follow-up item. Confirming the owner is left to Brian.
- S1 (1.3, 1.4), S2 (7.1: no breadcrumb component exists; back links are asserted), S3 (6.1, extending `content.test.ts`), S4 (3.3), S5 (5.2 admin pass), S6 (5.2 unauthenticated pass) and S7 (2.1): **all accepted.**
- M1 (3.1), M2 (10.2 c and d): **accepted.** M3: **accepted.** H3 is marked non-blocking.
