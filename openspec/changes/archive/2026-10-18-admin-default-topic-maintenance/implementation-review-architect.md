# Implementation review (Solution Architect): admin-default-topic-maintenance (#216)

Reviewer: Ingrid Sollenberger. Scope: architectural fit of the uncommitted implementation against `design.md` and the deviations in `tasks.md` "Implementation notes". I read the route module, the writer, the validation module, the denial seam, the diffs to shared code and the structural-test changes. I did not re-run the suite.

## Verdict

Approve for the next stage. No must-fix items. Six should-fix items, mostly documentation of deviations so the design stays the authority, and two small robustness points. The boundaries I care about hold.

## Confirmations requested

- **#188 structural test unmodified: confirmed.** `git status` shows no change to `team-template-guard-structural.test.ts`, `team-template-guard-real-team-spelling.test.ts` or `topic-write-template-guard-structural.test.ts`. `EXTRA_IN_SCOPE_ROUTES` is not touched. The new routes live under `/api/v1/admin/default-topics`, outside the `^/api(/v\d+)?/teams/:[^/]+/topics` selector, as E1 argues. `checkWritableTeam` is not edited.
- **No migration:** no file under the migrations directory appears in `git status`.
- **No new dependency:** none visible in the diff (package files untouched).
- **Single writer:** `routes/admin-default-topics.ts` contains no SQL against `topics`. Its only query is the `users.global_role` read. All template writes are in `sessions/default-topic-maintenance.ts`, which uses `withAuditTransaction` and `lockTeamTopics` on the sentinel only. E11 is enforced by `template-writer-structural.test.ts` plus `helpers/template-writer-scanner.ts`, with a day-one allowlist keyed by file and function (route-level names in `routes/topics.ts`).

## Boundaries and patterns

- **Layering is right.** Route module does auth, media type, rate limit, parsing and HTTP mapping. Writer throws typed errors only (`MaintenanceError`, `BackstopError`, `AuditWriteError`, raw pg). The error table (`ERROR_TABLE`) lives in the route, which is the E3 intent. No driver text reaches a body; the generic 500 carries `correlationId`.
- **Check order matches E2.** Auth, role (403 with fail-open bounded denial audit), media type, canonical id (404, no query), rate limit, validation, transaction. Timing floor applied through `send()` on every return. Rate limiter gets the sentinel as `teamId`, as E2 item 4 specified.
- **Transaction discipline matches E3/E5/E6.** `SET LOCAL lock_timeout/statement_timeout`, lock, fresh re-read, operation, scoped backstop (positions checked only for ops that renumber, touched-row validation only for the rows the op wrote, so pre-existing damage does not wedge maintenance), audit insert in the same transaction, no audit row on no-op. The list read and the `info` event happen after commit and the emit is wrapped so a logging failure cannot turn a committed write into a 5xx. Good.
- **Add/restore position** uses MAX of active positions, then dense normalization; archive/reorder use negate-then-set via one helper (`setActivePositions`) with row-count checks. One helper, as the design asked.
- **Shared-code changes are minimal and consistent.** `register-routes.ts` one registration. `fail-open-topic-audit.ts` widens `teamId` to `string | null` only. `audit-logger.ts` adds the seven event names with the scoped text exception documented at the declaration. `template-anomalies.ts` drops `non_active_default` cleanly with the reason recorded. The denial seam is parameterized, reuses `admitDenialAudit` and `writeFailOpenTopicAuditRow`, and the rate-limit structural test allow-lists were extended by exactly the two new importers with reasons, not loosened.
- **Seed-sensitive tests** (`default-topics-seed-integration`, invariant (f)) now take the template lock and skip, not pass, once an audited maintenance row exists. This matches E6.

## Judgement of each deviation

1. **Own media-type check (415 `UNSUPPORTED_MEDIA_TYPE`) because Fastify 5 accepts `text/plain`: ACCEPT.** The design's premise was wrong; the control is needed and the placement (after role, before rate limit) is sound. Should-fix: amend design E1/E2a and the spec text, which still say "Fastify's default 415". See S1 and S2 below for two edge cases.
2. **Constants and validators in `sessions/default-topic-validation.ts`, re-exported from the maintenance module: ACCEPT.** Better than the design: the pure module has no db import, so the invariants checker and seed test do not load config. The re-export keeps the "one module" surface. Amend tasks 3.2 wording.
3. **History returns `{ history: [...] }`: ACCEPT.** A different resource from the list; reusing the `defaults/limits` shape would have been wrong. Amend E5/E7 and the spec scenario text and the REST contract (task 8.5).
4. **Reorder equal to stored order but on a gapped template is a write, not a no-op: ACCEPT.** It is consistent with E5/E6's "gaps are repaired by normal use" and produces an audit row that records the repair. Amend E5 (the no-op definition is "same order and already dense") and the spec scenario, otherwise the spec and code disagree.
5. **Test cleanup guard keyed on `VITEST` plus local host plus database name instead of `NODE_ENV === 'test'`; restore in its own transaction without `restoreTemplate`; lock per test: ACCEPT.** The `NODE_ENV` premise was false for the integration lane, and the guard is still fail-closed (hostname and `dipstick`/`dipstick_test` regex). The reason for not calling `restoreTemplate` (annotation columns, FK failure against lock-free files) is sound. Amend E6 "Test isolation".
6. **Adjusted existing tests: ACCEPT, each is a necessary consequence.** `room-open-integration` raw copy now filters `status = 'active'`, which is what the real copy does. `template-team-read-surfaces` exempts exactly two named GET URLs from the "no admin-wide view" rule (a set, not a regex loosening). Seed test as above.
7. **Timing floor mocked in large route suites, asserted against the real `CONTENT_TIMING_FLOOR_MS` in a dedicated file: ACCEPT.** Matches the E2 warning about the `{ CONTENT_TIMING_FLOOR_MS: 150 }` mock.
8. **Maintenance acts only on `is_default = true` rows; a non-default active row at a colliding position gives a generic 500: ACCEPT.** This is the documented operator-repair case; failing loudly is correct.
9. **"Works with no teams" covered by a SQL-capture test: ACCEPT.** Honest about the shared-database limit, and it proves the stronger property (the writer never touches teams, sessions, session_topics or memberships, locks the sentinel only).
10. **Suppressed-count log at 1, 2, 4, 8 rather than every denial: ACCEPT with a note.** The design said "running suppressed count" on a log-only event; thinning the log keeps the flood out of the log pipeline, which is the point. Amend E2 and ensure the runbook says the count is sampled, so nobody reads it as exact.

