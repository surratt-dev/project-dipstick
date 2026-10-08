# Design review (Security): template-team-not-usable (#214)

*Reviewer: Tomás Ferreira (Senior Application Security Analyst), 2026-10-06. I reviewed `design.md`
and `proposal.md`, and spot-read the spec deltas they cite. I checked every claim against the code in
`packages/backend` on branch `agent-team/214-template-team-not-usable`: every route that can write
`sessions`, `team_memberships` or `join_links` (`facilitator-sessions.ts`, `teams.ts`,
`join-links.ts`, `auth.ts` `executeJoinFlow`, `auth/join-link-creation.ts`), the access helpers
(`team-content-access-helper.ts`, `session-subscriber-access-helper.ts`), the realtime
reauthorization sweep, `routes/uuid.ts`, the audit helpers and the migration tooling. Focus:
authentication flows, data access boundaries, audit logging and threat model impact.*

## Verdict

**Approve with one blocking change.** The structure is right. An app-layer guard with per-endpoint
parity, a database `CHECK` that fails closed, and closing the facilitator grant in the data instead of
per route is how I would want this built. Putting the guard inside each handler, never as a
`preHandler`, keeps authorization ahead of it. The `NOT VALID` / conditional `VALIDATE` sequencing is
correct: Postgres enforces a `NOT VALID` check on updates of existing rows, so the cleanup has to come
first, and the design says so.

There is one bypass of the guard that must be closed in the design before tasks (B1). Six further
items should be fixed in this change (S1–S6). None of them lets a template row persist, because the
constraint holds in every case. They are about the guard, the audit trail and the migration actually
doing what the design says they do.

---

## 1. Blocking

### B1. `isTemplateTeam` can be bypassed with a non-canonical spelling of the template id

D2 defines `isTemplateTeam(id)` as a string compare against `DEFAULT_TOPICS_TEAM_ID`. Postgres
accepts other spellings as `uuid` input (no hyphens, `{…}` braces) and canonicalises them. That is
exactly the hazard `routes/uuid.ts` documents. #188's guard is safe only because every topic route
runs `rejectNonCanonicalTeamId` first (`topics.ts` ~l.154). Most of the routes this change guards do
**not**:

| Route | Non-canonical `teamId` rejected today? | Effect of `{00000000-0000-0000-0000-000000000001}` with the D2 guard as written |
|---|---|---|
| `POST …/sessions/draft` | yes (`isCanonicalUuid`, l.296) | safe, `404` |
| `POST …/advance` | `sessionId` only; `teamId` compared strictly with the row | `403` "does not belong", no template audit |
| `GET …/facilitator-state` | **no**. It queries `WHERE id = $1 AND team_id = $2`, so Postgres casts | guard skipped. The original facilitator of a frozen template session passes the ownership check and reaches `getOrCreateJoinLink`, the constraint fires, and the result is a `500` instead of `404`, with no denial audit row |
| `GET …/members` | **no** | guard skipped. An admin gets `200` with the template's name and an `admin.membership_list_accessed` row in place of the missing-team `404` |
| `POST …/managers` | **no** | guard skipped. The existence check finds the team and the upsert hits the constraint: `500`, no `team.template_access_denied` |
| `PATCH …/members/:userId/role` | **no** | guard skipped (outcome is still a `404`, but without the denial row) |
| `POST /api/teams/:teamId/join-links` | **no** | guard skipped. The non-member `403` answers, without the denial row |

Writes still fail closed because of the constraint, so this is not a data-integrity hole. It is
blocking for three reasons. The design names the guard as the policy enforcement point. The parity
and audit claims in D3 are false for this input. And the D8 structural test, which only sends the
canonical id, would pass anyway. The same weakness will carry over to the next route someone adds.

**Required change (one sentence in D2, one row in D8):** either `isTemplateTeam` normalises its input
(strip braces and hyphens, lowercase, compare the 32 hex digits), or D3 requires every guarded route
to reject a non-canonical `teamId` with its missing-team response before the guard, following the
`uuid.ts` convention. I prefer the second: it matches #188 and the spec's existing "non-canonical
spelling follows the route-boundary rejection" scenario. Either way, D8's per-route table must also
send a non-canonical spelling of the template id and assert that no template row and no `500` result.

---

## 2. Should fix in this change

