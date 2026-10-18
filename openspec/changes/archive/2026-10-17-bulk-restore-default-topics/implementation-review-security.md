# Security Implementation Review: bulk-restore-default-topics (#218)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: working-tree diff; `POST /api/v1/teams/:teamId/topics/restore-defaults` in `packages/backend/src/routes/topics.ts` (lines ~611-640 for the wrapper, ~1718-1925 for the handler), `auth/audit-logger.ts`, `docs/deployment.md`, the backend tests, and the conditions in `design-review-security.md`. This is a source read; I did not run the suite or a load test.

## Verdict

Approve for merge, with production deployment gated on one open item (H1, the timing-floor measurement), which tasks.md already records as undone. I found no exploitable vulnerability in the handler. Nearly every design-review condition is met in the code. Two are partly open: the timing evidence (H1) and the log-hygiene test for the new route (M3.3).

## Handler checks

| Area | Result | Evidence |
|---|---|---|
| Cascade order | Pass | `no-store` header, canonical-id 404 (no query), role check, `enforceTopicWriteRateLimit`, `checkWritableTeam`, `checkCustomizationLockGate`, then `db.connect()`, BEGIN, `lockTeamTopics`. Matches live single-restore order. |
| 404 uniformity | Pass | Reuses `rejectNonCanonicalTeamId` and `checkWritableTeam`, so the bodies are the same helper output as the other topic writes. Nonexistent and template teams share one path. Unit test asserts "no SQL" for a non-canonical id. A byte-for-byte comparison test against single restore is not obvious in the file list (see L-A). |
| Role checks | Pass | `checkBulkRestoreAuthorization` wraps the shared `checkStandingFacilitatorOrAdminAuthorization`. It applies the floor on both 403 reasons and returns the machine-readable reason codes. Admin is admitted regardless of membership. Authorization is evaluated server-side from `session.userId` only. |
| Limiter accounting | Pass | Single `enforceTopicWriteRateLimit` call after the 403 and before the team lookup, so a 403-bound caller spends nothing and 429/503 are identical for existing, missing and template teams. One unit per request regardless of N. `TOPIC_WRITE_LIMITS` is unchanged (120 per 10 min, 400 per day). `attemptedOperation` is a constant and the context carries ids only. |
| Lock / transaction | Pass | `lockTeamTopics` is `pg_advisory_xact_lock`, so the lock is released on COMMIT, ROLLBACK or connection loss. No topic read precedes the lock (stricter than single restore). Both reads and the UPDATE are filtered by `team_id`; the UPDATE repeats `status = 'archived'`. Row-count mismatch throws and rolls back (fail-closed). Statement count is independent of N. |
| Empty case | Pass | ROLLBACK (releases the lock), no UPDATE, no audit row, 200 with empty `restored`. The floor is applied at the common tail. |
| Timing floor | Pass in code | Applied in the 403 branches, in the shared gates, on the empty/non-empty 200, and in the catch block before the rethrow (D22). This closes the H2 gap for bulk, unlike single restore. The floor is applied after a rollback failure too, since the rollback is wrapped in its own try. |
| No-store | Pass | Set first, before any exit, so it also rides on the 500 the global handler writes. Tests assert it on 200 (both) and 500. |
| Audit row contents | Pass | `restored[{topic_id, display_order}]`, `skipped[{topic_id, reason}]` capped at 100 with `skipped_count`, plus counts. No names, no free text. The audit INSERT is inside the transaction before COMMIT, so a restore never commits without its row; a test forces the INSERT to fail. `actor_ip` is `request.ip`; no body or header content is logged. The post-COMMIT `emitAuditEvent` is in its own try/catch, carries ids and counts only, and cannot change the 200. |
| SQL parameterization | Pass | All five statements use `$n` parameters (`$1::uuid[]`, `$2::int[]`, user id, team id). No interpolation. The only interpolated SQL is the pre-existing constant lock key. |
| Body handling | Pass | The body is never read. Tests cover a JSON body naming ids, other content types (never 5xx), and a body over 1 MiB (413/415, handler not reached). |
| Client input to the target set | Pass | None. The target set is computed from `team_id` and `is_default` under the lock. No IDOR vector. |

## Design-review conditions, verified against code

