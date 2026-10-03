# Design: reject-template-team-topic-writes (#188)

## Context

All five team-scoped topic-write handlers in `packages/backend/src/routes/topics.ts` (TOPIC-003 at
l.740, 004 at l.908, 005 at l.1119, 006 at l.1281, 007 at l.1483) run the same sequence:

1. `rejectNonCanonicalTeamId` (404)
2. the endpoint's authorization wrapper (403)
3. `checkTeamExists` (404, l.154), which is a `SELECT id FROM teams WHERE id = $1`
4. `checkCustomizationLockGate` (409, l.223), which calls `hasCompletedFirstSession` and writes
   `topic.write_denied_locked` before the response
5. endpoint-specific checks and the write

`checkTeamExists` has exactly five callers, all of them these handlers. The template team row
exists and nobody is expected to hold a membership on it, so every standing facilitator passes
authorization against it, and so does every administrator on 003 to 006. "No memberships" is an
assumption, not an enforced fact: `POST /api/v1/teams/:teamId/managers` can create one (security
review B1). The guard does not depend on it, and the pre-merge data check now verifies it. Today only step 4 stops a write, and
only while the template has no completed session. See `proposal.md` for why that matters, and
`exploration-notes.md` §2 for the evidence and how confident each claim is.

The sentinel id is exported once, as `DEFAULT_TOPICS_TEAM_ID` from
`packages/backend/src/sessions/default-topics.ts`, and is already imported by `content.ts` and
`facilitator-sessions.ts`. The literal has no hex letters, and `rejectNonCanonicalTeamId` already
rejects other spellings, so a plain `===` comparison cannot be bypassed.

None of the topic routes declares a Fastify `schema` (`grep schema topics.ts` returns nothing). All
body validation happens inside the handler and returns 422. That resolves the T1 caveat in the
exploration notes: a structural test can send any body and still reach the guard.

Stakeholders: facilitators (team creation must keep working), the BA (the specs must stay
consistent), and incident reviewers (the audit trail).

## Goals / Non-Goals

**Goals:**
- No team-scoped topic-write endpoint can change the template's `topics` rows, whatever the
  session history or membership.
- A rejection is the same response that endpoint sends for a nonexistent team: status, body
  (apart from `correlationId`), headers (apart from `date`), and timing floor. The two differences
  accepted in the spec are the only exceptions.
- A future topic-write endpoint cannot ship without the guard unless CI fails.
- Behaviour for every non-template team stays the same.

**Non-Goals:**
- Making the sentinel unusable as a session team, or removing it from the facilitator picker (F1).
- Other team-scoped writes such as join links, managers and role changes (F2, folded into F1).
  The security review found that these routes form a membership-creation chain on the sentinel
  (managers → join links → redemption). They are named in F1's required content (see Open
  Questions) and are **not** changed here.
- Data-layer enforcement of the template invariant, such as a `BEFORE INSERT/UPDATE/DELETE`
  trigger on `topics` with a session-local opt-in (security review S4). Considered and deferred to
  F3, see Risks.
- Hardening the team-creation copy or `defaultTopicsNotActive` (F3).
- Repairing template data in any environment (F4). This change does not run anything against
  shared environments or production.
- An Application Administrator maintenance path for the defaults (FR-8.1, follow-up F5). The spec forbids
  meeting that need by relaxing this guard.
- Any frontend change. In the normal state, Topic Management for the template is read-only.

## Decisions

### D1. Replace `checkTeamExists` with `checkWritableTeam`, which does existence then template (option B, modified)

The five handlers call a new `checkWritableTeam(request, reply, { actorUserId, actorGlobalRole,
teamId, endpoint, attemptedOperation }, startTime)` in place of `checkTeamExists`. It:
1. runs the existing `SELECT id FROM teams WHERE id = $1`, and on no row returns the existing
   404 (no change),
2. then, if `teamId === DEFAULT_TOPICS_TEAM_ID`, attempts the `topic.write_denied_template` audit
   row and structured event (a failure is caught and logged, see D3), applies `applyTimingFloor`,
   and sends the same 404 envelope through the same `reply`. It sets no header of its own, so the
   template 404 carries exactly the headers that endpoint's missing-team 404 carries: `no-store` on
   006/007, which set it at handler entry, and none on 003/004/005.

On the template branch it builds the 404 envelope **first**, so that the envelope's
`correlationId` can be passed to the audit helper (D3), and then sends that same envelope object.

