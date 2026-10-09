# Design Review: 232-topic-002-admin-read-audit-no-manager (#232)

*Reviewer: Marcus Oyelaran (Full Stack Engineer). Scope: implementability, boundary cleanliness, practicality, hidden coupling, missing error paths. Checked against `routes/content.ts` (TOPIC-001 and TOPIC-002 handlers, `denyAdminContentAccess`, `fetchConnectionRecoveries`), `auth/standing-facilitator-access-helper.ts`, `auth/team-content-access-helper.ts` (`readActiveMembershipRole`), `auth/audit-logger.ts`, `auth/audit-write-transaction.ts`, `routes/teams.ts` (TEAM-002/TEAM-003 admin-read audit), `routes/auth.ts` (sign-in audit SQL), migrations 8, 21 and 22, `content.test.ts`, `topic-add-flag-parity.test.ts`, `topic-annotation-integration.test.ts`, and `TopicManagementPage.tsx`.*

## Verdict

**Approve with changes.** The design can be built as written. The boundary decision is the right one: a TOPIC-002-local predicate after the shared decision, with the shared helper and the `topics.ts` wrappers left untouched. The handler ordering keeps facilitators off the new query. Four items need a decision or a sentence in the design before implementation starts (M1 to M4). None of them changes the shape of the design.

## What holds up

- **D2's boundary is correct, and there is one more reason for it.** `readActiveMembershipRole`'s header says it exists so that "content.ts runs no SQL against team_memberships" (access-control Decision 8). A TOPIC-002-local query joining `users` and `team_memberships` (which would fold the role read and the IdP flag into one round trip) would break that rule. Two small reads is the right trade-off. D2 should cite this, because it is the first optimisation someone will try.
- **Facilitators pay nothing.** `checkStandingFacilitatorOrAdminAuthorization` returns `actorGlobalRole`, and the new branch is gated on `=== "application_admin"`, so the facilitator arm never reaches the membership read. Task 3.6 pins this by SQL text, which is the right way to do it.
- **Fail-closed is free.** `readActiveMembershipRole` already rethrows. A plain awaited insert that throws gives Fastify's default 500 before `responseBody` is sent. No new error plumbing is needed. (`registerTemplateConstraintErrorHandler` rethrows anything that isn't a template-constraint violation, so the root default handler still answers.)
- **`audit_log` can take the nonexistent-team row.** Migration 8 has no FK on `team_id` or `actor_user_id`, so D5a's "audit a canonical UUID that names no team" works as described.
- **`users.roles` can't be NULL.** `users_roles_well_formed` rejects NULL and empty arrays, so `'engineering_manager' = ANY(roles)` always returns a boolean and never SQL NULL. The untyped literal resolves to `user_role`. That is fine, but only real Postgres can show it (see S4).
- **The audit visibility guard is accurate today.** `grep -rniE "(from|join)\s+audit_log" packages/backend/src` (non-test files) has exactly one hit, `fetchConnectionRecoveries`, and it filters by equality on one operation.
- **Rollout and rollback are clean.** There is no migration, the operation names are new text values, and the behaviour holds under either deploy order.

## Must resolve before implementation

### M1. `audit_log.actor_roles` already exists and the design doesn't mention it