| Condition | Status | Notes |
|---|---|---|
| H1 floor includes bulk; test and measurement | OPEN (tracked) | `TIMING_FLOOR_MS` is still the 150 ms placeholder with `[PENDING]` fields. Tasks 4.12 (timing-oracle extension, 50-row median) and 4.14 (p95/p99 measurement) are unchecked. The unit test confirms the floor call on each exit, but nothing shows bulk's success latency is below the floor. Deployment gate, not a merge blocker, provided the PR records it (task 7.2) and an owner is named. |
| H2 thrown path applies the floor | MET | Catch block calls `applyTimingFloor` before rethrow, for both the row-count mismatch and the audit-insert failure; both have tests. Follow-up 9.2 (other routes) is correctly framed as using bulk as the reference. |
| M1 audit failure rolls back; requirement and test | MET | See audit row. Empty-200 writes no audit row and spends a unit; this is the documented decision. |
| M2 actor fields; metadata bound; provenance note | MET | Bounded: `skipped` is capped at 100 with a count. `restored` is uncapped but is bounded by the team's archived default rows, which is acceptable. The union-with-`topic.restored` note is in the `AuditEventName` comment and `docs/deployment.md` (including that `restored_by` is overwritten by later restores). |
| M3.1 one unit buys up to N mutations recorded | MET | Stated in the handler header comment and deployment docs; PR text should carry it as an accepted risk (task 7.2). |
| M3.2 uses the shared limiter, not a copy | MET | Calls `enforceTopicWriteRateLimit`. Please confirm the structural "limiter not imported by session/voting/WebSocket code" test passes in CI. |
| M3.3 hygiene test for the new route made mandatory | PARTLY MET | The diff adds the bulk route to the uppercase-team-id table in `topic-write-identifier-hygiene.test.ts`. I did not find a test asserting that topic names do not reach logs, limiter denial context or audit metadata for this route. The audit-metadata no-names assertion exists in `topics-bulk-restore.test.ts`; the log and limiter-context assertions are what is missing. |
| M4 404 and 409 oracle behavior | MET | No per-topic-id lookups exist. Lock state and active-name collisions are shown only to a caller who passed every gate and can already read the same data. |
| M5 retention | MET | `docs/deployment.md` and the audit-logger comment state that retention is the existing `audit_log` policy. |
| M6 `normalizeTopicNameForMatch` not a security comparator | MET | The comment in `shared/src/types/topic.ts` says so. |
| L1 lock is transaction-scoped | MET | `pg_advisory_xact_lock`. No lock timeout exists; this is pre-existing and not introduced here. |
| L3 no-store on every exit | MET for handler exits | Handler exits and the 500 are covered. The middleware 401 is intentionally excluded (task 4.12); the 429/503 limiter responses go out on the same reply after the header is set, so they carry it. |
| L4 CSRF / body limits | MET, with a recorded caveat | The control is the `SameSite=strict` cookie; there is no CSRF token or Origin check. Task 4.6 requires recording that in the PR. The 1 MiB limit test is present. |

## Findings

### H1 (carried, deployment gate). Timing floor not yet measured against bulk
Bulk is the slowest authorized topic write after reorder. Until 4.14 sets `TIMING_FLOOR_MS` from measured p95/p99 (covering bulk at N=12 and 50 rows, and reorder at its 200 cap), an authorized success may exceed the floor and be distinguishable from the denied exits. The code applies the floor correctly; the number is unproven. Action: keep production blocked on TODO-GROUP6, record the block and a named owner in the PR, and complete 4.12 and 4.14 when a database is available.

### M1. Log-hygiene assertions missing for the new route
Add a test for `topic.defaults_restored` that seeds distinctive topic names and asserts they are absent from every logged object (limiter denial context, `emitAuditEvent` fields, error logs on the failure paths). Names are in the HTTP response only. I could not confirm this exists; the code path itself is clean (ids and counts only).

### L-A. 404 byte-identity with single restore
Confirm there is a test comparing the bulk 404 body and headers to single-restore and assign-defaults for the same nonexistent and template team. The helper reuse makes a difference unlikely, but the condition asked for the assertion.

### L-B. Post-COMMIT throw edge
If code after COMMIT but inside the try (the response-shaping `map`) were to throw, the catch issues a ROLLBACK outside a transaction (a harmless warning) and returns a 500 for a committed change. The mapped fields are plain values, so this is not realistically reachable. Informational.

### L-C. Inherited and accepted
Global (not per-team) facilitator authority, no lock timeout, pool pressure while waiting on the lock, and `restored_at/by` overwrite on repeat restores are all unchanged by this change and covered by the earlier review. The audit log is the only history of earlier restores, so its retention matters.

## Residual risk

Low, subject to H1 before production. No blocking security defect in the implementation.