`checkTeamExists` is removed, because it has no other callers. The function carries a header
comment that names this change and the owning `default-topic-provisioning` requirement. The
comment also says that the template check belongs inside the existence step on purpose, and must
not be moved after the lock. The file-header check-order comment (`topics.ts` l.37 to 55) and each
handler's "Step 2" comment are updated to name the template rule, so they don't contradict the
helper.

The `{ actorUserId, actorGlobalRole, teamId, endpoint, attemptedOperation }` shape, now shared by
`checkCustomizationLockGate`, `writeLockDenialAudit`, `checkWritableTeam` and
`writeTemplateDenialAudit`, is extracted into one local type (`TopicWriteDenialContext`) in
`topics.ts` instead of being declared inline a fourth time.

The check order (template step after authorization) is **not** enforced by the structural test
(D4), because that test uses a facilitator who passes authorization. It is enforced by unit cases
3.1 (engineer `403`, and administrator `403` on TOPIC-007, both with no audit insert).

*Alternatives considered:*
- **A. A separate `rejectTemplateTeam()` call after `checkTeamExists`.** It is easier to grep, but
  each new handler has to remember a second call. That makes the protection depend on the
  author's habit.
- **B as written in the notes (`checkTeamExists` answers 404 for the sentinel).** Close to this
  decision, but the audit row needs the actor, the endpoint and the operation, which the current
  signature lacks. Renaming the function makes the change in its contract visible to anyone
  reading the call site.
- **A route-level `preHandler` hook keyed on the path prefix.** It would cover future routes
  automatically, but it would run **before** authorization. That breaks the required check order:
  unauthorized callers would get 404 instead of 403, and administrators calling TOPIC-007 would get
  404 instead of 403. Rejected.

The structural test (D4) is what actually guarantees coverage. D1 only makes the guard the
easiest thing for a new handler to use.

### D2. Compare a constant after the existence query, and add no extra DB round trip

The template check runs on the result of the existing query, against the imported constant. On
any non-template team the sequence of DB calls is the same as today, so the mock call order in
`routes/__tests__/topics.test.ts` does not change. The sentinel row exists in every seeded
database, so whether the constant check runs before or after the query makes no difference to
behaviour. Running it after keeps the spec's wording, "after team existence", literally true.

### D3. The audit uses a separate operation name, written inside the timing floor

`topic.write_denied_template` is a new `writeTemplateDenialAudit` helper with the same column
layout as `writeLockDenialAudit`, including `metadata: { endpoint, attempted_operation }`.
`audit_log.operation` is free `TEXT` (`8_audit_log.sql` l.35), so no migration is needed. It is
kept separate from `topic.write_denied_locked` so that incident review can tell "someone touched
the template" apart from ordinary lock friction, and because reusing the lock operation would tie
the rule back to the lock. The insert runs before `applyTimingFloor` returns. The timing floor
(150 ms) absorbs the audit write's latency on the template path, just as it already does on the
lock path.

**Failure handling (BA B2, revised for security review B2).** `writeTemplateDenialAudit(request,
ctx, correlationId)` wraps only the insert in `try/catch`. The structured event is then emitted
**on both outcomes**, so the structured log is a complete fallback audit record when the row is
lost:

- `emitAuditEvent(request.log, "topic.write_denied_template", { actorUserId, actorGlobalRole,
  actorIp, teamId, endpoint, attemptedOperation, correlationId, auditRowWritten })`, where
  `auditRowWritten` is `true` after a successful insert and `false` after a failed one.
  `correlationId` is the one in the 404 body, so an incident reviewer can join a user's report to
  the log line. It goes in the event only. The `audit_log.metadata` stays exactly
  `{ endpoint, attempted_operation }`, as the spec requires.
- On failure only, an additional `request.log.error({ audit_write_failed: true, operation:
  "topic.write_denied_template", correlationId, dbErrorCode: err.code, dbErrorMessage:
  err.message }, "topic.write_denied_template audit insert failed")`. The `audit_write_failed: true`
  key is the stable, greppable marker a future alert can match without a code change. The raw `err`
  object is **not** logged, because a pg error's `detail`/`parameters` can echo bound values. The
  request body is never logged.