Migration 22 (#245) added `audit_log.actor_roles TEXT[] NULL`, "the actor's full role set, highest precedence first". It is written today only by the two sign-in rows in `routes/auth.ts`. Its column comment says NULL means "the actor's role set was not captured for this operation." This change reads that exact role set on every admin request and then:

- stores a derived boolean in `metadata.actor_idp_roles_include_em`, and
- leaves `actor_roles` NULL on the same row. Per the column's own comment, that NULL says the role set wasn't captured, even though we read it.

D8 also says the field list is "corrected to the real columns (`timestamp`, `actor_*`, …)", and `actor_*` now includes `actor_roles`.

This isn't wrong on its own terms, but the design should make a deliberate choice. The options:

- **(a) Populate `actor_roles` and keep the boolean.** Use the auth.ts pattern: one read, both values derived from it, and `$n::text[]` last in the column list. A consumer gets the full set, and a dashboard can still filter on the boolean. **This is my preference.** An administrator's own IdP role set isn't team data and isn't sensitive. The column was built for exactly this. The extra cost is zero, because we already read `roles`.
- **(b) Keep the boolean only.** Add a sentence to D5 explaining why `actor_roles` stays NULL for these operations (Security's minimisation call), and update the column comment in the `AuditEventName` block, not the migration.

Either way, Tomás should see this, because his "boolean, not the full array" call (proposal "Calls made on others' behalf") was made without mentioning that the column exists.

### M2. The IdP-role read has an undefined zero-row case

`SELECT 'engineering_manager' = ANY(roles) FROM users WHERE id = $1` can return zero rows. The shared helper just found the row, so this only happens if the user is deleted between the two queries. The SQL-routing parity fake will also hit it, because its default branch answers `{ rows: [] }`. The design specifies "throws → 500" but not "returns no row". `rows[0]?.x ?? false` would quietly record `false`. `rows[0]!.x` would throw a TypeError.

**Pick one and write it down.** I recommend throwing, with an explicit `if (rows.length !== 1) throw new Error(...)`. That keeps the fail-closed set ("caller identity vanished after authorization") and makes an unrouted parity fake fail loudly instead of passing. Add one unit test.

### M3. The 200 path doesn't say where the insert goes relative to `applyTimingFloor`

Today the 200 path runs `await applyTimingFloor(startTime); return noStore(reply).send(responseBody)`. D5 says "immediately before `reply.send`". If the insert lands between the floor and the send, admin 200s take floor + insert time, while the deny branch (D4) inserts *before* the floor. The two branches then become distinguishable by timing, which is exactly what the floor exists to prevent (spec: "Response latency then does not distinguish …").

**Fix the order on both branches to:** reads → IdP flag → awaited insert → `emitAuditEvent` → `applyTimingFloor` → send. Task 2.3 should say "before the timing floor", and task 3.1/3.3 should assert it with `mock.invocationCallOrder` (insert call < floor call).

### M4. Frontend: parsing the 403 body can throw and show the wrong message

In `loadTopics`, a `403` whose body isn't JSON throws from `await res.json()`. Examples are a proxy or WAF page, or an empty body. That error goes into the existing `catch`, which sets **"Network error loading topics."** That is a regression: today the same response shows the access-denied string.

Task 6.1 should require a guarded parse, for example `const body = await res.json().catch(() => null)`, followed by `hasEnvelopeMessage(body) ? body.error.message : FALLBACK`. Task 6.2 should add a case: "403 with a non-JSON body renders the fallback string, not the network error."

The rest of D7 is fine. `hasEnvelopeMessage` already exists. The error state returns early at the `if (error)` render, so no topic list, definition block or write control can render beside the message. The quiet `fetchAllTopics` refetch stays as it is.

## Should address

### S1. Read the IdP flag once, right after the predicate, on both branches

D4 and D5 read `actor_idp_roles_include_em` in two places: on the deny branch before the insert, and on the 200 branch after the data reads. Reading it once, immediately after `evaluateAdminTopicConfigRead`, has these effects:

- There is one code path and no duplicated SQL.
- Every admin request queues the same prefix: auth row → membership row → IdP row. This simplifies the task 3.0 fixture and the parity-fake routing.
- It still meets D5 ("after admission is decided") and the spec ("at the time of the request").
- The only cost is one wasted read if a later topic query fails, and that request is a 500 anyway.

### S2. The parity fake can pass vacuously on the "participant member" pin

`readActiveMembershipRole` runs `SELECT role FROM team_memberships WHERE …`. That text contains neither `FROM users u` nor any other routed substring, so today's `fakeQuery` sends it to the default `{ rows: [] }`, which reads as a `null` membership. If task 4.1's routing is missing or wrong:

- the new EM row fails loudly (it expects GET 403 and gets 200), which is good, **but**
- the existing "application_admin who is a member of the team" row, which 4.1 pins to `participant`, keeps passing as a *null* membership. The participant case is then never exercised.

This is the same vacuous-pass hazard the file's header already warns about (architect S2 / security SF-1). Task 4.1 should make the fake **record** the membership role it served, and each admin row should assert that the value matched the row's configured role. Also watch the order of the substring routes: the membership query must be matched before any broader `team_memberships` rule, and the IdP query (`FROM users WHERE`) must not collide with `FROM users u`.

### S3. `content.test.ts` positional queues: use a SQL router for the new admin tests

Task 3.0's ordered fixture works, but an exhausted `mockResolvedValueOnce` queue returns `undefined`. The handler then hits `undefined.rows`, throws a TypeError, and the response is a 500. A miscounted fixture therefore looks like "fail-closed works". The 3.4 fail-closed tests are exactly where that confusion will happen.

For the new admin describe blocks, prefer `mockDbQuery.mockImplementation(sql => …)` routing on SQL text, as the parity test does. Make injected failures explicit, for example "reject when SQL matches `INSERT INTO audit_log`". Existing facilitator tests can keep their queues.

Two existing tests need to move to the admin fixture: the shared `mockAllTopics(globalRole, …)` helper (used with `"application_admin"` by security R4 at ~L1170) and the ~L915 admin test. Tests that index `mock.calls[2]` and `mock.calls[3]` are facilitator-only and unaffected. Confirm this during 3.0.

### S4. The real-Postgres suite should cover `actor_idp_roles_include_em: true`

The `'engineering_manager' = ANY(roles)` expression against a `user_role[]` is only proven in real Postgres. Task 5.1 has no `true` case. Add one: an admin whose `users.roles` is `'{application_admin,engineering_manager}'` (the order must satisfy `users_roles_well_formed`'s strictly descending enum rule), with no membership, gets `200` and a row with `true`.

Note that `insertUser` in `topic-annotation-integration.test.ts` omits `roles` and relies on migration 21's legacy-fill trigger, which follow-up F1 will drop. Any new helper should write `roles` explicitly. If M1 goes with (a), assert `actor_roles` in the same test.

Also make sure the nonexistent-team row is cleaned up by `actor_user_id`. The existing `cleanup` does this, but a new file needs to copy it.

### S5. Specify the event payloads, not just the row metadata

D5 pins the `audit_log.metadata` keys exactly but says only "plus an `emitAuditEvent`" for the event. The precedents (`admin.team_detail_accessed`, `admin.session_content_denied`) use camelCase fields: `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `endpoint`, `httpStatus`, and so on. Name the fields in D5 and in the `AuditEventName` comment block, and have task 3.3 assert the event's key set the same way it asserts the row's. Otherwise the "no text in metadata" guarantee covers the row but not the log line, and the log line is the one most likely to be shipped somewhere broader.

### S6. Make the task 8.3 grep case-insensitive and include joins

`grep -rn "FROM audit_log"` misses `from audit_log` and `JOIN audit_log`. Use `grep -rniE "(from|join)[[:space:]]+audit_log" packages/backend/src --exclude-dir=__tests__`. It finds the same single hit today.

## Nits / optional

- **Type the predicate result into the metadata.** `AdminTopicConfigRead`'s `membershipRole: null | "participant"` should be the value written to `metadata.membership_role`, not a second read of `liveRole`, so the type proves the row can never record `engineering_manager` on an access row.
- **Event order on the deny branch (optional).** If the denial insert fails, nothing records the denial except the 500 error log (D4 accepts this). Emitting `admin.topic_config_denied` *before* the insert on the deny branch would leave a log trail when the database is down, and it claims nothing false, because the request was denied either way. Keep insert-then-emit on the access branch, where emitting first would log a read that never served data. This is acceptable as designed. I'm noting the asymmetry so it's a deliberate choice.
- **No statement timeout on the plain-await insert.** This matches `teams.ts`. A stalled insert, for example behind a migration lock, holds the request open with no data sent, which is fail-closed. No action needed. The `withAuditTransaction` 400 ms bound is for write paths and shouldn't be pulled in here.
- **Shared types.** `GetAllTopicsResponse` doesn't change. The 403 envelope is already the standard `{ error: { category, message, correlationId } }`. Nothing new is needed in `@dipstick/shared`.
- **Error reporting for D3's messages.** Two new user-facing strings now live only in `content.ts` and the spec. Define them as module-level constants in `content.ts` so the unit tests import the same string the handler sends, and the spec and test assertions can't drift from it by a typo.

## Summary for the change owner

| # | Item | Severity | Where to fix |
|---|---|---|---|
| M1 | `audit_log.actor_roles` exists; populate it or explain why not | Must | design D5/D8; Security sign-off |
| M2 | IdP-role read returning zero rows is undefined | Must | design D5; task 2.2/2.3; one unit test |
| M3 | Insert must come before `applyTimingFloor` on the 200 path | Must | design D5; task 2.3; call-order assertion |
| M4 | Non-JSON 403 body shows "Network error" | Must | design D7; tasks 6.1/6.2 |
| S1 | Read the IdP flag once after the predicate | Should | design D4/D5 |
| S2 | Parity fake must prove the membership role it served | Should | task 4.1 |
| S3 | SQL-routed mocks for the new admin unit tests | Should | task 3.0 |
| S4 | Real-PG `true` case; explicit `roles` in fixtures | Should | task 5.1 |
| S5 | Pin event payload fields | Should | design D5; tasks 1.1/3.3 |
| S6 | Case-insensitive grep including joins | Should | task 8.3 |