### S1. Migration race: a template row can be created between the cleanup and the `ADD CONSTRAINT`

Step 1's `UPDATE`s lock only the rows they touch. During a rolling deploy the previous build, which has
no guard, is still serving traffic. A concurrent `POST …/draft` or `GET …/facilitator-state` that
commits between step 1 and step 2 leaves a **live** template row behind. The `NOT VALID` constraint
accepts it, and the conditional `VALIDATE` then skips that table. A surviving template `draft` is
the worst case: `evaluateTeamAccess` path 3 grants its facilitator team-content reads for 24 hours,
which is the grant D4/D7 claim to have closed. **Fix:** start the migration with
`LOCK TABLE sessions, team_memberships, join_links IN SHARE ROW EXCLUSIVE MODE`, under a
`SET LOCAL lock_timeout` that follows the migration 22 convention (stay below the 400 ms
transactional audit timeout). Concurrent writers then wait for the cleanup and the constraint, and
nothing lands in between. node-pg-migrate runs each file in its own transaction
(`--no-single-transaction`), so the lock is held until commit. Add one sentence to D4.

### S2. D5 assumes a shared error handler that does not exist, and misses the callback path

No `setErrorHandler` is registered anywhere in the backend; Fastify's default handler serves the
`500`s. That leaves D5's first option without a home, and the second option ("the five writer call
sites") misses two things:

- **`/auth/callback`.** `executeJoinFlow` runs inside the callback's `try`. A `23514` there is caught
  locally, mapped by `mapAuthError`, logged as `auth.callback_error` / `auth.failure`, and the user is
  sent to `/auth/error`. That is a constraint violation recorded as an **authentication failure**,
  with no `template_constraint_violation` marker. The session was already regenerated, so the user is
  logged in but looking at an error page. This is the one path where a missed guard would mislead an
  incident responder.
- **The six `UPDATE sessions` sites** (`facilitator-sessions.ts` l.917, 1105, 1455, 1614, 2113, 2161)
  and the `PATCH …/role` `UPDATE`. They can all raise `23514` on a frozen template row.

**Fix:** state in D5 that the marker is emitted from an `onError` hook, which logs without changing
the response and so keeps the generic `500`, plus an explicit check in the callback's `catch` that
logs the marker before `mapAuthError`. Resolve the Open Question accordingly. Also note: Context says
"five places can write a template row". There are six `INSERT` sites. `POST /api/teams/:teamId/join-links`
→ `createJoinLink` is the sixth. It appears in D3 but not in the Context count.

### S3. Where the denial row's `actor_global_role` comes from is not stated

`audit_log.actor_global_role` is `NOT NULL`. On the five session sub-routes and on
`GET /api/join/:token`, the guard runs before any `users` lookup. The design gives the writer an
`actor`, but not where its role comes from. If an implementer passes `undefined`, every insert fails,
the fail-open catch swallows it, and the durable trail silently becomes a log line. **Fix:** D2 should
say the writer resolves the role itself (one `SELECT global_role`, as `resolveActorGlobalRole` does in
the realtime layer) when the caller has none in scope. It should also say the writer reuses
`writeFailOpenAuditRow`'s bounded timeout (`AUDIT_WRITE_TIMEOUT_MS`), so an audit stall cannot hang
the request. "Fail-open" alone does not guarantee that. Add the new operation to `AuditEventName`.

### S4. Any authenticated user can generate unbounded audit rows

Because the session sub-route guard runs right after authentication, **every** authenticated user can
write one `audit_log` row per request with `POST …/<template>/sessions/<anything>/reveal` or
`GET …/facilitator-state`, with no rate limit. #188's equivalent sat behind the facilitator role and
`topic-write-rate-limit.ts`. The missing-session path these routes mimic writes nothing. This is a
cheap way to amplify storage and bury real events. **Fix (pick one and record it):** rate-limit the
denial writer per actor (the sliding-window limiter already exists), or write the durable row at most
once per actor per endpoint per window and emit only the structured event for the rest. The
no-dashboard, no-alert decision is fine, but an attacker-controlled write rate needs a stated bound.

### S5. The migration's own data changes leave no audit trail

