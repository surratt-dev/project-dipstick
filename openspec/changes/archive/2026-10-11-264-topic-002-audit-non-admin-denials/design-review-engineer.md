# Design review: Engineer (Marcus Oyelaran), #264

Reviewed: design.md, tasks.md, proposal.md and specs, against `routes/content.ts`, `auth/standing-facilitator-access-helper.ts`, `auth/fail-open-audit-write.ts`, `auth/audit-write-timeout.ts`, `auth/audit-logger.ts`, migrations 8 and 22.

## Verdict

Implementable. Boundaries are mostly clean and the scope is small. One real design defect (the shared-budget and role-read-failure decisions contradict each other), two reuse calls to make explicitly, and several smaller gaps. None block starting once P1 and P4 are ruled.

## P4 ruling (helper type change): APPROVE, as written

Add `actorGlobalRole: string | null` to the denied variant of `StandingFacilitatorOrAdminDecision`.

Evidence of low coupling:
- The helper already holds `grant`; the `null` case is exactly the "no users row" branch. Zero added queries, and the handler cannot disagree with the decision about the role.
- All callers (TOPIC-002 in `content.ts`; four wrappers in `topics.ts`) read only `decision.authorized`, `decision.reason`, and `decision.actorGlobalRole` after narrowing on `authorized: true`. The authorized variant is untouched, so the discriminated union still narrows and nothing recompiles differently for them.
- No test imports or mocks the helper (grep: only `routes/topics.ts`, `routes/content.ts`, `routes/facilitator-sessions.ts` import the module; nothing under `__tests__` references it). Tests reach it through routes, and 403 assertions are on status/body, not on the decision object. So the "TOPIC-003..007 tests pass unchanged" claim (3.7) is realistic. The only way it breaks is a test doing `toEqual({authorized:false, reason})` on the decision itself, and none exists today.
- `null` versus `'unknown'`: keep `null` in the helper and map to `'unknown'` in the handler, as D6 says. Do not put `'unknown'` in the helper; it would leak a storage convention into a shared authorization type.

Conditions I would attach to the ruling: (1) update the helper's header comment to say the field is for audit by TOPIC-002 only and must never feed an admission decision (same discipline as `membership_role` in #208); (2) add one type-level or unit assertion on the helper's denied variants (the three return sites: no row -> null, non-facilitator -> its role, member-facilitator -> `"facilitator"`), since there is currently no direct helper test. Task 1.1 should say that.

Alternative considered and rejected, agree with the design: re-reading `users.global_role` in the handler. Extra query, TOCTOU disagreement.

## Findings

### E1 (design defect, medium): D3 shared budget contradicts D4 role-read-failure row

D3: role read and insert share one 500 ms `AUDIT_WRITE_TIMEOUT_MS` budget, insert gets the remainder. D4: a role-read failure still writes the row with `actor_roles = NULL`. But the common role-read failure under a DB incident is a timeout, which consumes the entire budget; the insert then has 0 ms left and the row cannot be written. So D4's "write the row anyway" only holds for fast errors (SQLSTATE, malformed array from `parseRoleArray`), not for the case that matters. The task 3.3 latency test (read 400 ms, insert hangs, total <= 500 ms) tests the shared budget but nothing tests "read times out at 500 ms, then what".

