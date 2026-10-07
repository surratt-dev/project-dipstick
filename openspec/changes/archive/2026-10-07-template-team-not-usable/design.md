# Design: template-team-not-usable (#214)

## Context

See `proposal.md` (Why) for the motivation, and `exploration-notes.md` §2–§4 for the code-verified
route inventory and the two membership chains. The facts that shape this design:

- #188's guard, `checkWritableTeam` in `routes/topics.ts`, is local to that file and typed on
  `TopicWriteDenialContext`. It runs after authorization, never as a `preHandler`. Its structural test
  (`topic-write-template-guard-structural.test.ts`) uses one actor, one prefix, one response code and
  one audit operation. Its string comparison is safe only because every topic handler runs
  `rejectNonCanonicalTeamId` first (`topics.ts` ~l.154).
- Of the routes this change guards, only `draft` (`facilitator-sessions.ts` l.296) and the two
  `content.ts` reads (l.522, l.653) reject a non-canonical `teamId`. `members`, member role,
  `managers`, join-link creation and `facilitator-state` pass the raw string to SQL, and Postgres's
  `uuid` input accepts other spellings (no hyphens, braces) and canonicalises them (`routes/uuid.ts`
  header). Both design reviewers found this independently (B1 in each).
- Only one place exports the template id: `DEFAULT_TOPICS_TEAM_ID` in
  `packages/backend/src/sessions/default-topics.ts`. The literal also appears in
  `migrations/4_seed_data.sql`, `migrations/11_default_topics_correction.sql` and a few tests. The
  same id is also the seeded **system user** (`users.id`, `global_role = 'application_admin'`,
  `4_seed_data.sql`).
- Six `INSERT` sites can write a template row: `POST …/sessions/draft` and `GET …/facilitator-state`,
  both through `getOrCreateJoinLink`; `POST …/managers` (`teams.ts`); `POST /api/teams/:teamId/join-links`
  (`createJoinLink`); `GET /api/join/:token` (`join-links.ts`); and `executeJoinFlow` inside
  `/auth/callback` (`auth.ts`). `UPDATE`s that can touch a frozen template row: the six
  `UPDATE sessions … WHERE id = $1` sites in `facilitator-sessions.ts` and the TEAM-005 membership
  `UPDATE` (`teams.ts` ~l.844).
- The exploration did not list two read routes that the structural prefix also selects:
  `GET /api/v1/teams/:teamId/sessions` and `GET …/sessions/:sessionId` (`routes/content.ts`). Both are
  gated by `evaluateTeamAccess`. That helper gives no *membership* grant on the template, but its
  path 3 (`team-content-access-helper.ts` ~l.197-241) gives a **facilitator grant with no membership**
  when the caller facilitated a template session that is in `lobby`, `pre_session`, `active` or
  `wrap_up`, a draft under 24 hours old, or `complete` with `facilitator_access_expires_at > NOW()`
  (a 30-minute window set by `complete`). That grant opens `/trends`, `/action-items`, both
  session-history reads and every other consumer of the helper (`action-items.ts`, `em-views.ts`, the
  realtime layer). The migration closes it at the source (D4 step 2). After the migration,
  administrators get the content `403` and everyone else gets `denyNullGrant`, as for a missing team.
  (Propose-stage BA review, B2.)
- On `advance`, `reveal`, `complete`, `topics/advance` and `facilitator-state`, the only authorization
  is `sessions.facilitator_id = caller`, read from the session row (for example
  `facilitator-sessions.ts` ~l.2311-2346). Before the lookup there is only authentication. The guard
  therefore cannot run "after authorization" on these routes (propose-stage BA review, B1).
- In both redemption paths (`join-links.ts` ~l.84-130 and `executeJoinFlow`, `auth.ts` ~l.845-876)
  the order is: token lookup → unknown token redirects `joinError=invalid` → inactive (revoked or
  expired) link redirects `joinError=expired` → (direct path only) unauthenticated caller redirects
  to `/auth/login?joinToken=…` → membership insert.
- **There is no application error handler.** No `setErrorHandler` exists in `src/` (only in one
  test). Fastify's default handler echoes `err.message` in `500` bodies, which for a check violation
  includes the constraint name. Handlers that run their own transactions (for example `draft`,
  `advance`) already catch and answer a fixed `500` for that reason ("security review SF1"; the
  global handler is an open release-notes follow-up 6).