Step 1 revokes links, soft-removes memberships, abandons sessions and overwrites
`facilitator_access_expires_at`, but writes no `audit_log` row. `removed_by_user_id` stays `NULL`, and
the prior session `status` and expiry value are overwritten. Six months from now, the trail will not
show why a membership was removed or what state a session was in. The H1 counts recorded by hand in
`proposal.md` are not a substitute. **Fix:** have the migration insert one `audit_log` row per
affected row, or one summary row per table, with operation `team.template_cleanup` and metadata
holding the affected ids and their prior `status` and `facilitator_access_expires_at`. The actor is
the nil UUID with `actor_global_role = 'system'`, because the column is not an FK. These rows are
the forensic record H2 says it wants to keep.

### S6. Order of the redemption guard relative to the active-link check

The migration revokes every open template link. In both `GET /api/join/:token` and `executeJoinFlow`,
the revoked/expired branch runs immediately after the token lookup and redirects to
`joinError=expired`. As D3 is written ("after token lookup"), a revoked template link lands on the
**expired** page and never reaches the guard. That contradicts proposal item 3 ("lands on the existing
invalid-link page") and means no denial row is ever written for the one realistic template-link case.
Neither outcome leaks anything, but the design must say which order is intended. If parity with
"unknown token" is the goal, the guard has to run before the active check. Either way, record it, and
emit `join.link_rejected` with a `template` reason as well, so join telemetry stays complete.

---

## 3. Deferred or implicit decisions, now recorded

- **A1. Frozen rows vs. future retention and deletion work.** Because the check applies to every
  `UPDATE`, any later bulk `UPDATE` that touches a frozen template row (user anonymisation, a
  retention job rewriting `facilitator_id`) fails the **whole statement**. `DELETE` still works. The
  design should say so in D4, so the data-retention policy (my success criterion 4) is designed around
  it rather than discovering it in production.
- **A2. Live realtime connections at migration time.** The migration updates rows directly and
  publishes nothing. A WebSocket on a session it abandons stays open until the next reauthorization
  sweep (`REAUTHORIZATION_INTERVAL_MS`, 5 minutes). The H1 maintenance window covers this. Record the
  ≤5-minute residual window in Risks, and do not build anything new for it.
- **A3. Session-id-addressed routes are outside the structural test.** `/api/v1/sessions/:sessionId/{start,
  begin-voting,action-items-review,participants-roster,participants}`, lock-in and `/ws/sessions/:id`
  are not matched by D8's prefix. Today they are safe: each requires a non-terminal status (all
  template sessions become terminal), `participants` also requires an active membership, and the
  `UPDATE`s hit the constraint. Their only protection against a future template write is the
  constraint, not the guard. That is acceptable, but D8 should say so instead of calling the test
  fail-closed without qualification.
- **A4. "Non-terminal" must be enumerated.** In D4 step 1, name the statuses: `draft`, `lobby`,
  `pre_session`, `active`, `wrap_up`. `wrap_up` is in `evaluateTeamAccess` path 3 and in the
  subscriber helper's live set, so leaving it out would keep a grant open.
- **A5. Timing.** The template branch does an audit `INSERT` that the missing-team branch does not, so
  the two are distinguishable by latency. The design accepts this because the id is public. I agree,
  as long as the rationale stays in Risks.
- **A6. Rollback.** Dropping the constraints in the down migration re-opens template writes on the
  old build, which has no guard. The rollback note should say that a rollback restores the
  pre-change exposure (Chains A and B) until the change is re-applied, so whoever approves a rollback
  knows that.

## 4. Verified as stated

- On `advance`, `reveal`, `complete`, `topics/advance` and `facilitator-state`, authorization is only
  `facilitator_id = caller` after the lookup. Running the guard right after authentication is correct,
  and it precedes `getOrCreateJoinLink` (D3, BA B1).
- `evaluateTeamAccess` path 3 admits `complete AND facilitator_access_expires_at > NOW()`. The clamp
  closes it, and `abandoned` is never granted (D4 step 1, BA B2).
- In `executeJoinFlow`, the login and `session.regenerate()` complete before the join step, so a
  guard redirect does not affect authentication (D3).
- TEAM-006 checks admin → rate limit → existence. Placing the guard at existence keeps the `403` and
  `429` ahead of it.
- The eligible-teams query is a single parameterised SQL statement, and binding the constant adds no
  injection surface.
- TOPIC-002's standing-facilitator read of the template is intended (canonical defaults view). Template
  topic writes stay refused by #188 regardless of `lockReason`.