This follows the house fail-open pattern (`auth/fail-open-audit-write.ts`, which emits
`auth.audit_write_failed` on a lost row) in spirit, but it does not reuse the `auth.*` event name,
because that event and its docs are scoped to the auth fail-open group. No alert is configured
under this change; the marker only makes one possible. The helper returns normally either way, and
the caller sends the ordinary 404. This differs from `writeLockDenialAudit`, which lets the error reach
the global handler as a 500. That path is not changed here. The template rule's job is "no write"
plus "looks like a missing team". The audit row is secondary, and a 500 that only the template can
produce would undo the second part. **Latency:** no extra mechanism, such as a statement timeout or
writing after the response. An insert slow enough to pass the floor needs a degraded database,
and the sentinel id is public anyway. This residual is written into the spec as an accepted
difference, and it is not tested.

### D4. The structural route test enumerates registered routes, never a hand-written list

**Extraction.** The route registrations in `buildApp()` (`app.ts` l.104 to 114, the "Routes"
block only) move into a new module, `packages/backend/src/routes/register-routes.ts`, exporting
`registerRoutes(app)`. `buildApp` imports and calls it at the same point, so behaviour does not
change. The `/auth` prefix stays inside `registerRoutes`. WebSocket routes, `authMiddleware`,
`@fastify/session`, the Redis session store and helmet stay in `buildApp`, so the test never
imports `app.ts` (which coverage excludes and which would bring all of those in).

