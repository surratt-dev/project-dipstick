# Security Review of the implementation: harden-team-creation-topic-copy (#215)

*Tomás Ferreira, Security Analyst. Reviewed the uncommitted diff (default-topics.ts, template-anomalies.ts, facilitator-sessions.ts, content.ts, docs/deployment.md, the test helpers and tests). No code was modified.*

## Verdict

**Approve, with one process must-fix (M1) that is not a code defect.** All six amendments S1-S6 are implemented or recorded. No access rule changed. I found no injection, leakage or log-injection path.

## Must-fix

- **M1. Task 8.1 is still unchecked (S5).** tasks.md says section 8 must be done before merge, because the trigger decline lapses if the F5 (#216) acceptance lines are lost. The three lines (one audited function for template writes; one `audit_log` row per template write; reconsider the write guard; plus F5 updates the invariants baseline) must be on #216 and linked from #215 before merge. I could not verify the issue itself from the repository; the owner should confirm and tick 8.1.

## Findings against S1-S6

| ID | Status | Evidence |
|---|---|---|
| S1 ids and codes only | Met | `readTemplateTopicFacts` selects `id, is_default, status, display_order` only, so no text can reach the entry. Log fields are `templateTeamId`, `anomalies` (closed union), `topicIds` (uuid column, capped at 50), `correlationId`. The message is the literal `"template_anomaly"`. The integration test asserts the closed key set and that no template name or prompt appears in the serialized entry. |
| S2 correlationId joinable | Met | `correlationId: request.id`; the test asserts it equals `reqId` and that other lines share it. |
| S3 SQL fragment | Met | `canonicalDefaultsWhere(alias: "dt" \| "topics", paramIndex: number)`: closed union, `Number.isInteger && >= 1` runtime check, SAFETY comment. The template id is always a bound parameter (`$2`). Both call sites pass literals (`"dt", 2` and `"topics", 2`). `copyCanonicalDefaults` binds `newTeamId` and `sourceTeamId` as `$1`/`$2`; the route never passes `sourceTeamId`. |
| S4 prompt tampering | Met (CI only) | Invariant (f) hashes prompt, vote_type and first_session_description (sha256 of the text). The design states plainly that this does not detect a production edit. Accepted. |
| S5 F5 lines | **Open** | See M1. |
| S6 best-effort read | Met | The anomaly read runs after COMMIT and after `client.release()`, on the pool, inside its own try/catch. It cannot abort the creation transaction or change the 201. Failure logs `template_anomaly_check_failed` with `errCode` (a `DatabaseError.code` string, or undefined) and `templateTeamId` only; no message, SQL or row text. A test (6.7) covers it. |

## Other checks

- **Empty-template response:** 500, category `internal_error`, fixed message, `correlationId`. No template id, no class name, no SQL. The test asserts the body lacks the sentinel id, `NoActiveTopicsError`, `INSERT INTO`, `at ` (stack) and `session_topics`. The error log carries `templateTeamId` and the same `correlationId`. Rollback leaves no team and no audit row (asserted). This branch is unchanged from the existing code, not new.
- **Access rules:** the diff to `content.ts` is the one predicate line plus the import. The restore-list query is still scoped by `$1 = teamId` on the team side; the new predicate only adds `status = 'active'` on the template side, so it narrows rows. `facilitator-sessions.ts` changes only the copy call and the post-commit signal. No role check, TOPIC-002 arm, audit event or response shape changed. The 201 body keys are asserted equal with and without an anomaly.
- **Copy column list:** still explicit; annotation columns are not copied (Decision 9 preserved).
- **Test guard:** `assertSafeToDropIndex` requires `NODE_ENV === "test"` and a `localhost`/`127.0.0.1` host parsed from `DATABASE_URL`; it fails closed on a missing or invalid URL. The index drop is in a transaction with `lock_timeout 2s` and an unconditional ROLLBACK, and runs under the advisory lock. The residual lock-wait risk for other files is documented in the helper (architect O1). Accepted.
- **docs/deployment.md:** the runbook states ids and codes only, and its inspection query omits `name` by default. Good.

## Non-blocking notes

1. The `alias` restriction in `canonicalDefaultsWhere` is compile-time only; there is no runtime allow-list. Acceptable (callers are literals), but a two-value runtime check would match the index check. Optional.
2. The guard host check does not look at the database name, so a local non-test database would pass. Optional hardening: also require the name to be the test database.
3. Invariant failure messages include template names and `nonActive` pairs. They appear in CI output only, and template names are not sensitive, so fine. Do not extend them to prompt text.
4. Carried over from the design review, still open and out of scope: no alert on `template_anomaly`; runtime DB role grants on the sentinel rows are for the pre-production review.
