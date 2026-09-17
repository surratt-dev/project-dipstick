## 1. Runbook documentation

- [x] 1.1 In `docs/deployment.md`, add a new `### Logging` subsection as the last
  subsection under `## Running the Application` (after `### Health check` at line ~138,
  before `## Kubernetes` at line ~148).
- [x] 1.2 Populate the subsection with the drafted content from
  `exploration-notes.md` ("Drafted runbook content"): the transport-filtering gap, the
  corrected list of log-only/DB-unbacked events at risk — every `auth.*` event, every
  `join.*` event, and `team.access_grant_mismatch`, `team.manager_association_rate_approaching`,
  `team.manager_association_rate_limit_check_failed`, `session.reveal_latency_observed` (18
  events total; independently re-verified against every `emitAuditEvent`/`INSERT INTO
  audit_log` call site, see design.md Decision D3) — the note that most audit events are also
  DB-backed and unaffected, and the required precondition before adopting a filtering
  transport.
- [x] 1.3 Include the "Future consideration (deferred, GitHub issue #3)" note for the
  startup-reachability check, stating it is not built now, its trigger condition, and the
  reference to issue #3.

## 2. Code comment

- [x] 2.1 In `packages/backend/src/auth/audit-logger.ts`, add the drafted inline comment
  (`exploration-notes.md`, "Drafted code comment") immediately after the existing "Fix:
  explicitly set the child logger's level..." comment (currently ending at line ~228) and
  before `const auditLogger = logger.child({ audit: true });` (currently line 229).
  No other lines in this file change.

## 3. Spec traceability

- [x] 3.1 In `openspec/specs/first-access/spec.md`, add a new `## Resolved` subsection
  immediately after `## Open Issues`. Move the `#3` entry there, annotated
  `**#3** — closed (audit-logger-transport-filtering) — [Security] Audit logger level fix
  does not cover transport-level log filtering`. Also move the `#2` entry there (already
  closed by the merged `oidc-error-log-sanitization` change but never marked as such — see
  engineer design review), annotated `**#2** — closed (oidc-error-log-sanitization) —
  [Security] Audit OIDC library error messages for potential token content leakage in logs`.
  Remove both from `## Open Issues`, leaving only `#4`–`#7` there so its "remain active"
  intro line stays accurate. This does not mirror an existing "closed"-in-place pattern in
  Open Issues — no such pattern exists there (confirmed: it exists only in Known Limitations,
  a differently-scoped section) — it introduces a new `## Resolved` subsection using that same
  annotation format, which is the cleaner fix per engineer design review (also closing the
  pre-existing #2 inconsistency rather than leaving it to drift further). Note: this
  reorganization is not backed by a requirement/scenario in the `audit-logging-operations`
  spec delta — it's proposal-committed bookkeeping (closing out already-resolved issues, not
  new product behavior). Acceptance is task-level only: new `## Resolved` subsection present,
  correct annotation format, `#4`–`#7` left intact in `## Open Issues`, and its intro line
  still accurate.

## 4. Verification

- [x] 4.1 Confirm no application or runtime behavior changed: `git diff` touches only
  `docs/deployment.md`, a comment-only addition in `audit-logger.ts`, and the `## Resolved`
  subsection reorganization in `openspec/specs/first-access/spec.md`.
- [x] 4.2 Confirm the runbook addition satisfies the `audit-logging-operations` spec
  scenarios: an operator reading `### Logging` alone can (a) name the at-risk events, (b)
  understand why the child-logger level override doesn't cover transport filtering, (c)
  know the precondition before adopting a filtering transport, and (d) find the Future
  Consideration note with its trigger condition and issue #3 reference.
- [x] 4.3 State the issue #3 disposition explicitly in the PR/change description: action 1
  (runbook) built, action 2 (revisit `audit-logger.ts`) captured as a trigger condition in
  the runbook and code comment, action 3 (startup check) deferred as a traceable Future
  Consideration — so the change can state "Closes #3."
- [x] 4.4 Confirm the code comment added in 2.1 satisfies the `audit-logging-operations`
  Requirement 3 scenario: it sits adjacent to the child-logger level override in
  `emitAuditEvent` (not just anywhere in the file), states that the override does not cover
  transport-level filtering, and points to the `### Logging` subsection of
  `docs/deployment.md` by name.
