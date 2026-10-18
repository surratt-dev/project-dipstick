# Engineer review: admin-default-topic-maintenance (#216) design

Reviewer: Marcus Oyelaran (Full Stack Engineer). Inputs: proposal.md, design.md, checked against `packages/backend` at branch `agent-team/216-admin-default-topic-maintenance`. I did not re-read every delta spec line by line; findings below come from the design and proposal and from the code they cite.

## Verdict

Implementable, and the shape is right: one writer module, a separate route family, `withAuditTransaction`, no migration, no trigger. The boundaries are clean in principle. But the design makes several factual claims about existing code that are false, and it misses three existing structural tests that this change will turn red. None is fatal; all need to be fixed in the design/tasks before build. Approve with required changes (R1 to R7 below).

## Claims verified true

- `DEFAULT_TOPICS_TEAM_ID = 00000000-0000-0000-0000-000000000001`, `canonicalDefaultsWhere` requires `is_default AND status = 'active'`, and `copyCanonicalDefaults` is one `INSERT ... SELECT` with `row_number() OVER (ORDER BY display_order, id)`. The single-statement snapshot argument in E8 holds. The explicit column list also excludes the annotation columns.
- `withAuditTransaction(domainWrite, auditInsert)` exists as described. Errors from `domainWrite` propagate unwrapped, errors from `auditInsert` become `AuditWriteError`, and the closure can skip the INSERT (no-op case). `SET LOCAL statement_timeout` only covers the audit INSERT.
- `lockTeamTopics(client, teamId)` exists (in `sessions/session-topic-snapshot.ts`, not `topic-lock-helper.ts`) and is a transaction advisory lock on `hashtext(teamId)`.
- `isApplicationAdmin`, `admitDenialAudit`, `DENIAL_AUDIT_LIMIT = {limit: 10, windowMs: 60000}` (the 11th denial is suppressed, matching the design's wording), `enforceTopicWriteRateLimit`, `AuditWriteError`, `checkAssignDefaultsAuthorization` all exist.
- Partial unique index `topics_team_active_order` on `(team_id, display_order) WHERE status = 'active'` (migration 18). It is non-deferrable, so negate-then-set is required, and TOPIC-006 already does it (`topics.ts` ~2044). `archived_by`, `restored_by`, `restored_at` columns exist (migrations 16 and 17). `idx_audit_log_team` exists (partial, `team_id IS NOT NULL`).
- The #188 structural test selects on `^/api(/v\d+)?/teams/:[^/]+/topics` plus `EXTRA_IN_SCOPE_ROUTES`. `/api/v1/admin/default-topics*` is outside it. (The design says `EXTRA_IN_SCOPE_ROUTES` is "today `GET /api/join/:token`, `GET /auth/callback`". In `team-template-guard-structural.test.ts` that constant holds those two; the similarly named one in `topic-write-template-guard-structural.test.ts` is empty. Both are fine for this change.)

## Required changes (the design is wrong or silent)

### R1. Existing structural tests will fail and are not in the Impact list (high)

`routes/__tests__/topic-write-rate-limit-structural.test.ts` ("topic-write limiter import graph is an allow-list", #184 5.7) asserts:
- `routes/topic-write-rate-limit.ts` is imported only by `["routes/topics.ts"]`;
- `auth/denial-audit-limiter.ts` is imported only by `auth/assign-defaults-audit.ts`, which only `routes/topics.ts` imports;
- `auth/sliding-window-limiter.ts` importers equal an exact list.

E10 has the new `routes/admin-default-topics.ts` call `enforceTopicWriteRateLimit`, and E2 reuses `admitDenialAudit` through "a small denial-audit seam". Both break these assertions. The allow-list exists deliberately to keep the limiter away from session runtime, so the fix is to extend the allow-list by exactly the new files with a written reason (admin route module, the new denial seam), not to loosen it. Add this test to the Impact section and to tasks. Also note that unit tests that import a route module which imports the limiter must follow the 5.4a mock rule (shared `topic-write-rate-limit-mock.ts`); the new route's unit tests will need it.

### R2. `audit_log.created_at` does not exist; the column is `timestamp` (high)

E5 defines `lastChangedAt` and the history `at` as "the `created_at` of the latest audit_log row". `audit_log` (migration 8) has `timestamp`; no later migration adds `created_at`. Use `timestamp` (the SQL column) and map to `at`/`lastChangedAt` in the JSON. Tie-breaking on `id` descending is on a random UUID, so it is deterministic but meaningless; fine, but say so. Also `timestamp` defaults to `now()`, which inside one transaction is the transaction start time; two writes serialized by the advisory lock still get distinct, correctly ordered times, so the ordering is safe.

### R3. `operation LIKE 'topic.default_%'` matches unrelated rows (high)

In SQL LIKE, `_` is a single-character wildcard. `'topic.default_%'` matches `topic.defaults_assigned`, `topic.defaults_assign_denied` and `topic.defaults_assign_failed`, which exist today (assign-defaults, #200). Their `team_id` is the target team from the path, which can be the sentinel (the 403 denial row is written before any team lookup, so a non-admin POSTing assign-defaults at the sentinel id writes a sentinel-keyed row). Consequences: (a) the history read returns assign-defaults rows with no `topicId`/`before`/`after`, breaking the response shape; (b) the invariants test gate (f) "no `topic.default_%` row for the sentinel" can be disabled by an unrelated denial. Also `topic.default_maintenance_denied` is already excluded from history but is not excluded from the (f) gate, and its `team_id` is unspecified in the design.
Fix: use an explicit `operation = ANY($1)` list of the five names (a shared constant exported by the writer module), or escape the underscore. Use the same constant in history, `lastChangedAt`, the (f) gate, the isolation test cleanup, the runbook query, and the closed-key-set test. State the denial row's `team_id` (sentinel is consistent with the other topic denial rows; say so).

### R4. `TIMING_FLOOR_MS` is not exported (medium)

`content/timing-oracle.ts` has a module-private `const TIMING_FLOOR_MS = 150` and exports `CONTENT_TIMING_FLOOR_MS` and `applyTimingFloor(startTime)`. The design says "tests read the constant"; they must read `CONTENT_TIMING_FLOOR_MS`. Existing unit tests mock the module with `{ applyTimingFloor, CONTENT_TIMING_FLOOR_MS: 150 }`, so a test that wants the real floor value needs the real module. Correct the wording in E2.

### R5. The second-writer scan, as written, flags its own allowlisted files (medium)

E11's extra rule: "no file other than the writer module may contain both a topics write and a reference to `DEFAULT_TOPICS_TEAM_ID`". `routes/topics.ts` contains both (team-scoped writes plus the sentinel comparison in the #188 guard and the assign-defaults path), and `sessions/default-topics.ts` defines the constant and contains `copyCanonicalDefaults`. As written the test is red on day one, or silently needs more exemptions than the allowlist shows. Also, file-level granularity means a sentinel-targeted write added inside `routes/topics.ts` (already full of writes) is never caught; that is the likeliest regression and the one the test exists for. Options: scan per statement, not per file (flag any statement whose bound parameters or text reference the sentinel, with `copyCanonicalDefaults` as the only exception because its sentinel is the SELECT source, not the write target); or accept the file-level limit and say plainly that `topics.ts` is trusted via the #188 test. Also confirm the regex handles the real shapes in the repo: `UPDATE topics t` (alias), multi-line template literals, and CTE-prefixed writes. A scan of `src` today finds topic writes only in `sessions/default-topics.ts` and `routes/topics.ts` (at least seven statements), so the allowlist content in E11 is accurate. Make sure `session_topics`/`INSERT INTO topics_...` do not false-match (word boundary after `topics`).

### R6. The "unreachable" invariant backstop is reachable, and has no defined behaviour (medium)

E3/E6: the post-write invariant check "throws an internal error ... should be unreachable". It is reachable on pre-existing damage: non-dense positions (the very anomaly #215 logs), a `is_default = false` row, or an old row that fails E4 validation (check 4 covers archived rows too, which the maintenance path never validated). Add N+1 uses the active count, not `MAX(display_order)+1`, so a gap in the template makes the add itself collide on the unique index (23505, an unhandled 500). Any later write on a damaged template then fails with 500 forever, including the repair. Decide: either (a) add uses `MAX+1` and archive/reorder/restore always renumber dense 1..N (repair by normal use), with the check scoped to what this operation touched; or (b) a precondition check that returns a defined `409 TEMPLATE_INVARIANT_VIOLATED` plus a log, and a documented runbook repair. Also the invariant check will run `SELECT` over the template in-transaction after every write; fine for 27 rows.
Related: the 23505 unique-violation path and `ReorderRowCountMismatchError` analogues need mapping to 500 with correlationId, not an uncaught error. Say how `AuditWriteError` and domain errors map to responses (TOPIC-006 has a catch ladder; the design says only "the existing 500 handled path").

### R7. Invariants test change is bigger than stated (medium)

`routes/__tests__/helpers/template-invariants.ts` is a pure function with a closed `InvariantId` string-literal union whose labels contain the old wording ("(a) ... equal the baseline", "(c) no non-active default"), a baseline parameter, and its own unit test `helpers/template-invariants.test.ts` (the "G2: it can fail" proof). The design talks only about `template-invariants-integration.test.ts`. Rewriting (a), (c), (f) means changing the checker signature, the label union, and its unit test. Add them to Impact and tasks. Also the (f) "skipped with the reason, never as passed" needs a mechanism in vitest (`ctx.skip()` inside the test, decided after a DB read), which is fine but should be noted since the existing file uses `describe.skipIf(!infraUp)`.

## Smaller findings

1. **`updated_at` not mentioned.** Topic edits, renumbering and archive/restore in `topics.ts` set `updated_at = now()`. The writer should too; add to the contract and to the row-level assertions.
2. **Edit audit before/after.** Metadata holds full text of each changed field, bounded at roughly 1.3 KB per side; fine. `actor_roles` column: migration 22 says it is populated only for two operations; the design says maintenance rows populate it "as for other audited topic writes" but the topic writes populate no `actor_roles`. State the value (NULL is the documented meaning "not captured").
3. **Advisory lock without a bound.** `lockTeamTopics` waits indefinitely. A hung admin transaction blocks all maintenance writes. The transaction has no `lock_timeout` or `statement_timeout` outside the audit INSERT. Add `SET LOCAL lock_timeout` (migration 23 uses 200 ms for DDL; a few seconds is right here) and map the timeout to a defined 503/409, or accept and say so. Team creation does not take this lock, so it is unaffected.
4. **`lastChangedAt` query cost.** The list scans all sentinel audit rows (`idx_audit_log_team` is on `team_id` only) and filters `metadata->>'topicId'` in memory. The sentinel's audit rows also include `topic.write_denied_template` and `team.template_cleanup`, so the scan can grow with probe traffic. Use one `SELECT DISTINCT ON (metadata->>'topicId') ... ORDER BY metadata->>'topicId', timestamp DESC, id DESC WHERE team_id = $1 AND operation = ANY($2)` (not N+1 per row). With dedupe on denied rows the growth is small today; note the dependency and the retention risk already recorded. If it ever matters, a partial expression index would be a migration and therefore its own change.
5. **JSON number `displayOrder: null` for archived rows** is derived from the stored (stale) `display_order`; make sure the serializer nulls it from `status`, not from the column, and add it to the closed-shape test.
6. **E2 step order versus code.** Assign-defaults reads the role, writes the denial row, then the timing floor. In the new route, the non-canonical `:topicId` 404 (step 3) comes after the role check; fine. But the design says the 403 applies to all seven routes "reads included" and "bounded per actor"; the denial seam must take an `endpoint` parameter (the existing one hard-codes `ASSIGN_DEFAULTS_ENDPOINT` in log events). Write it as a parameterized seam, not a copy.
7. **Rate limit context.** `TopicWriteDenialContext` requires `teamId` and `attemptedOperation`. The design never says what `teamId` is for a route with no team; the limiter writes `team_id` into its breach audit row and logs. Say it is the sentinel (consistent with the rest) and that the limiter's `team_verified: false` metadata stays. Also confirm with the BA that sharing one budget between team topic writes and template maintenance is intended; an admin doing a bulk edit could throttle their own team work. (Probably fine; it is the cheaper choice.)
8. **Route registration.** `register-routes.ts` is the single registration point and the structural tests enumerate through it, so add the plugin there; auth middleware applies by default (only `PUBLIC_ROUTES` bypass), so no `onRequest` wiring beyond that. The E1 "registered routes under `/api/v1/admin/default-topics` equal exactly this list" test can use the same onRoute enumeration the #188 test uses. Add a guard that no OTHER route in the app lives under the `/admin/` prefix without a similar review, or drop that thought; low value.
9. **Name-uniqueness has no database backstop.** It is enforced only in code under the advisory lock. Acceptable because the lock serializes all maintenance writers, but a manual SQL edit or a future second writer defeats it; the structural test covers the second writer. Note it.
10. **Collation of "case-insensitive".** E4 says `trim().toLowerCase()` in app code, no locale. Say the comparison happens in JS over rows read inside the lock (not SQL `lower()`), or the two will disagree on non-ASCII names.
11. **Code-point counting.** Use `[...s].length` or `Array.from`, not `.length`; the text says code points and the test list should include an astral-plane character at the boundary. Also reject lone surrogates, or say they are accepted.
12. **Plain-text rule against real seed text.** Verified claim is "all pass" but I did not re-run it; task 2.1's test is the right place. Make sure the regexes are anchored by test cases both ways ("rate < 5" accepted; `<b` rejected; `&#x1F;` rejected; `R&D` accepted).
13. **`PUT /order` versus `PATCH /:topicId`.** No collision (different methods; `order` static). `POST /:topicId/archive` with `:topicId` equal to `order` or `history` hits the canonical-id 404, fine.
14. **Draft idempotency/double-submit.** Add has no idempotency key; a double click adds two rows unless the name check catches it (it does, `DEFAULT_NAME_DUPLICATE`). Good; mention it as the intended guard so nobody "fixes" it.
15. **Rollback note** says old code with archived defaults only logs noise. Also true that old code's `template-anomalies` would not break creation; but the old invariants test would fail in CI for anyone deploying the old code against a DB that has maintenance rows. CI DBs are not production, so ignore, but state it.

## Risks I agree with / would raise

- Retiring `non_active_default` is correct; otherwise every team creation logs a warning once any default is archived. The change to `template-anomalies.ts` is small and pure; confirm the unit test updates (two files named in the design are right: `template-anomalies.test.ts`, `team-creation-canonical-copy-integration.test.ts`). Also grep for any log-alert docs mentioning `non_active_default` (runbook).
- The trigger decision (declined, structural test) is reasonable and the cost analysis is accurate: migrations 4 and 11 write the template, and many suites mutate it through snapshot/restore helpers.
- API-only interim with no screen: fine; the real cost is that an admin has no preview. The history read compensates.

## Suggested task additions

- Extend `topic-write-rate-limit-structural.test.ts` allow-lists (R1).
- Constant `MAINTENANCE_AUDIT_OPERATIONS` (five names) and use it everywhere (R3).
- Update `helpers/template-invariants.ts` and its unit test (R7).
- Explicit error-mapping table for the route: typed domain errors to statuses, `AuditWriteError` to 500, unique violation 23505 to 500 with log, lock timeout (finding 3).
- A test that the denial and rate-limit rows for these routes carry the documented `team_id` and do not match the five-name list.
