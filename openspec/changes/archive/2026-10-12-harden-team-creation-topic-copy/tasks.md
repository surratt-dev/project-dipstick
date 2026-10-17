## 1. Preparation

- [x] 1.1 The name-only join duplicate in `defaultTopicsNotActive` (D10) is filed as #290 and the number is in `proposal.md` Out of scope. Gate satisfied.
- [ ] 1.2 Run `openspec validate --strict harden-team-creation-topic-copy` now that the specs exist (the spec delta headers are an archive-ordering hazard; the MODIFIED header must match the main spec, the lock delta is ADDED). The CLI was not installed in the proposal-stage or tasks-stage environments (`which openspec` empty). If still unavailable, record "not run, CLI unavailable" here and name the owner who runs it before archive: the Engineering Manager. Result: NOT RUN, CLI unavailable in the apply-stage environment (`openspec: command not found`). Owner to run before archive: the Engineering Manager.

## 2. Canonical-set fragment (D1, D6)

- [x] 2.1 Add `canonicalDefaultsWhere(alias: "dt" | "topics", paramIndex: number): string` to `packages/backend/src/sessions/default-topics.ts` (active, `is_default`, template team; `Number.isInteger(paramIndex) && paramIndex >= 1` else throw; no values interpolated; comment forbidding value interpolation and widening the alias type). Update the file's header comment: it is no longer constants only.
- [x] 2.2 Unit tests for 2.1 (spec: restore list and copy share one definition): `canonicalDefaultsWhere` exact output for `("dt", 2)` and `("topics", 2)`, and throws for `0`, `1.5`, `NaN`.

## 3. Test infrastructure (D8, Risks)

