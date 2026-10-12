# Design review (engineering): harden-team-creation-topic-copy (#215)

*Marcus Oyelaran, Full Stack Engineer. Checked against `facilitator-sessions.ts` (copy at ~L699-714, catch at ~L764-805), `content.ts` (~L1060-1071), `default-topics.ts`, `session-topics` snapshot SQL, `helpers/template-snapshot.ts`, `helpers/real-db.ts`, migration 18.*

## Verdict

Implementable, boundaries are mostly clean, scope is right. One blocking finding (the DROP INDEX test idea does not work as written for a route-level test), three should-fix items, and a few nits. The row_number() INSERT...SELECT is sound.

## Blocking

### B1. The in-transaction `DROP INDEX` cannot drive the real route

The design says the duplicate-position test drops `topics_team_active_order` inside a rolled-back test transaction. That is valid Postgres (DDL is transactional), but it only holds for statements run on that same client.

- `POST /api/v1/teams` takes its own connection (`db.connect()`, L667) from the shared pool. It will not see an uncommitted `DROP INDEX` or the uncommitted duplicate rows.
- Worse, `DROP INDEX` takes `ACCESS EXCLUSIVE` on `topics`. The route's `INSERT INTO topics` (and every parallel test file's reads and writes of `topics`) will block on that lock until the test transaction ends. If the test then calls `app.inject` and awaits it while still holding the transaction, it deadlocks until the pool or test timeout. It will look like a flaky hang, not a clean failure.

So the "required" C4 duplicate test is not achievable end-to-end via the route without committing DDL, which the design rightly forbids.

**Recommended fix.** Make the helper test the SQL, not the route:

1. Export the copy as a function in `default-topics.ts` or a sibling, for example `copyCanonicalDefaults(client, teamId)` (the INSERT...SELECT using the shared fragment), and the anomaly read/compute as `readTemplateTopicFacts(client)` plus pure `detectTemplateAnomalies(rows)`. The route calls them. This is a small refactor, and it is also the right seam for unit testing the pure parts.
2. The duplicate test then does: `BEGIN; DROP INDEX topics_team_active_order; <insert two active default rows at one position on the template, or better on a scratch team, see B2>; call copyCanonicalDefaults(client, newTeamId); assert positions 1..n; ROLLBACK` all on one client.
3. Keep the lock window to milliseconds: no `app.inject` inside the transaction, no awaits on anything but that client.
4. Route-level C4 stays covered by the gap case {1,3,7} (no index drop needed) and the archived/active collision case.

The "bound" clause in the design (fall back to a narrower test of pure logic) is the right instinct. I would promote it: the helper plus exported functions is the plan, not the fallback. State in the design that route-level duplicate testing is explicitly not possible, so a reader does not try.

### B2. Where the duplicate rows live (same test)

Inserting duplicate active rows onto the sentinel template inside the rolled-back transaction is safe from other files' perspective only after commit (they never see it), but the `ACCESS EXCLUSIVE` lock from B1 still stalls them. Also `topics` has other constraints on the template (migration 23 CHECKs concern sessions/memberships, but check any trigger or `(team_id, name)` uniqueness on topics before assuming two rows can be inserted). Since the copy function is parameterised on source team in the design only via the constant, consider giving `copyCanonicalDefaults` an optional `sourceTeamId` defaulting to the sentinel, so the test can use a scratch team as the "template" and never touch the real one. That also removes the snapshot/restore burden for this test. If you decline the parameter (it is a bit of surface area for tests only), insert onto the sentinel inside the rolled-back transaction, and say so.

## Should fix

### S1. The shared fragment: placeholder handling needs to be pinned

`canonicalDefaultsWhere(alias)` "takes the placeholder index". In `content.ts` the template id is `$2` (team id is `$1`), in the copy it is `$2` too (team `$1`). Both consumers happen to use `$2`, which is the simplest contract: make the fragment a function of `(alias, placeholderIndex)` and return the string; add a unit test that asserts the exact output for one alias/index, because the C7 equality test only proves behaviour, not that the interpolation did not silently produce `$undefined`. A string-building typo yields a Postgres syntax error at runtime, which the integration tests will catch, but only if infra is up (`requireInfraOrThrow` suggests CI always has it; fine).

Also note the repo already treats `default-topics.ts` as constants only. Adding SQL-building is a small expansion of its remit; update its header comment so the next reader knows.

### S2. Anomaly read adds a query to the hot creation path inside the transaction

It is one small query over about 12 rows, acceptable. But two details:

- "Best-effort, wrapped; a failure must not fail creation" is dangerous inside an open transaction. If the anomaly SELECT errors (for example a lock timeout), Postgres marks the transaction aborted and every later statement fails with `25P02`. A JS `try/catch` does not recover it. Either run the read under a `SAVEPOINT` and `ROLLBACK TO SAVEPOINT` on error, or run it before `BEGIN` on `db` (the pool), or after COMMIT. Running it after COMMIT is the cleanest: a failure cannot affect creation and the log is diagnostic only. The cost is that it reads post-copy state, which the design already accepts (read committed, different states are fine). It also means the empty-template rollback path would not log an anomaly, but that path already logs an error naming the template. Recommend after-commit (or before BEGIN) and state the choice.
- The design says "before or after the copy"; pick one. Reading before the copy via the pool is simplest and avoids the savepoint question.

### S3. Anomaly computation location and test shape