- `audit_log.actor_user_id` and `actor_global_role` are `NOT NULL` and not foreign keys
  (`8_audit_log.sql`). `writeFailOpenAuditRow` (`auth/fail-open-audit-write.ts`) bounds its insert
  with `withTimeout(…, AUDIT_WRITE_TIMEOUT_MS)`.
- Migration 22 sets `SET LOCAL lock_timeout = '200ms'`, below the 400 ms transactional audit timeout
  and the 500 ms fail-open audit timer. Migrations run with `--no-single-transaction`: one transaction
  per file.
- `GetAllTopicsResponse` (TOPIC-002) in `packages/shared/src/types/topic.ts` carries
  `isCustomizationLocked`. TOPIC-001's response (`content.ts` ~l.597) has no shared type.
- Two existing #188 test files seed template rows that the new constraint will refuse:
  `template-team-topic-writes-integration.test.ts` (a completed template session, plus a template
  membership for the `403 FACILITATOR_IS_TEAM_MEMBER` case) and
  `template-team-creation-regression-integration.test.ts` (a completed template session).

## Goals / Non-Goals

**Goals:**
- One shared template check, robust to every spelling Postgres accepts for the template id, with one
  audit writer. Every guarded route builds its own missing-team response.
- A database backstop that fails closed, does not leak its name in a response, and needs no data
  check before it can ship.
- A structural test that fails when a new route under the prefix forgets the guard, with no
  exemption list and only a closed, asserted set of routes allowed to show no audit evidence.
- One lock-state function shared by TOPIC-001 and TOPIC-002, with `lockReason` in the shared types.
  `hasCompletedFirstSession` does not change.

**Non-Goals:**
- Changing how real teams behave, or the order of any existing check, beyond inserting the template
  step. In particular, no new non-canonical-id rejection is added to routes that accept one today.
- Translating constraint violations into user-facing responses.
- Changing the `500` body of any error other than a template constraint violation (the general
  global handler stays release-notes follow-up 6).