**Harness: real DB**, following `topics-integration.test.ts` l.18 to 71. Env defaults
(`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, OIDC vars, `NODE_ENV`) are set with `??=` before
any import; modules (`db.js`, `redis.js`, `register-routes.js`) are imported dynamically after
that. `Fastify()` + `app.decorateRequest("session", null)` + an `onRequest` hook that injects
`{ userId }` for a dedicated standing-facilitator fixture user created by this file (distinct
actor, so audit rows are attributable). `registerRoutes` transitively imports `redis.ts`, which
opens an eager `ioredis` client, so `afterAll` calls `redis.quit()` and `db` cleanup, as the other
integration files do. A mocked harness can't drive a generic request loop.

**Selection.** An `onRoute` hook registered before `registerRoutes` collects every route. A route
is in scope when its `url` matches `^/api/v1/teams/:[^/]+/topics(/|$)` (any name for the first
param) and its method set, after normalizing `routeOptions.method` to an array, contains `POST`,
`PUT`, `PATCH`, `DELETE`, or a wildcard (`ALL`/`*`). It adds an explicit `EXTRA_IN_SCOPE_ROUTES`
list (empty today) for `topics`-writing routes outside that prefix. The author of such a route adds
it there in the same PR, and code review enforces this. There is no exemption list. It asserts
that the set is non-empty and contains the five known routes.

**Request.** For each route, one deterministic request against the template:
- the caller is the fixture standing facilitator with no team membership;
- the first path parameter, whatever it is called, is `DEFAULT_TOPICS_TEAM_ID`, and every other
  path parameter is `ffffffff-ffff-4fff-bfff-ffffffffffff`;
- the body is `{}`.

**Assertions.** `status === 404` **and** `error.code === "TEAM_NOT_FOUND"`, **and** exactly one
`topic.write_denied_template` row for that request, scoped by `actor_user_id` = the fixture user,
`timestamp >=` the request's start time, and `metadata->>'endpoint'`. The audit row is the only
evidence specific to this guard: a 404 alone could come from a topic lookup.

**Lock state.** The test is *safe in either lock state* and *fails in either state* when the guard
is missing. It does not depend on the template being locked, which it can't guarantee anyway,
because 4.2 and 4.5 insert a `complete` sentinel session and vitest runs files in parallel.
Without the guard, a locked template answers 409, and an unlocked one answers 404
`TOPIC_NOT_FOUND` (004/005) or 422 (003/006/007). Both fail the code assertion.

**No-write backstop (security S3).** A future route that skips both the guard and the lock and
accepts `{}` could write during CI. So the test takes the same full template snapshot that 4.5
uses (shared helper, see D5), asserts after each request that the template is unchanged, and
restores the snapshot in a `finally`.

*Alternative:* parse `app.printRoutes()`. Rejected because the output format is meant for humans
and may change between Fastify versions.

### D5. Integration tests: one table, both lock states, harmless bodies, one snapshot

Trimmed after the Executive review. The BA's sharper conditions become assertions on the same rows, not
extra tests.
- **One table-driven suite** over the five endpoints × {locked, unlocked} × {facilitator, admin
  where the endpoint admits admins}. Each row sends the request against the template and against
  a canonical nonexistent `teamId`. It asserts equal status, body (except `correlationId`), and header
  names and values (except `date`). It also asserts exactly one `topic.write_denied_template` row
  with the exact `metadata`, no lock-denial row, and no success row. This one table covers the old
  4.2, 4.3 and 4.5. Administrator rows also assert `actor_global_role = 'application_admin'` on
  the audit row (security S6).
- **Scoped audit counts (engineer S2).** Each row uses its own fixture actor, and every audit
  assertion filters on `actor_user_id`, `timestamp >=` that row's start time, and
  `metadata->>'endpoint'`. Other files write template-denial rows at the same time, so an
  unscoped "exactly one" would be flaky.
- **Unlocked case:** a `sessions` row with `team_id = DEFAULT_TOPICS_TEAM_ID` and `status =
  'complete'` is inserted and deleted in a `try/finally` inside each test, never in `afterAll`.
  `sessions_team_active_unique` ignores terminal statuses, so the insert cannot collide.
- **Harmless bodies in the table:** each body would fail later validation even if the guard were
  missing. TOPIC-003 gets an empty `name` (422). 004, 005 and 007 get a random `topicId` (404
  with a topic code). 006 gets a mismatched id set (409 STALE). A guard regression therefore shows
  up as a wrong status code, and the shared template is never mutated. This is why the table does
  not need a full-column snapshot or any race analysis against parallel test files. Both are dropped.
- **One snapshot helper, used by the team-creation regression and the structural test (BA S6,
  engineer M1, security S3).** The snapshot is every template `topics` row in **every status**,
  keyed by `id`: `name`, `prompt`, `vote_type`, `display_order`, `status`, `is_default`,
  `archived_*`, `team_annotation`, `annotation_updated_*`. The regression:
  1. inserts a `complete` sentinel session (so the lock can't mask a regression), and snapshots;
  2. sends *valid* writes to 003 to 007 (so a regression would really change the template) and
     asserts each returns `404 TEAM_NOT_FOUND`;
  3. compares the template's **own** rows to the snapshot directly (same ids, no extra rows, same
     values). This is what catches an add regression: a TOPIC-003 row has `is_default = false`
     and the copy (`WHERE is_default = true`) would never pass it to a new team;
  4. calls `POST /api/v1/teams`, asserts 201, and compares the new team's rows (all statuses) to
     the snapshot's `is_default = true` rows, field by field, because the copy ignores `status`.
  
  **Restore, in `finally`, in one transaction:** delete template rows whose `id` is not in the
  snapshot; reset `status`, `archived_*`, `team_annotation` and `annotation_updated_*`; restore
  `display_order` with the same negate-then-set two-step TOPIC-006 uses (`topics.ts` l.1397), since
  a direct update can trip `topics_team_active_order`. Then delete the sentinel session, the new
  team's lobby session, its topics, memberships and the team row.
  *Implementation note (architect implementation review S2):* the restore deletes only template rows
  that are **not** in the snapshot **and** have `is_default = false`, and it updates rows by snapshot
  id only. `default-topic-provisioning-integration.test.ts` swaps the template's `is_default = true`
  rows for fresh ids in parallel, so a delete of every non-snapshot row could remove its rows and
  empty the template. TOPIC-003 inserts only `is_default = false`, so those are the only rows a
  guard regression can add; `assertTemplateUnchanged` still compares every row in every status, so
  detection is not weakened. The restore does not touch `name`, `prompt`, `vote_type`, `is_default`
  or `first_session_description`, because no topic-write endpoint changes them today (see the
  helper's doc comment). The helper's real-DB self-test runs in one transaction and rolls back
  (architect B1), so the parallel snapshot users can never capture its mutation. The harness registers
  `teamRoutes` and `facilitatorSessionRoutes` (or uses `registerRoutes`) with the session hook,
  which `topics-integration.test.ts` does not do today, so the regression lives in its own file.
  A regression then fails only this test and does not break other tests.
- **Existing test "5.6"** (`topics-integration.test.ts` l.746) changes to expect `404 TEAM_NOT_FOUND`
  and no `topic.write_denied_locked` row. Its comment about parallel files touching sentinel rows
  and the `sentinelIds.length > 0` fallback are dropped, since the guard makes them moot.
- **Unit audit-failure case** also asserts `applyTimingFloor` was called (engineer S3), and that
  the error log carries `audit_write_failed: true` and no `err` object, and that the
  `topic.write_denied_template` event is still emitted with `auditRowWritten: false` and the
  response's `correlationId`.
- **Not added:** tests for odd id formats. `rejectNonCanonicalTeamId` runs before this guard and
  already has its own tests.

### D6. Record the FR-8.1 boundary in two places

The boundary sentence goes in the owning requirement, which is normative. A one-line
*Rationale* goes under FR-8.1 in `requirements/BRD.md`, in the same style as the FR-8.7 note
(`BRD.md` l.335), so that someone reading the BRD later finds the constraint before proposing to
"just let admins use the team endpoints".

## Risks / Trade-offs

- **[Risk] A test file that runs in parallel writes the template's topic rows.** → The parity table
  uses harmless bodies and takes no snapshot, so it is unaffected. Only the team-creation regression
  compares a snapshot. It reads and creates within a few hundred milliseconds. If it turns out to be
  flaky, it moves into the same file as the writers, or is serialized with them. It is not made
  weaker.
- **[Risk] Inserting a `complete` session on the sentinel in the unlocked case leaks into other
  tests** (it unlocks the template for any test running at the same moment). → Mitigation:
  `try/finally` cleanup, plus the guard itself. Once this change is in, an unlocked template is
  harmless to topic writes. Lifecycle tests that pick teams are unaffected because they select
  their own fixture teams.
- **[Risk] Existing template drift is preserved.** If an environment already has template sessions
  or altered default rows, this change preserves that state and does not fix it. → Mitigation: a
  human operator runs the read-only data check before merge, and F4 is filed if anything is found.
- **[Trade-off] The "unlocked template with failing controls" state stays reachable.** It needs
  the F1 entry point, and after this change saves fail harmlessly with "Team not found." → F1.
- **[Trade-off] The guard sits inside an existence check.** That is less visible than a separate call.
  → Mitigation: the function is renamed, has a header comment, and is enforced by the structural test.
- **[Risk] A caller can measure that the template differs from a missing team** through the extra
  audit insert. → Mitigation: the timing floor absorbs it, the same way it absorbs the lock-path
  insert. Latency beyond the floor is an accepted difference in the spec. A failed insert is caught,
  so it can't produce a 500 that only the template path returns (D3).
- **[Trade-off] A lost audit row on insert failure.** The structured `topic.write_denied_template`
  event (actor, role, IP, endpoint, operation, correlationId, `auditRowWritten: false`) plus an
  error log marked `audit_write_failed: true` take its place (D3). That is acceptable for a record
  used only in incident review. It does depend on the log pipeline not filtering `info` audit
  events, the same caveat `emitAuditEvent` already documents.
- **[Residual] The guard is application-layer only.** Migrations, ad-hoc SQL, and any future
  writer outside `topics.ts` bypass it. A `topics` trigger rejecting `team_id = sentinel` unless a
  session-local setting (e.g. `app.allow_template_write`) is set would close that, and give F5 an
  explicit opt-in. Considered and deferred to F3: it is a schema change with migration-ordering
  consequences (seed and correction migrations write the sentinel), which is outside #188.
- **[Residual] No rate limit on the topic-write routes.** Any facilitator can generate unbounded
  `topic.write_denied_template` rows by looping. The lock-denial path already has the same property,
  and there is no global limiter (the TEAM-006 Q6 decision deliberately scoped its limiter to one
  route). This change adds no new class of exposure. Recorded, not addressed.
- **[Residual] Membership-creation chain on the sentinel** (`POST /api/v1/teams/:teamId/managers`
  → `POST /api/teams/:teamId/join-links` → `GET /api/join/:token`). Not reachable through topic
  writes after this change, but it makes accepted difference #1 reachable and gives the template a
  data-access boundary nobody has designed. Handed to F1 with named routes (Open Questions), and
  checked by the pre-merge data check.

## Migration Plan

- No schema migration.
- Before merge, a **named** owner runs the read-only data check (tasks.md §6) in each shared
  environment, against the pass criteria in `proposal.md` "Pre-merge human actions", and records the
  result there. This is a merge gate. If any environment fails, F4 becomes blocking.
  The check includes **zero `team_memberships` rows on the sentinel, in any `removed_at` state**
  (security B1), so the "no memberships" assumption in Context is verified, not asserted.
- Deploy is an ordinary backend release. Rollback is a revert: the template goes back to relying on
  the lock alone, and no data needs cleaning up because rejected writes never change anything.
  **If any completed sentinel session exists at rollback time, the template is immediately
  writable**, so whoever rolls back runs the data check first.

## Open Questions

- Issue numbers for F1, F3 and F5 (and F4 if it is needed) go here, and in `proposal.md`, once a human
  files them. F1 must be filed before merge. F2 is folded into F1.
- **Required F1 content (security B1, merge-gating).** "F1 is filed" counts only if the issue:
  - lists as in-scope surfaces, in addition to the session lifecycle entry points and
    `GET /teams/eligible-for-session`: `POST /api/v1/teams/:teamId/managers`,
    `PATCH /api/v1/teams/:teamId/members/:userId/role`, `POST /api/teams/:teamId/join-links`, and
    join-link redemption `GET /api/join/:token` for a sentinel link;
  - carries the D4 structural-test pattern (enumerate registered routes, no exemption list) over
    to those team-scoped write routes;
  - is tagged for security review.
  None of these routes is changed by #188.
- Data check owner: not yet named. Result: pending.

## Design review disposition

*Ingrid Sollenberger (Solution Architect). Reviews: `design-review-engineer.md` (Marcus Oyelaran)
and `design-review-security.md` (Tomás Ferreira).*

**Engineering review**

| Item | Disposition | Rationale |
|---|---|---|
| M1 team-creation regression can't catch an add; cleanup underspecified | **Accepted** | D5 now compares the template's own rows (all statuses) to the snapshot and spells out a one-transaction restore, including the negate-then-set `display_order` step and team/lobby cleanup. |
| M2 structural test must assert `TEAM_NOT_FOUND`, not rely on lock state | **Accepted** | D4 asserts status and code, and is stated as safe and able to fail in either lock state. The spec's "no completed session" precondition is removed. |
| M3 real-DB harness; extract `registerRoutes` so `app.ts` isn't imported | **Accepted** | New `routes/register-routes.ts`; harness, env defaults, fixture user and `redis.quit()` named in D4. |
| S1 param-name-agnostic prefix, array methods, `ALL`/`*` | **Accepted** | One-line regex closes a quiet CI bypass; spec wording updated to match. |
| S2 scope audit-row assertions | **Accepted** | Distinct fixture actor per row plus timestamp and endpoint filters (D5). |
| S3 assert `applyTimingFloor` on audit failure | **Accepted** | One line, and it is the point of that path. |
| S4 note that logging `err` is acceptable | **Superseded** | Security B2 is stricter: log `err.code`/`err.message` only, never the raw error, so the "don't log parameters" concern disappears. |
| Minor: shared params type | **Accepted** | `TopicWriteDenialContext` (D1). |
| Minor: header and Step 2 comments | **Accepted** | Added to D1 and task 1.3. |
| Minor: 1.4 order not enforced by D4 | **Accepted** | D1 says unit 3.1 enforces it; task 1.4 says so. |
| Minor: drop 5.6 fallback and comment | **Accepted** | Added to D5 and task 4.1. |

**Security review**

| Item | Disposition | Rationale |
|---|---|---|
| B1 membership-creation chain hidden in F2 | **Accepted (as follow-up content, not code)** | Open Questions now lists the required F1 routes, structural-test carry-over and security-review tag; the data check adds zero sentinel `team_memberships` rows. No membership route changes in #188. |
| B2 audit failure must leave a complete, alertable trace | **Accepted** | D3: event always emitted with actor, role, IP, operation, correlationId and `auditRowWritten`; failure log carries `audit_write_failed: true`, `dbErrorCode`/`dbErrorMessage`, no raw `err`. Spec updated. |
| S1 prove the guard fired | **Accepted** | Structural test asserts the code and exactly one scoped template-denial row. |
| S2 param-agnostic prefix | **Accepted** | Same as engineer S1. |
| S3 structural test safety depends on lock | **Accepted, modified** | No rollback transaction is possible across `inject` and a pool, so it uses the shared snapshot/assert-unchanged/restore helper instead. |
| S4 data-layer trigger | **Deferred to F3** | Recorded under Non-Goals and Risks; it is a schema change that interacts with seed migrations. |
| S5 rate limiting on topic routes | **Accepted as a recorded residual** | Same exposure as the existing lock path; no global limiter exists, and adding one is out of scope. |
| S6 admin audit rows assert `actor_global_role` | **Accepted** | Added to the D5 table and task 4.2. |
| S7 rollback note | **Accepted** | Added to Migration Plan. |

**Unresolved (needs a human):** filing F1 with the B1 content, naming the data check owner, and
running the data check are still human merge gates.