`detectTemplateAnomalies(rows)` pure and exported is good. Place it next to `default-topics.ts` (not in the route file, which is already 2600+ lines). The V1-V4 table is precise enough to translate directly into a table-driven unit test: empty template, healthy, gap, nonzero start, duplicates only (must not fire `non_contiguous_order`), archived default, archived non-default (fires `non_default_row`), 51+ ids cap. Add the "duplicates only" and "archived non-default" rows explicitly; those are the ones people get wrong.

Logging assertion: how do existing tests capture `request.log`? Confirm there is a capture pattern (a logger stream or a spy on `app.log`) before promising "exactly one entry" in the integration tests; otherwise assert on the pure function plus one spy test. If none exists, add the capture approach to tasks, not as new infrastructure.

## Verified viable

- **row_number() INSERT...SELECT.** Valid Postgres. Window functions are allowed in the SELECT list of `INSERT ... SELECT`; the column order matches the explicit column list; `row_number()` returns `bigint`, which assigns to the `display_order` integer column by assignment cast, no explicit cast needed. Rows are inserted in the order the SELECT produces, and positions are computed explicitly so ordering of insertion is irrelevant. Partial unique index `topics_team_active_order` on the new team is satisfied because positions are 1..n and the new team has no prior rows. `ORDER BY display_order, id` inside the window is deterministic. The `is_default` column is copied as `true` (all selected rows are defaults), same as today.
- **Snapshot ordering (C12).** The snapshot SQL orders by `t.display_order, t.id` among `status = 'active'` rows of the team, so session topic order equals team topic order by construction. Good, no change needed.
- **Zero-active path.** `NoActiveTopicsError` is already caught after `ROLLBACK` at ~L764-776 with the `internal_error` envelope and an error log naming `templateTeamId`. The design only needs a pinning test. Note the copy inserting zero rows is not an error by itself; the session insert and snapshot follow, so the team and session rows are rolled back with the transaction. Confirm the audit-log insert is after the snapshot (it is, L742+), which supports "no audit row persists".
- **Error mapping.** The `23505` handler is scoped to the `teams` insert (L691), so a stray `23505` from the topic copy would indeed surface as the generic 500. After the change the copy cannot raise it on healthy or anomalous data.
- **No migration, no response shape change.** Agreed. Deploy is a plain release.

## Hidden coupling and risks

1. **Parallel test files mutate the template** (acknowledged). `default-topic-provisioning-integration.test.ts` swaps the template's default rows for a fixture set. The new invariants test (D8) asserts exactly 12 active defaults with baseline names. If it runs while that file has the template swapped, it fails nondeterministically. Mitigation options: run the invariants test serially (Vitest `fileParallelism` or a dedicated project/pool config), or run it in a `describe` that takes the same coordination the swapping test uses, if one exists. Check how the existing provisioning test restores the template and whether vitest runs integration files in parallel. This is the most likely source of CI flakiness from this change. State the decision in `tasks.md`.
2. **Same issue for C9 and the new route tests that archive template rows.** `restoreTemplate` deliberately only touches rows by snapshot id; a test that archives a template default and then creates a team races with the swapping file. Give those tests the same serial treatment or keep them tolerant (assert on the set derived from the snapshot taken in-test, not the baseline).
3. **`restoreTemplate` does not restore `name`, `prompt`, `is_default`, or `first_session_description`.** The new tests that insert extra template rows (an archived default, an active duplicate-name row) must delete them in `finally`, and must not change those fields on existing rows. Say so in the tasks.
4. **Name-only join in `defaultTopicsNotActive`** now has a template-side filter. With the template having an archived and an active default of one name, the join to the team's rows is by name only, so the team side is unaffected. Fine, and #290 is tracked.
5. **Interpolating the fragment into SQL.** Safe given it is a module constant, but make the alias a parameter validated against `/^[a-z_]+$/` (or just a closed union `"dt" | "topics"`) so a future caller cannot pass user input. Cheap and honest.
6. **Log field naming.** Existing `request.log.error` call uses `{ templateTeamId, correlationId }`. Reuse exactly those keys in `template_anomaly` so a single log query covers both.

## Missing error paths

- Anomaly read failure inside the transaction (S2).
- Template id constant points at a team that does not exist (fresh DB without migration 4): copy inserts zero rows, same as the empty case, `NoActiveTopicsError`. Covered by C3; no extra test needed.
- Concurrent create plus template edit: acknowledged and acceptable.

## Nits

- The design says the invariants test checks "zero memberships and sessions on the sentinel (a cheap count)". Migration 23 already enforces this with CHECKs per the design text; a duplicate assertion is harmless but the design itself says not to duplicate them. Pick one; I would keep the count (it names the invariant in a failure message) and drop the claim about not duplicating.
- "Pass criterion: 0 rows proceeds" for the D7 query: record the exact SQL in `tasks.md` so the check is repeatable by someone else.
- The `down` path and `migrations-manual` scripts are not touched; fine, the declined trigger section correctly avoids them.

## Summary of requested design edits

1. Replace the in-transaction `DROP INDEX` description with the exported-function, same-client approach (B1), and say route-level duplicate testing is not possible.
2. Decide where the anomaly read runs (before BEGIN or after COMMIT) and drop the "wrapped try/catch" claim inside an open transaction (S2).
3. Pin the fragment signature and add a one-line unit test of its output (S1).
4. State how the invariants test and template-mutating tests are serialized against the provisioning test file (Risk 1 and 2).
5. Confirm the log capture technique for the "exactly one `template_anomaly` entry" assertions (S3).