- A filter on each read model. Read surfaces are closed by membership gating (D7).
- A `topics` constraint (F3, #215) or a `teams.kind` column.

## Decisions

### D1. App-layer guard plus a database constraint (option A + B)

The guard (A) gives each endpoint its parity response and writes the audit row. The constraint (B)
makes a route that skips the guard fail closed: the write is refused, nothing persists, and the
request returns a generic `500`. Rejected alternatives:
- **Mark the template deactivated (C):** this fixes only the picker, and it overloads
  `deactivated_at`.
- **A `teams.kind` column (D):** a schema change for a single row, when the constant is already the
  single source of truth.
- **The guard alone:** a route someone forgets would fail open.
- **The constraint alone:** every refusal would surface as a `500`.

### D2. A shared module, called inside each route, never a `preHandler`

New module `packages/backend/src/teams/template-team-guard.ts` (any equivalent path is fine) exports:

- **`isTemplateTeam(id: unknown): boolean`.** It compares the *value* Postgres would store, not the
  string. Rule: return `false` for a non-string; remove one enclosing `{`…`}` pair if present; remove
  every `-`; lowercase; return `true` only if the result equals `DEFAULT_TOPICS_TEAM_ID` with its
  hyphens removed (32 hex digits). This accepts every spelling Postgres's `uuid` input accepts for
  the template (canonical, upper case, no hyphens, braces, other hyphen groupings), plus a few that
  Postgres would reject. Erring that way is safe: the only strings it adds are spellings of the
  template, and they get the missing-team answer. It never matches a real team. It reads no
  configuration. (Design reviews: engineering B1, security B1.)
- **`writeTemplateAccessDenial({ actorUserId, actorGlobalRole?, actorIp, log, endpoint, surface,
  correlationId? })`.** It takes primitives, not a `request`, because `executeJoinFlow` has no
  request object (engineering S1). Behaviour:
  1. Always emits the structured `team.template_access_denied` event (actor, role if known, IP,
     endpoint, surface, `correlationId`, and whether a row was written). Added to `AuditEventName`.
  2. If `actorUserId` is `null` (a logged-out redemption, see D3), it writes **no** `audit_log` row:
     the columns are `NOT NULL` and there is no actor. The event alone is the record, as
     `join.link_rejected` already is for logged-out callers.
  3. If `actorGlobalRole` is not supplied, it resolves it itself with one
     `SELECT global_role FROM users WHERE id = $1` (the session sub-routes and the direct redemption
     path have no role in scope). Callers that have it (draft, TEAM-005/006, members, callback) pass
     it. Never `"unknown"` or empty.
  4. Applies the flood bound (D2a). If the bound suppresses the row, it stops here.
  5. Inserts the row. The role lookup and the insert together are bounded by `withTimeout(…,
     AUDIT_WRITE_TIMEOUT_MS)`, the same bound `writeFailOpenAuditRow` uses, so an audit stall cannot
     hang the request (security S3).
  6. Fail-open: any error or timeout is caught and logged with `audit_write_failed: true`, the
     operation, the `correlationId`, and the database error's code and message only.

Each route calls `isTemplateTeam` at the point D3 names and then returns that route's own missing-team
response. A `preHandler` was rejected for the same reason #188 rejected it: it runs before
authorization and would turn `401`/`403` into `404`. #188's `checkWritableTeam` is left alone. Moving
it onto the shared `isTemplateTeam` is optional and must not change its `topic.write_denied_template`
operation; topic routes keep their earlier non-canonical rejection either way.

**Why normalise rather than reject non-canonical ids at each route boundary.** Security B1 preferred
adding the `uuid.ts` rejection before the guard on every route. Engineering B1 preferred normalising.
I chose normalising: adding `isCanonicalUuid` rejections to `members`, member role, `managers`,
join-link creation and `facilitator-state` would change the answer real teams give today for a
non-canonical id, which breaks the "real teams are unchanged" constraint, and it would be five
separate opt-in checks where one function does the job. Normalising also keeps the guard correct on
any future route that forgets the boundary rejection. Either option satisfies both reviewers'
required test (D8).

#### D2a. Flood bound on the durable row

On the session sub-routes and join-link creation **any** authenticated user reaches the guard, with
no rate limit in front, while the missing-session path they mimic writes nothing (security S4,
engineering M3). The writer therefore writes the durable row **at most once per (actor, endpoint)
per 60 seconds**, using Redis `SET template-denial:<actorUserId>:<endpoint> 1 NX PX 60000`. A
suppressed refusal still emits the structured event, with `audit_row_suppressed: true`. If Redis
errors, the writer writes the row (the failure is not attacker-controlled, and the insert is still
time-bounded). The bound is per actor, so the durable trail keeps one row per actor per endpoint per
minute: enough to show who probed what, and at most 1,440 rows per actor per endpoint per day.
The existing sliding-window limiter was not reused: its importers are allow-listed by a structural
test, and a limiter that answers `429` would change the parity response.

### D3. Placement on each route (parity table)

| Route | Guard runs | Template response | Floor |
|---|---|---|---|
| `POST …/sessions/draft` | after `401` and the facilitator-role `403`, at the team-existence check, before the cross-team check | `404 TEAM_NOT_FOUND` | only if the missing-team path has one (it does not today) |
| `POST …/sessions/:id/{advance,reveal,complete,topics/advance}`, `GET …/facilitator-state` | immediately after authentication (and any non-canonical `sessionId` rejection the route has), before the session lookup and before any `getOrCreateJoinLink`. These routes have no session-independent authorization, so **any authenticated caller** reaches the guard. The writer resolves the role (D2 step 3) | that route's "Session not found." `404`, as any caller gets for a missing session | none (none on the not-found path today) |
| `GET /api/v1/teams/:teamId/sessions`, `GET …/sessions/:id` (content) | no route-level guard. `evaluateTeamAccess` denies the template once D4 step 2 has clamped facilitator access. Non-canonical ids are already rejected at the boundary | the existing denial (`denyNullGrant`; admin `403`) | the existing `content.ts` floor |
| `GET …/members` | after the `401` and after the non-member `403`, at the team-existence step (the #188 placement). Admins reach it; non-admins get the existing `403` first | admins: that route's missing-team `404 TEAM_NOT_FOUND`; others: existing `403` | as existing |
| `PATCH …/members/:userId/role` | after authorization (admin, or EM on this team), before the member lookup | admin: `404` "User is not an active member of this team."; others: existing `403` | as existing |
| `POST …/managers` | after the admin `403` and the rate limiter, at the team-existence check | `404 TEAM_NOT_FOUND` | as existing |
| `POST /api/teams/:teamId/join-links` | after the `401`, **before** the membership check | `403` "You are not a member of this team." | as existing |
| `GET /api/join/:token` | **immediately after the token row is found: before the `is_active` (revoked/expired) check and before the unauthenticated redirect to login** | redirect `/join-error?joinError=invalid`, as for an unknown token | as existing |
| `/auth/callback` → `executeJoinFlow` | same as above: immediately after the row is found, before the `is_active` check. The login itself still completes | redirect `/join-error?joinError=invalid` | as existing |

The join-links create guard runs before the membership check on purpose. If it ran after, the
ordinary non-member `403` would always fire first, and the guard could never be observed without
seeding a template membership, which the constraint forbids.

**Redemption order (engineering B2, security S6).** After the migration every production template
link is revoked. If the guard sat after the `is_active` branch, every real template link would land
on the *expired* page, contradicting proposal item 3, and a logged-out user would be sent through a
full OIDC round trip for a dead link. Placing the guard first gives every template link, revoked or
not, logged in or not, the unknown-token answer. Both redemption guards also emit
`join.link_rejected` with `reason: "template"` so join telemetry stays complete. A **logged-out**
caller on the direct path has no actor: the writer emits the events only and writes no `audit_log`
row (D2 step 2). On the callback path the user is logged in by then, so the row is written with the
`userId` and `actorGlobalRole` already in scope.

### D4. Migration: lock, cleanup (audited), then `NOT VALID`, then conditional `VALIDATE`

New migration `23_template_team_not_a_subject.sql` (`22_audit_log_actor_roles.sql` is the highest
today; use the next free number at implementation time), in the repo's `-- Up Migration` /
`-- Down Migration` form, one transaction:

1. **Lock.** `SET LOCAL lock_timeout = '200ms'` (migration 22's convention and rationale), then
   `LOCK TABLE sessions, team_memberships, join_links IN ACCESS EXCLUSIVE MODE`. Taking the lock that
   step 3 needs anyway, up front, closes the window in which the previous build (which has no guard)
   could commit a new template row between the cleanup and the constraint, and avoids a lock upgrade
   mid-transaction (security S1, engineering S2). The header comment says: on a lock timeout the
   migration rolls back on its own; re-run it. The cleanup touches only template rows, so the lock is
   held for the cleanup, the `ADD CONSTRAINT`s and the validation scans only.
2. **Cleanup, every update before step 3**, because Postgres enforces a `NOT VALID` check on updates
   of existing rows:
   - revoke open template join links (`revoked_at = now()`);
   - soft-remove active template memberships (`removed_at = now()`);
   - abandon non-terminal template sessions, enumerated as `draft`, `lobby`, `pre_session`, `active`,
     `wrap_up` (`status = 'abandoned'`, `abandoned_at = now()`);
   - clamp completed template sessions:
     `facilitator_access_expires_at = LEAST(facilitator_access_expires_at, now()) WHERE status =
     'complete' AND facilitator_access_expires_at > now()`, which ends the facilitator grant described
     in Context and changes no row it doesn't need to (engineering M1).
   - **Audit the cleanup (security S5).** For each table where step 2 changed at least one row, insert
     one `audit_log` row with `operation = 'team.template_cleanup'`, `actor_user_id` = the seeded
     system user (`00000000-0000-0000-0000-000000000001`), `actor_global_role = 'system'`,
     `actor_ip` `NULL`, `team_id` = the template, and `metadata = { table, migration, rows: [...] }`
     where each entry holds the row id and its prior `status`, `revoked_at`, `removed_at` and
     `facilitator_access_expires_at` as applicable. Prior values are captured with a CTE that reads the
     rows before updating them (under the step 1 lock). No row is written when nothing changed, so the
     no-op case stays a no-op.
3. `ALTER TABLE {sessions,team_memberships,join_links} ADD CONSTRAINT <table>_not_template_team
   CHECK (team_id <> '00000000-0000-0000-0000-000000000001') NOT VALID`, with a comment pointing at
   `DEFAULT_TOPICS_TEAM_ID`.
4. A `DO` block that runs `VALIDATE CONSTRAINT` for each table only when that table has zero template
   rows. `RESET lock_timeout`.

Why not make the whole thing conditional on the H1 data check: a structural rule that waits on a
task nobody owns could slip indefinitely. The migration is safe in every data state, so H1 decides
only when to deploy.

**Rollback** is the `-- Down Migration` section, which drops the three constraints and does not undo
the cleanup: revoked links and removed memberships stay revoked and removed, and that is intended.
A rollback restores the pre-change exposure (Chains A and B) on the old build until the change is
re-applied; whoever approves a rollback must know that (security A6).

**Frozen rows (security A1).** Postgres enforces a `NOT VALID` check on updates of existing rows as
well. A frozen terminal session therefore cannot be modified (for example re-opened) without first
changing its `team_id`. That is the point. Consequence for future work: any bulk `UPDATE` that touches
a frozen template row (user anonymisation, a retention job rewriting `facilitator_id`) fails the
**whole statement**. `DELETE` still works. Retention and anonymisation jobs must either delete
template rows or exclude them.

**Realtime (engineering S3, security A2).** The migration changes rows directly and publishes no
WebSocket event or Redis change. A socket on a session it abandons stays open until the next
reauthorization sweep (`REAUTHORIZATION_INTERVAL_MS`, 5 minutes), and Redis session state is not
cleared. Therefore the maintenance window is **mandatory**, not advisory, when H1 finds a
non-terminal template session. Nothing new is built for it.

### D5. Constraint violations stay `500`, with a log marker and no constraint name in the body

Decided here rather than left open, because the obvious option has no home: there is no shared
error handler, and Fastify's default handler would echo `violates check constraint
"sessions_not_template_team"` (engineering B3, security S2). Three parts, all sharing one predicate
`isTemplateConstraintViolation(err)` (a `DatabaseError` with `code === "23514"` and a `constraint`
ending in `_not_template_team`; matched on fields, as the existing `23505` handling in `draft` does)
and one logger `logTemplateConstraintViolation(log, err, route)` that writes
`template_constraint_violation: true` with the route and constraint name:

1. **A narrow application error handler**, registered with `app.setErrorHandler` at the top of
   `registerRoutes` (not in `app.ts`, so `buildFullApp` and the structural probe see the same
   handler production does). For a template constraint violation it logs the marker and sends a
   fixed `500` body with no constraint name. For **every other error it rethrows**, which hands the
   error to Fastify's default handler, so every other `500` body is byte-for-byte unchanged. This
   covers the route that forgot the guard and does not catch its own errors, which is the case the
   constraint exists for. A general handler for all errors stays release-notes follow-up 6.
2. **Existing local `catch` blocks** on the writer routes that already answer a fixed `500` (for
   example `draft`, `advance` and the other session transactions) call the logger when the predicate
   matches. Their responses do not change.
3. **`/auth/callback`.** `executeJoinFlow` runs inside the callback's `try`, so a violation there is
   caught locally and mapped by `mapAuthError` to `/auth/error`. The callback's `catch` calls the
   logger when the predicate matches, before `mapAuthError`, so the incident is not recorded only as
   an authentication failure. The user-facing outcome is unchanged.

Residual, accepted: a *future* route that catches its own errors and does not call the logger will
answer a sanitized `500` without the marker. The structural test (D8) is what catches such a route
under the prefix. The response is never translated into a `404`, which would hide the bug the
constraint is there to expose.

### D6. Lock state: a wrapper, not a change to `hasCompletedFirstSession`

`getTopicLockState(teamId): Promise<{ isCustomizationLocked, lockReason }>` lives beside
`auth/topic-lock-helper.ts`. For the template (`isTemplateTeam`) it returns
`{ true, "canonical_defaults" }` without querying the database. Otherwise it calls
`hasCompletedFirstSession` and maps the result to `"first_session"` or `null`. TOPIC-001
(`content.ts` ~l.597) and TOPIC-002 (~l.764) both switch to it. The topic-write lock path
(`topics.ts`) keeps calling `hasCompletedFirstSession` directly, because #188's guard already refuses
the template before the lock runs. A source-level test asserts that `topic-lock-helper.ts` does not
mention the template. `teamName` is still returned. The screen chooses not to display it under
`canonical_defaults`.

**Shared types (engineering S4).** `packages/shared/src/types/topic.ts` gains
`export type TopicLockReason = "first_session" | "canonical_defaults" | null`, a `lockReason` field
on `GetAllTopicsResponse`, and a new `GetActiveTopicsResponse` for TOPIC-001
(`{ teamId, topics, isCustomizationLocked, lockReason }`), which today has no shared type. Both
handlers and the frontend use them, so the copy choice is checked at build time.

### D7. Read surfaces: membership gating plus closing the facilitator grant, verified

The proposal does not add any per-surface exclusion. Read access to team content comes from
`evaluateTeamAccess` (membership, or the facilitator grant) or from EM membership. After the
migration the template has no active membership, and D4 step 2 removes every facilitator grant. The
constraint stops new template sessions, so no grant can be re-created. Closing the grant once in the
data, not by guarding `/trends` and `/action-items` one by one (BA option b), covers every consumer of
the helper at once, including the realtime layer, which a per-route guard list would miss.

The tasks keep verification to a short checklist with one test per gate (Exec advisory). If a
surface turns out not to be gated, it is filed as a separate issue, not added to this change.
Opt-in filters are the same failure mode as opt-in route tags.

### D8. Structural test: a sibling file with a multi-actor table

`team-template-guard-structural.test.ts` enumerates routes with `onRoute` over `registerRoutes()`.
It selects `^/api(/v\d+)?/teams/:[^/]+/(sessions|members|managers|join-links)(/|$)` in any method,
plus `EXTRA_IN_SCOPE_ROUTES = ["GET /api/join/:token", "GET /auth/callback"]`. A table keyed by
`METHOD path` gives each route its actor (facilitator, admin or authenticated user), request
builder, expected parity response, floor (recorded as data), and
`evidence: "audit" | "refused-before-guard"`. `buildFullApp` takes one fixed actor, so the test
builds one app per actor and reuses it. It clears the D2a Redis keys before each request so every
request can be expected to write its row.

**Closed `refused-before-guard` set (engineering B4).** `refused-before-guard` is allowed only for
exactly these four keys: `GET /api/v1/teams/:teamId/sessions`, `GET /api/v1/teams/:teamId/sessions/:sessionId`,
`GET /api/join/:token` and `GET /auth/callback`. The test asserts that the set of entries marked
`refused-before-guard` **equals** that constant, so marking any other route (for example
`facilitator-state` or `members`, which are GETs with a guard) fails, and so does dropping one of the
four without changing the constant in review. Every other selected route must produce
`evidence: "audit"`.

**Non-canonical spellings (both reviews, B1).** For every `evidence: "audit"` route the test sends
the request three times: with the canonical template id, with the 32-hex no-hyphen spelling, and with
the braced spelling. Each must return the same parity response (status and body except
`correlationId`), never `500`, write the `team.template_access_denied` row, and create no template
row. For the two content reads, the non-canonical spellings must return the route's existing
non-canonical answer and never `500`.

The test asserts zero new template rows after each request and again in `afterAll`, and asserts that
no response body contains `_not_template_team`. The probe self-test registers
`POST …/sessions/__probe` with no guard, which tries to insert a template session, and asserts that
the checker reports failure in two ways: with no table entry (the primary mechanism), and with an
entry, because the constraint turns the write into a sanitized `500` instead of the expected `404`
(engineering M2). `buildFullApp` gets an `extraRoutes` option for this.

Redemption routes: after the migration, revoked template links do exist in production, and with
D3's placement the guard is reachable there with a real link. On CI it cannot be reached with a real
link, because the validated constraint refuses the seed. Their structural entries are therefore
`refused-before-guard` with an unknown token, and unit tests that stub the token lookup to return a
template row (active and revoked, logged in and logged out) prove the guard and its placement.

**Scope note (security A3).** Session-id-addressed routes (`/api/v1/sessions/:sessionId/{start,
begin-voting,action-items-review,participants-roster,participants}`, lock-in, `/ws/sessions/:id`)
are outside the prefix. Today they are safe: each requires a non-terminal status (every template
session is terminal after the migration), `participants` also requires an active membership, and
their `UPDATE`s hit the constraint. Their only protection against a future template write is the
constraint, not the guard. The structural test is fail-closed for the prefix, not for these.

### D9. Reworking #188's tests

#188's tests that seeded a completed template session to cover the "unlocked" state move to a hoisted
`vi.mock("../../auth/topic-lock-helper.js")` returning true for the template. `vi.spyOn` does not
intercept an ESM export loaded through `loadModules()` (engineering S5). Keep one test that covers the
"unlocked" dimension: in production the template already reads as unlocked wherever frozen completed
sessions exist, which is why #188's guard must precede the lock. The `403 FACILITATOR_IS_TEAM_MEMBER`
template test is replaced by a test that the constraint refuses the membership insert. The structural
test for #188 is unchanged.

Migration tests follow `auth/__tests__/users-roles-schema-integration.test.ts`: split the Up and Down
sections and run them against scratch-schema copies, because the integration lane has already
migrated `public` and the constraint refuses the seed. `convalidated` is asserted only in the scratch
schema; a developer database with leftover rows legitimately ends up `NOT VALID` (engineering S6).

## Risks / Trade-offs

- **[A future route under the prefix forgets the guard]** → The structural test fails because the
  route has no table entry, and the constraint stops any write that gets past it.
- **[A guard is bypassed with another spelling of the template id]** → `isTemplateTeam` compares the
  normalised value (D2), and the structural test sends two non-canonical spellings per route (D8).
- **[A guarded route mints a link before the guard runs]** → D3 places the guard before
  `getOrCreateJoinLink` on `draft` and `facilitator-state`. The test asserts zero new `join_links`
  rows.
- **[Constraint name leaks in a `500` body]** → D5's narrow error handler and the existing local
  catches answer a fixed body. The structural test asserts no body contains `_not_template_team`.
- **[Audit-row amplification by any authenticated user]** → Bounded by D2a to one durable row per
  actor per endpoint per minute; every refusal still emits the structured event. Accepted residual:
  that many small rows, with no dashboard or alert.
- **[The template branch becomes distinguishable by timing]** → The floor is applied only where the
  missing-team path already applies it. The audit insert (and role lookup) can make the template
  answer slower than a missing team. Accepted, because the template id is public (exploration §10
  X2; security A5).
- **[The migration blocks the hot `sessions` table]** → `ACCESS EXCLUSIVE` for the duration of a
  cleanup that touches only template rows plus the validation scans, with `lock_timeout = 200ms` so it
  fails fast and is re-run rather than queueing session traffic behind it.
- **[The migration abandons a session people are in]** → A maintenance window is mandatory if H1
  finds a non-terminal session. Abandoning live sessions is otherwise the intended outcome. Open
  sockets on an abandoned session last at most until the next reauthorization sweep (≤ 5 minutes).
- **[A test seeds template rows and CI turns red]** → This is intended: the validated constraint on
  CI rejects the seed. D9 lists the two known files.
- **[Frozen historical rows leak into a view]** → Membership gating plus the facilitator-access clamp
  (D4 step 2), verified in D7. With no active member and no unexpired facilitator access, there is no
  grant.
- **[A future bulk update touches a frozen row]** → The whole statement fails (D4, A1). Retention and
  anonymisation work must delete or exclude template rows.
- **[Parity on session sub-routes is by "Session not found."]** → For a missing team with a *real*
  session id from another team, `advance`, `complete` and `topics/advance` answer `403` "Session does
  not belong to this team.", while the template always answers `404`. Telling them apart requires a
  valid foreign session id, and the template's existence is public (its id is in the repo), so this
  is accepted. Parity tests compare status and body only.
- **[Rollback re-opens the hole]** → The down migration drops the constraints; with the old build
  that restores Chains A and B until re-applied (D4).
- **[Practice need goes underground]** → If H1 finds any template sessions, a practice-mode issue is
  filed. Practice never touches the canon or a real team.

## Migration Plan

1. H1: run the data check in each environment and record the counts in `proposal.md`.
2. If any non-terminal template session exists, the deploy **must** run in a window with no running
   sessions (D4, realtime).
3. Deploy. The migration locks the three tables, runs and audits the cleanup, adds the constraints and
   validates where it can. On a lock timeout it rolls back by itself; re-run it.
4. Check after deploy: run `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE
   '%_not_template_team'` and `SELECT * FROM audit_log WHERE operation = 'team.template_cleanup'`, and
   record the results. Then confirm that the picker no longer lists the template.
5. Rollback: revert the code and run the `-- Down Migration` section, which drops the three
   constraints. The cleanup is deliberately not reversed. Rolling back restores the pre-change
   exposure until the change is re-applied.

## Open Questions

- Exact migration number: use the next free number when the work is implemented. This doesn't
  affect specs or tasks.
- None needing a human decision. (The former question on where D5's marker lives is decided in D5.)

## Design review dispositions

Engineering review (Marcus Oyelaran) and Security review (Tomás Ferreira), checked against the code
on this branch before deciding.

| Item | Disposition | Where |
|---|---|---|
| Eng B1 / Sec B1: non-canonical id bypasses `isTemplateTeam` | **Accepted.** Verified: only `draft` and the content reads reject non-canonical `teamId`. Resolved by normalising comparison (Eng's option), not by new boundary rejections (Sec's preferred option), to keep real teams unchanged; both reviewers' required test added | D2, D8 |
| Eng B2 / Sec S6: redemption guard order | **Accepted.** Verified: inactive links redirect `expired`, and the login redirect precedes the insert. Guard moved before `is_active` and before the login redirect; `join.link_rejected` gains `reason: "template"` | D3 |
| Eng B3 / Sec S2: no shared error handler; constraint name echoed | **Accepted, combined.** Verified: no `setErrorHandler` in `src/`. Narrow handler in `registerRoutes` that rethrows non-template errors (Sec's "don't change other bodies" concern and Eng's "sanitize" concern), plus local catches and the callback catch. Per-call-site wrapper alone rejected: it is opt-in, and the route that forgets the guard is the one that forgets the wrapper. Context's write-site count corrected to six | D5, Context |
| Eng B4: `refused-before-guard` too broad | **Accepted.** Closed set of four, asserted by equality | D8 |
| Eng S1 / Sec S3: audit writer signature, role source, `NOT NULL` columns | **Accepted.** Primitives; writer resolves the role when absent; no row for a logged-out actor; bounded by `AUDIT_WRITE_TIMEOUT_MS` | D2 |
| Eng S2 / Sec S1: migration locking and race | **Accepted.** `ACCESS EXCLUSIVE` up front rather than Sec's `SHARE ROW EXCLUSIVE`, to avoid a lock upgrade before `ADD CONSTRAINT`; `lock_timeout = 200ms` per migration 22 | D4 |
| Eng S3 / Sec A2: realtime not notified by the migration | **Accepted.** Window made mandatory; ≤ 5-minute residual recorded | D4, Migration Plan |
| Eng S4: `lockReason` in shared types | **Accepted.** Verified TOPIC-001 has no shared type; one is added | D6 |
| Eng S5: ESM mocking in D9 | **Accepted** | D9 |
| Eng S6: migration test precedent | **Accepted** | D9 |
| Sec S4 / Eng M3: audit flooding | **Accepted.** Per-actor-per-endpoint 60 s dedupe of the durable row (Sec's second option); the existing limiter rejected because it is allow-listed and a `429` breaks parity | D2a |
| Sec S5: migration cleanup leaves no trail | **Accepted**, with the seeded system user as actor rather than the nil UUID, since that user exists | D4 |
| Sec A1, A3, A4, A5, A6 | **Accepted** as recorded decisions | D4, D8, Risks |
| Eng M1, M2, M4, M5 | **Accepted** | D4, D8, D3 |
| None rejected outright. Partially declined: Sec B1's preferred mechanism (boundary rejection) and Sec S1's lock mode, for the reasons above | | |

## Post-implementation errata

Added at archive, from the architect's sync review (`sync-review-architect.md`, N1 to N3). The synced
specs and the code agree with each other in each case below; this section records where the
decisions above are out of date. The decisions themselves are left as written.

- **N1 (D3, `reveal`).** D3's table groups `reveal` with the routes that answer "Session not found."
  `404`. As built and specified, `reveal` answers the template with its existing missing-session
  answer: a non-recoverable `409 reveal_failure` (`recoverable: false`, no `correlationId` in the
  body). A `correlationId` is still minted and passed to the audit writer and log. This follows D3's
  governing rule (parity with the route's own not-found answer).
- **N2 (D2 / D2a, dedupe).** The Redis dedupe key is `dipstick:template-denial:<actor>:<endpoint>`,
  not `template-denial:<actor>:<endpoint>` (security implementation review F3). The slot is still
  claimed (`SET … PX 60000 NX`) before the insert, but it is released (`DEL`) when the insert fails
  or times out, so a lost row never suppresses the next one for 60 s (security implementation
  review F1).
- **N3 (D8, structural test).** Besides the four-key `REFUSED_BEFORE_GUARD` set, the structural test
  has two more closed sets, each asserted by equality and each containing only `draft`
  (`POST /api/v1/teams/:teamId/sessions/draft`): `BOUNDARY_REJECTS_NON_CANONICAL` (draft rejects a
  non-canonical `teamId` at its boundary with `404 TEAM_NOT_FOUND` before authorization, so those
  spellings get the parity response but no audit row) and `ADMIN_REFUSED_BEFORE_GUARD` (an admin
  fails draft's facilitator check and gets that `403` with no row). D8's statement that every
  `evidence: audit` route gets three spellings that each write a row does not hold for `draft`.