Convention checklist for the reviewer, applied to every test task in sections 4-6 that touches template rows (these are conventions, not tasks): extra template rows are deleted in `finally`; tests do not change `name`, `prompt`, `is_default` or `first_session_description` of existing rows (the #188 helper does not restore those); log capture uses the `Fastify({ logger: { level: "info", stream: { write } } })` pattern from `template-constraint-violation.test.ts`.

- [x] 3.1 Add `withTemplateLock(fn)`: a shared test helper taking a fixed-key Postgres advisory lock on a dedicated client, releasing in `finally`.
- [x] 3.2 Retrofit `default-topic-provisioning-integration.test.ts` to use `withTemplateLock`. Lands in the same commit as 3.1 and before any new template-mutating test.
- [x] 3.3 Reuse #188's template snapshot-and-restore helper (restore `display_order` by negate-then-set); do not write a second one.
- [x] 3.4 Add the test helper `withDroppedActiveOrderIndex(fn)` (guard, then `BEGIN`, `SET LOCAL lock_timeout = '2s'`, `DROP INDEX topics_team_active_order`, run `fn(client)`, always `ROLLBACK` and release in `finally`). The guard throws before `BEGIN` unless `NODE_ENV === "test"` and the `DATABASE_URL` host is `localhost` or `127.0.0.1`. Unit-test the guard itself (throws for a non-test env and a non-local host; does not open a transaction when it throws). Concurrency decision (architect O1): `DROP INDEX` takes ACCESS EXCLUSIVE on `topics`, and tests that only create teams do not take `withTemplateLock`. Tests using this helper run under `withTemplateLock`, and the residual is accepted and recorded in the helper's header: team-creating tests in other files may block on the drop or hit the 2 s `lock_timeout`; if flakes appear, isolate the file as a separate test project, do not widen the timeout.

## 4. Copy: function, tests, route (D2, D4)

- [x] 4.1 Implement and export `copyCanonicalDefaults(client, newTeamId, sourceTeamId = DEFAULT_TOPICS_TEAM_ID)` from `default-topics.ts` using the fragment (alias `"topics"`, `$2`) and `row_number() OVER (ORDER BY display_order, id)`; keep the explicit column list (annotation columns excluded). Function only; the route is not touched in this task.
- [x] 4.2 Required duplicate-position test, function level (a route-level version is not possible; do not attempt it), using 3.4 under `withTemplateLock`: on the helper's client insert two active default rows at one position on a scratch team (check first for other `topics` constraints, such as `(team_id, name)` uniqueness, and use distinct names); call `copyCanonicalDefaults(client, newTeamId, scratchTeamId)`; assert positions 1..n ordered by source id. No `app.inject` or other pool use inside the transaction.
- [x] 4.3 Rewire the team-creation route to call `copyCanonicalDefaults` and never pass `sourceTeamId` (C11). Update `template-team-creation-regression-integration.test.ts` in the same commit to compare active defaults only and renumbered positions (C9; the old expectation breaks as soon as this lands).
- [x] 4.4 Zero-active-defaults path (D4, C3): empty template pins status exactly 500, `internal_error`, the existing message, `correlationId` present in body, no template id, stack, SQL text or `NoActiveTopicsError` name in body, no persisted team/membership/topic/session/audit rows, error-level log entry naming the template. This test is the acceptance line that the path is unchanged; depends on 4.3. Also covers the spec scenario "Topic-copy failure prevents team creation from completing": force the generic copy failure (not only the empty template) and assert no team is persisted.
- [x] 4.5 C1: archived template default Y is not copied and active X is copied.
- [x] 4.6 C4 (positions): template positions {1,3,7} renumber to 1..n in order; healthy template positions equal the template's; archived-P1/active-P1 collision returns 201 with one topic at position 1.
- [x] 4.7 C11 (column fidelity): each copied column equals the template's, annotation columns unset (inline assertions, no new file); single-active-default, same-name active/archived, and NULL `first_session_description` cases.
- [x] 4.8 C12 plus cross-team isolation (inline in an existing creation test): session topic names and positions, in order, equal the team's; first session startable with n >= 1; healthy-template response status, shape and values (excluding generated ids and timestamps) unchanged. Also assert that an existing team's topic ids, statuses and positions are identical before and after a second team is created, and that editing a copied topic on the new team changes neither the template nor another team. This covers the spec scenarios "Editing a team's copied topics does not affect the canonical defaults or any other team" and "A later change to the canonical defaults does not retroactively affect an already-created team" (L1), and the proposal promise that the change never deletes, archives or rewrites an existing team's topics.

## 5. Restore list (D5)

- [x] 5.1 Rewrite the `defaultTopicsNotActive` query in `content.ts` to use the same fragment on `dt`; status filter on `dt` only, never `t`. Needs only 2.1; may run in parallel with section 4.
- [x] 5.2 C5, C6: restore list absent for archived template default; present with `isArchived: true` for a team's own archived copy of an active default; absent when both archived.
- [x] 5.3 C7 (depends on 4.3 and 5.1, since it asserts the two consumers agree): names copied at creation equal names reported for an empty team, across the C1/C5 states; plus a team holding some defaults (set difference); plus template X active and team X active gives X absent.

## 6. Anomaly signal (D3, D11)

- [x] 6.1 Add `detectTemplateAnomalies(facts)` (pure) in `packages/backend/src/sessions/template-anomalies.ts`: `duplicate_active_order`, `non_active_default`, `non_contiguous_order`, `non_default_row`; `topicIds` de-duplicated, in canonical order then id, capped at 50. Written test-first with 6.2.
- [x] 6.2 Table-driven unit tests for the detector: empty template, healthy, gap, nonzero start, duplicates only (must not fire `non_contiguous_order`), archived default, archived non-default (fires `non_default_row`), more than 50 affected ids (cap), a row that is both a duplicate-position row and a non-active default (appears once in `topicIds`), ordering of `topicIds` (canonical order then id), and the combined case from the spec scenario (archived default plus position gap: `non_active_default` and `non_contiguous_order`, `topicIds` holds only the archived default's id) (L2).
- [x] 6.3 Add `readTemplateTopicFacts(db: Pool)` (ids, `is_default`, `status`, `display_order` only; no name or prompt column is selected).
- [x] 6.4 Failing-check seam, decided now (before the route is written): the route imports `readTemplateTopicFacts` from `template-anomalies.ts` and tests make it throw with `vi.mock` of that module in a separate small test file (module mocking is file-wide, so it must not share a file with the integration tests). No production signature or plugin option is added for testing. If the route turns out to bind the import in a way `vi.mock` cannot intercept, record the deviation here and use an optional plugin dependency instead.
- [x] 6.5 Route wiring: after `COMMIT`, call 6.3 then 6.1 on the pool inside `try/catch`; on anomalies emit one `request.log.warn({ templateTeamId, anomalies, topicIds, correlationId: request.id }, "template_anomaly")` (ids and codes only, constant message, never row text); a check failure logs `template_anomaly_check_failed` at warn with no row text and never fails creation (spec: anomaly requirement); no response change. Depends on 4.3, 6.1, 6.3, 6.4.
- [x] 6.6 Integration tests (C2), under `withTemplateLock`: each anomaly type (V1-V4 semantics in `proposal.md`: nonzero start fires `non_contiguous_order`, archived non-default rows fire `non_default_row`, `topicIds` may be empty for position-only anomalies) yields exactly one `template_anomaly` warn; two creations against a damaged template yield two entries; healthy template yields none; the entry's keys are exactly `templateTeamId`, `anomalies`, `topicIds`, `correlationId` plus logger bindings, the message is the constant `template_anomaly`, no name or prompt text appears, and `correlationId` equals the `reqId` on the request's other log lines. Also (G1): the 201 response for an anomalous template has the same status and key shape as the healthy response and contains no anomaly field.
- [x] 6.7 Failing-check test (separate file, uses 6.4): a throwing `readTemplateTopicFacts` still yields 201, one `template_anomaly_check_failed` warn, no row text, and no `template_anomaly` entry.

## 7. Invariants test (D8, C8)

- [x] 7.1 Derive the invariants baseline: names, and `prompt` / `vote_type` / `first_session_description` content hashes per baseline topic, from migrations 4 and 11 and the requirements list. Record the source and any fallback (for example if prompt text is missing from a migration) in the new test file's header. If the sources disagree, stop and raise it to the Solution Architect: which source is authoritative is a design-level outcome.
- [x] 7.2 Add the template invariants integration test (a-e of D8) at `packages/backend/src/routes/__tests__/template-invariants-integration.test.ts`, N = 12, baseline name list inside that file only, each failure naming its invariant, plus invariant (f): the hashes from 7.1 (S4). Invariant (e) goes last in the file so (a)-(d) report first. Wrapped in `withTemplateLock`. Structure the checks as a pure invariant-checker function over fetched rows so 7.3 can exercise failure.
- [x] 7.3 Prove the invariants test can fail (G2): table-driven tests over the pure checker with an archived template default and with a changed prompt, asserting the failure messages name the "no non-active default" and "baseline content" invariants respectively. In addition, run once and record in the PR the same two mutations in a rolled-back transaction or scratch database against the real test.

## 8. Declined trigger, follow-up, runbook (before merge, not after)

All of section 8 must be done before merge: the decline in `design.md` lapses if the F5 lines are lost.

- [ ] 8.1 Add concrete acceptance lines to F5 (#216), linked from #215: "every template write goes through one audited function"; "that function writes one `audit_log` row per template write"; "reconsider the template write guard". F5 also updates the invariants baseline (names and content hashes from 7.1). Done after 7.2.
- [ ] 8.2 Record the trigger decision and its four reasons on #215, including the named residual risk (content tampering by a database-credential holder) and its limit (invariants test is CI-only).
- [x] 8.3 Runbook entry (short paragraph) in the existing operations docs (`docs/deployment.md` unless a runbook file already exists): what `template_anomaly` and `template_anomaly_check_failed` mean, how to inspect the template team's rows (read-only), who repairs it (Engineering Manager owns triage; repair is a data fix, not part of this change). Done after 6.5.
- [ ] 8.4 Open follow-ups, not built here: an alert on `template_anomaly` when a log pipeline exists; add to the pre-production security review the question of the runtime database role's grants on `topics` and sentinel rows.
- [x] 8.5 Confirm `design.md` "Declined: template write trigger" is present and unchanged by implementation (C10).

## 9. Verification before merge

- [ ] 9.1 D7 read-only data check, run by the implementer (read-only; the runner needs live read access, so if the implementer lacks it, record "not run, reason" and name who runs it before merge). Run in `BEGIN READ ONLY; ... ROLLBACK;` against the live environment; sentinel id is `DEFAULT_TOPICS_TEAM_ID`. Pass criterion: count = 0 proceeds. Count > 0: the Engineering Manager opens a remediation issue, its number is recorded here before merge, and Rachel Okonkwo gets a one-line report. No repair is built into this change.
  - Exact SQL:
    ```sql
    SELECT count(*) FROM topics t
    WHERE t.team_id <> '00000000-0000-0000-0000-000000000001'
      AND t.is_default = true AND t.status = 'active'
      AND t.name NOT IN (SELECT d.name FROM topics d
                         WHERE d.team_id = '00000000-0000-0000-0000-000000000001'
                           AND d.is_default = true AND d.status = 'active');
    ```
    If the count is above 0, re-run selecting `t.id` only (not team names) and record ids in the remediation issue, not in a public thread. The remediation issue notes whether any of those rows have votes or session history attached (a naive repair would delete data).
  - Reading the result (L4): count = 0 means no resurrected-name rows; reordering is not checked.
  - Result: NOT RUN against live (no live read access in the apply environment). Informational only: the same SQL run against the LOCAL dev database (docker `project-dipstick-postgres-1`, not live) returned count = 0 after the test runs. Who runs it against live before merge: the Engineering Manager (or whoever holds live read access). Remediation issue: n/a unless live count > 0.
- [x] 9.2 Gate (T1): the 9.1 result or "not run, reason" is recorded, and the remediation issue number is recorded if count > 0.
- [x] 9.3 Run backend unit and integration suites, lint, typecheck. M1 (architect review): the template lock is now also held by `template-team-creation-regression-integration`, `template-snapshot-integration` and `topic-write-template-guard-structural`; `template-team-eligible-teams-integration` had a pre-existing rowCount race with other files' team cleanup, fixed by asserting no listed team is deactivated or the template. Green full-backend runs (1913 passed, 3 skipped each) with the lock in place: 12 consecutive full-backend runs green (1913 passed, 3 skipped each) after the fixes, on the local dev Postgres/Redis. Environment note: `dipstick:ratelimit:team-manager:global` in the dev Redis is a shared TEAM-006 limiter that fills across repeated full runs and then yields 429 in four unrelated files; clear it between runs when looping locally.
- [ ] 9.4 Re-run `openspec validate --strict harden-team-creation-topic-copy` (see 1.2) after the spec edit adding `template_anomaly_check_failed`; if the CLI is still unavailable, the named owner in 1.2 runs it before archive.
- [x] 9.5 `git diff --stat` shows no change to frontend, shared package or migrations.
- [ ] 9.6 PR description states the `topic-customization-lock` change is wording-only with no change to access rules.
- [ ] 9.7 Pre-merge browser spot check (Priya): create a team, confirm twelve topics in order, archive one of the team's own defaults, confirm it appears in the team's archived list, restore it. This verifies that creation is unchanged and existing archive and restore still work; it does not verify C5-C7 (no UI consumes `defaultTopicsNotActive`), which are verified by the API tests in section 5 only. Do not skip it even if section 5 passes: it is the only end-to-end check of restore.
