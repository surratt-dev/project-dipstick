# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: harden-team-creation-topic-copy (#215). Scope: boundaries, design conformance, consistency with existing patterns, the three reported deviations. No code modified.

## Verdict

Production code: approve. It matches design.md closely. One test-infrastructure must-fix (M1): the template lock is not held by every test that mutates or snapshots the template, and the full routes suite is observably flaky because of it.

## Production code vs design

- **Shared predicate (D1).** `canonicalDefaultsWhere` in `sessions/default-topics.ts` has the pinned signature, the closed `"dt" | "topics"` union, the integer >= 1 runtime check, the id as a bound parameter, and the safety comment. `content.ts` and the copy both use it with `$2`. Matches.
- **Copy (D2).** `copyCanonicalDefaults(client, newTeamId, sourceTeamId = DEFAULT_TOPICS_TEAM_ID)` uses `row_number() OVER (ORDER BY display_order, id)`, keeps the explicit column list (annotation columns excluded), and binds the source id. The route never passes `sourceTeamId`. Matches.
- **Anomaly check (D3).** Placed after `COMMIT` and the `finally`, on the pool, and reachable only on the success path. Every error branch returns inside the `catch`, so a 409, a rolled-back empty template, or a failed creation logs no anomaly. The check is wrapped in its own `try/catch`, logs `err.code` only, and uses the constant message `template_anomaly`. `correlationId` is `request.id`. `readTemplateTopicFacts` selects id and structural columns only, so no row text can reach a log. The new module sits beside `default-topics.ts`, not in the 2600-line route file. Boundary respected.
- **Restore list.** The status filter is on `dt` only, never on `t`. Matches.
- **Docs.** The `docs/deployment.md` runbook entry covers the log keys, the read-only inspection query, and ownership. Good operability coverage.
- **Pattern consistency.** `DatabaseError` is already imported in `facilitator-sessions.ts`. The log key names reuse the empty-template entry's `templateTeamId` and `correlationId`. No new HTTP status or error code. No frontend or response-shape change.

## Reported deviations

1. **`acquireTemplateLock` (beyond `withTemplateLock(fn)`).** Accepted.
   - It is a thin acquire/release split, and `withTemplateLock` is still exported and built on it.
   - Use in `beforeAll`/`afterAll` is the right shape for the provisioning test, where every test depends on an absolute template.
   - The lock is session-level on a dedicated connection. If a worker dies, Postgres releases it, so it cannot deadlock later runs.
   - Minor: `beforeAll` blocks without a timeout while it waits for the lock. That is acceptable, but a stuck holder would look like a hang.
2. **m=0 anomaly reading.** Accepted.
   - With no active defaults, `distinct` is empty, so `every()` is vacuously true and `non_contiguous_order` does not fire. This matches the proposal's "1..m, m = distinct count" semantics.
   - An empty active set cannot normally reach the post-commit check, because the empty-template path rolls back with its own error-level log.
   - If the template is entirely archived, `non_active_default` still fires, so operators still get a signal.
   - The table-driven test should keep the empty case pinned. It exists, as the design requires.
3. **No route-level duplicate-position test.** Accepted. This is the design's decision (Risks section), not a deviation. The function-level test uses `withDroppedActiveOrderIndex` with the NODE_ENV and localhost guard, `lock_timeout = '2s'`, and an always-rollback `finally`. It is correct and well guarded.

## Findings

### M1 (must-fix): template lock is opt-in and misses existing template-snapshotting tests; the suite is flaky

Evidence: three full runs of `vitest run src/routes/__tests__` in this tree. Run 1 was green. Run 2 had a failure in `template-team-eligible-teams-integration`. Run 3 was green. Separately, a narrower run of the new and neighbouring files showed failures in `template-team-creation-regression-integration` (expected 12 rows, got 13) and `template-team-topic-lock-integration` (the template's TOPIC-002 returned 500 instead of 200). The second of those passed when run alone. That is a cross-file race, not a logic error.

Cause: only 3 test files take the lock (provisioning, canonical-copy, invariants). Files that snapshot or restore the template, or create teams against it, do not:
- `template-team-creation-regression-integration` (the file this change edited for C9)
- `template-snapshot-integration`
- `topic-write-template-guard-structural`

Others read the template or create teams concurrently with the new tests that insert extra template rows. Those new tests also take `ACCESS EXCLUSIVE` on `topics` through the index drop. The design's lock rule is "every test that mutates the template"; the snapshot/restore users do mutate it. The 12-vs-13 failure is the regression test seeing another file's extra template row.

Required before merge:
- Take the template lock in `template-team-creation-regression-integration` (at minimum), and in the other snapshot/restore users: `template-snapshot-integration` and `topic-write-template-guard-structural`.
- Re-run the full backend suite several times. Task 6/8 acceptance should record the consecutive-green count.
- If flakes remain from the unlocked readers (the eligible-teams and topic-lock files) hitting the index-drop lock, apply the O1 fallback already named in `template-lock.ts`: isolate the file that uses `withDroppedActiveOrderIndex` as a separate Vitest project (or sequential pool). Do not widen the timeout.

### S1 (should-fix, minor): extra pool round trip before the reply

The anomaly read happens after COMMIT but before `reply.send`, so it adds one small query to team-creation latency and holds a pool connection a moment longer. It is bounded (twelve-ish rows, indexed on team_id), so it is acceptable. Optionally note in design Risks that it is on the response path by choice.

### Notes (no action)

- Alerting on `template_anomaly` stays a recorded follow-up (task 5.4), per the accepted limitation. The CI invariants test remains the only control that does not depend on a log reader.
- The least-privilege review item (runtime role grants on `topics`) stays deferred to the pre-production security review.

## Disposition

Approve production code. Hold merge on M1.