## Findings

No must-fix items.

### Should-fix

- **S1. Bodyless archive/restore with `Content-Type: application/json` and an empty body.** Fastify's JSON parser rejects an empty body with its own 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`), before the handler. A client that sets the JSON header on a POST with no body (common in HTTP libraries) gets a non-envelope 400. Verify and either add a test pinning the behavior or accept an empty body for these two routes. Low risk, but this is the first API a developer-level user will script.
- **S2. Archive/restore routes declare `bodyLimit` and call `isJsonContentType` with `bodyCarrying: false`.** The `bodyLimit` is harmless, but the design (E1) lists "five body-carrying routes". Fine; just ensure the REST contract says archive/restore take no body.
- **S3. Post-commit list read failure.** If `readTemplateList()` throws after COMMIT, the client gets a 500 for a write that happened, and a retry hits `DEFAULT_ALREADY_ARCHIVED`/duplicate name. The design accepted post-commit reading but did not say what happens on failure. Either catch and return the write result with a minimal body, or record it as a known edge in E7. I would record it; it is a Redis-free Postgres read on the same pool that just committed.
- **S4. Design and spec text must be reconciled with deviations 1, 2, 3, 4, 5 and 10** (listed above). The design is the architectural record; code that diverges silently from it is exactly the implicit-decision problem. One short "As built" subsection in `design.md` is enough, plus the spec delta wording for the reorder no-op and the history shape.
- **S5. `info` log event carries `actorIp`.** E5 says identifiers only: operation, topicId, changedFields, actor id and role, correlationId. The implementation also logs the IP. I think that is right, because the suggested alert ("an IP not seen before for that actor") needs it, and an IP is not topic text. Record it in E5 so the log-content test and the deployment doc agree.
- **S6. `parseReorder` hard-codes `15` rather than `MAX_ACTIVE_DEFAULTS`, and `ERROR_TABLE` hard-codes "15" in the capacity message.** The design said constants live in one place so a PO limit change is a one-line change. Import the constant. Nit-level but it defeats a stated risk mitigation.

### Observations (no action required)

- Reorder rejects an empty list at the parse layer and a duplicate id at both the parse and writer layers; the redundancy is harmless.
- The denial seam imports the limiter dynamically on use. This mirrors `assign-defaults-audit.ts` and keeps unit tests from building a Redis client. Consistent with the existing pattern.
- EXPLAIN result (4.10) shows the planner chose `idx_audit_log_operation` over `idx_audit_log_team`. Both are index-served and the sentinel rows are few; the "no new index" decision stands. Revisit only if maintenance history grows into the thousands.
- Operational loose end from the engineer notes: a fixture user from an earlier failed cleanup may remain in the dev database (`dfcaa715-9c1c-4875-ae8a-f6ee1cc266cc`). Not a code issue; someone with access should remove it before it confuses a later test run.
- Still open and correctly not ticked: PO acknowledgements (1.1), the human-gated follow-up issues (8.1), BRD traceability (8.4), REST contract (8.5), trigger outcome in the PR (8.7). I will want the REST contract (8.5) to state the XSS MUST (E4a) and the sampled suppression count before I sign off the documentation stage.

## Architecture-level checklist

| Concern | Result |
|---|---|
| Server-side authorization, live role, no frontend dependency | Met (`users.global_role` read per request, `isApplicationAdmin`) |
| One audited writer, second writer detected | Met (writer module plus structural scanner, fixtures in design E11) |
| #188 guard and structural test untouched | Met |
| Live-session isolation | Met by construction (sentinel-only lock and queries) and by SQL-capture test |
| Failure modes defined (lock timeout, audit failure, backstop, unique violation) | Met, each mapped in `sendMaintenanceError` / writer |
| Redis dependency | Rate limiter fails closed (503) as designed; denial audit is fail-open and blind during a Redis outage, as accepted in E2 |
| Observability | Met: `info` event after commit, `error`/`warn` logs for failures, denial-suppression events |
| Reproducibility / deployment | No migration; runbook updates are in `docs/deployment.md` (not reviewed in depth here) |