Options, in my order of preference:
1. **Fold the role read into the insert** (one statement): `INSERT INTO audit_log (..., actor_roles) SELECT $1, $2, $3, $4, $5, $6, u.roles::text[] FROM (SELECT 1) s LEFT JOIN users u ON u.id = $1`. Missing users row yields NULL `actor_roles` naturally. This deletes the role-read failure point, the `stage: "role_set_read"` event, the two-failure-events case, the shared-budget arithmetic, and the whole D4 question (P1's second half disappears). One query, one timeout, one failure stage. Cost: `parseRoleArray` validation is skipped (the column is "application-guaranteed", but the value here comes straight from a column that was itself written by `parseRoleArray` via #245; the admin arm validates because it also uses the value in metadata). If Security wants validation, it is not needed for a NULL-tolerant audit column. It is a design change to the P1 package, so it needs Security's agreement rather than being done silently.
2. Keep two steps but state explicit semantics: a read that times out or errors skips straight to the insert with `actor_roles = NULL` and a fresh remainder of at least a floor (for example min 100 ms), accept worst case ~600 ms, and drop the "<= 500 ms" claim. Simplest honest statement of the tradeoff.
3. Keep design as is, and specify that a role-read timeout means no row (stage `audit_insert` skipped, one failure event). This is what the design implicitly does today; it needs to be written, and D4 narrowed to "role-read error (not timeout)".

I recommend option 1; fall back to 2.

### E2: reuse of existing helpers (answer to the specific question)

- `withAdminAuditFailureSignal`: do NOT generalize. It is typed to `Topic002AdminOperation`, hard-codes `admin.audit_write_failed`, and its contract is "emit then rethrow" (fail-closed). The new path needs "emit then swallow" with a different event name and `stage` set. Changing one function to serve both contracts (a `rethrow` flag plus event-name parameter) makes the fail-closed property of #232 depend on a flag at every call site, and the guarantee "admin insert failure still returns 500" (3.3) then rests on a parameter default. Write a sibling, e.g. `runDenialAuditStep` in `content.ts`, next to it (about 15 lines; same SQLSTATE-only `errorCode` extraction, which is worth lifting into a tiny shared `sqlstateOf(err)` used by both so the "never err.message" rule has one implementation). Keep both wrappers local to `content.ts`.
- `writeFailOpenAuditRow` (`fail-open-audit-write.ts`): not directly reusable. Its signature takes a required `actorGlobalRole: string` (no NULL/unknown mapping done for you; fine), has no `actor_roles` column, hard-codes `auth.audit_write_failed` for failure (D3 explicitly rules this label out), uses a fixed 500 ms timer rather than a caller-supplied remainder, and returns void (the caller cannot tell the denial event whether the row landed; D4 needs that to decide whether to emit the denial event). Extending it with optional `actorRoles`, `failureEvent` and `timeoutMs` parameters is possible but widens a module whose docs say it serves the `auth.*` group. Recommendation: a new local insert function in `content.ts`, mirroring `insertTopic002AdminAuditRow` (raw `db.query`, `$7::text[]`), wrapped with `withTimeout` and `AuditWriteTimeoutError` imported from `audit-write-timeout.ts` (those are already extracted for sharing). If option 1 of E1 is taken, there is a single `withTimeout(db.query(...), AUDIT_WRITE_TIMEOUT_MS)` and no remainder arithmetic at all.
- Note `withTimeout` stops the caller waiting, not the query; a hung query keeps a pool connection. Under a DB incident, every denied request holds one for up to the DB's own timeout. State this in the risks; it is the same exposure as every fail-open path, but denial is a probe-able, unauthenticated-ish request an attacker can repeat (see E5).

### E3: ordering and the floor

D7 is correct and matches the admin arm (insert before the floor, never between floor and send). Two notes:
- The 404 malformed-id branch at the top of the handler stays untouched; good. Confirm in tests that it writes no row (3.1 does not say so; add one line). It is the `team_id` validity guarantee D2 relies on ("as validated"): `isCanonicalUuid` runs first, so `team_id` is always a valid UUID for the `UUID` column. Say that explicitly; otherwise a future reorder turns into an insert error.
- `applyTimingFloor(startTime)` is already measured from handler entry, so audit time is absorbed up to 150 ms. With the extra read plus insert on a healthy DB (two small queries) the floor still dominates; the timing parity claim in 5.3 ("response time not visibly different") is fine.

### E4: missing users row

D2/D10: `actor_user_id` has no FK (migration 8: "not FKs"), `actor_global_role` TEXT NOT NULL, so `'unknown'` and a deleted-user insert succeed. Good. Gaps:
- Can the session middleware even pass a deleted user? If `middleware.ts` re-loads the user it may 401 before the handler, making the integration fixture (3.6 "deleted users row with a live session") unreachable. Verify the fixture reaches TOPIC-002 before committing to the test; if not, drop it to a unit test with a stubbed helper result `{authorized:false, reason:"NOT_A_FACILITATOR", actorGlobalRole:null}`.
- migration 22's column comment says `actor_roles` is "populated only for auth.first_access_created and auth.role_claim_mapped"; #232 already made that stale, and this change adds a third writer where NULL has a second cause (role-read failed). Out of scope to alter, but the new operation's registry comment should say NULL here means "not captured or unreadable".

### E5: error paths and abuse

- Write amplification: any authenticated non-facilitator can repeat the 403 and each call inserts a row, no dedup (D1 chose this deliberately). That is a table-growth and audit-noise vector a participant controls, and rate limiting of reads does not exist on this endpoint (rate limiting exists for topic writes, #184). Not blocking, because it matches the other durable-row paths, but the spec/risks should state the volume bound is "one row per request" and name the existing global request rate limit, if any, as the only brake. Flag to Security as part of P2.
- Failure event content: spec says `errorCode` = SQLSTATE only. For `AuditWriteTimeoutError`, use `failureMode: "timeout"` like `fail-open-audit-write.ts` rather than `errorCode: null`, so the two failure causes are distinguishable in logs. Pin the key set in the audit-logger comment: `{actorUserId, teamId, endpoint, operation, stage, failureMode, errorCode}`.
- "Anything else that throws stays 500": clear, but the helper call itself (`checkStandingFacilitatorOrAdminAuthorization`) throwing is outside the audit try; keep it that way. Make sure the new try/catch wraps only the two audit steps and does not catch `applyTimingFloor` or `reply.send`.
- The denial event is not emitted when the insert fails (D4). That is a deliberate loss of the log copy exactly when the DB copy is lost. Reconsider: emitting the structured `topic.config_list_denied` log line even when the row failed costs nothing and keeps the denial visible in logs (the same way the access event pairs with the row). The failure event alone carries no reason. I would emit the denial event always, add `rowWritten: boolean`? That changes the pinned key set, so it is a spec decision; at minimum, ask. Today the design makes a failing DB hide both the row and the reason from every record.

### E6: registration and docs

- `AuditEventName` additions (1.2) are compile-safe; `emitAuditEvent` takes free-form `Record<string, unknown>`, so "exact key set" is a test discipline, not a type guarantee. Fine, but tests must assert key sets by equality as the design says.
- `docs/deployment.md` carries hand-maintained event counts ("14 events remain at risk", a per-prefix list at ~line 296-303). Task 4.1 says "update event counts"; make it a numbered check against that paragraph (log-only list gains `topic.audit_write_failed`; the durable `topic.config_list_denied` does not belong in the log-only list but may need the durable list updating).

### E7: tasks hygiene

- 0.2 (commit baseline snapshots before editing the handler) is good; say that the snapshot test is committed in its own commit so it demonstrably passes on the pre-change handler.
- 3.8 sweep as PR-description evidence is acceptable interim; also ask for the grep command to be pasted so it is reproducible.
- 3.4's "SQL-text match against the #259 fixture" is brittle but consistent with the existing approach; fine.
- Order tasks so 1.1 plus its helper assertion land with 3.7 as one reviewable commit.

## Summary of asks for the author

1. Resolve E1 (prefer folding the role read into the insert; else state the timeout semantics honestly and fix 3.3).
2. Record in D3/D6: new local `runDenialAuditStep` sibling and local insert function; do not touch `withAdminAuditFailureSignal` or `writeFailOpenAuditRow`.
3. Approve P4 as written with the two conditions above.
4. Decide whether the denial log event is emitted when the row fails (E5).
5. Confirm the deleted-user live-session fixture is reachable (E4).
6. Add the volume/write-amplification note to P2 for Security.
