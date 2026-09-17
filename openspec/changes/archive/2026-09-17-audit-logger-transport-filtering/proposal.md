## Why

GitHub issue #3 flags a caveat the security review already called out when it approved the
`emitAuditEvent` fix (`openspec/changes/archive/2026-07-05-first-access/implementation-review-security.md`,
Section 5): the fix makes audit events immune to application-wide log-level changes by
explicitly overriding the child logger's level, but it does nothing to protect against a
future pino **transport** configured with its own level filter. The reviewer's own stated
remedy was documentation ("This edge case should be noted in the deployment runbook, not in
code"), and that documentation has never been written — `docs/deployment.md` today has no
`Logging` section at all, and `packages/backend/src/auth/audit-logger.ts` has no comment
pointing a future implementer at the gap.

This is worth closing now, not because the risk is live — there is no pino transport
configured anywhere in this codebase today, confirmed by grep across the backend for
`transport`, `pino-`, and `LOG_LEVEL` — but because the gap is cheap to close and the
alternative is relying on institutional memory (this exploration, the original review
comment) to resurface at the moment someone actually configures a transport, which is
exactly the kind of dependency on one person's memory this project has been working to
design out of its processes.

## What Changes

- Add a new `### Logging` subsection to `docs/deployment.md`, as the last subsection under
  `## Running the Application` (after `### Health check`, before `## Kubernetes`). It
  documents: that `emitAuditEvent` sets `level = "info"` on a child logger specifically so
  application-wide log-level changes can't suppress audit events; that this protection does
  **not** extend to transport-level filtering; which events are log-only with no database
  backing and therefore actually at risk — **every `auth.*` event and every `join.*` event
  (the entire authentication and session-lifecycle trail: `auth.authorization_initiated`,
  `auth.callback_received`, `auth.success`, `auth.failure`, `auth.first_access_created`,
  `auth.session_created`, `auth.session_invalidated`, `auth.token_refresh_success`,
  `auth.token_refresh_failure`, `auth.idp_logout_failed`, `auth.role_claim_mapped`,
  `join.link_created`, `join.link_redeemed`, `join.link_rejected`), plus
  `team.access_grant_mismatch`, `team.manager_association_rate_approaching`,
  `team.manager_association_rate_limit_check_failed`, and `session.reveal_latency_observed` —
  18 events total, independently verified against every `emitAuditEvent` and
  `INSERT INTO audit_log` call site in `packages/backend/src`; and what to do before adopting
  any pino transport with a level filter (revisit `emitAuditEvent`).
- Add a forward-pointing code comment in `packages/backend/src/auth/audit-logger.ts`,
  immediately after the existing "Fix: explicitly set the child logger's level..." comment
  and before the `auditLogger` child-logger declaration, so a future implementer adding
  transport filtering encounters the caveat in the code, not only in the runbook.
- Record the startup-reachability check requested in issue #3 as an explicit **Future
  consideration** in the same `### Logging` subsection: not built now, because no transport
  exists to make it verifiable against, but named with its own trigger condition (build it
  alongside the `emitAuditEvent` rework, before any filtering transport ships to production)
  and a direct reference back to issue #3 — so the deferral is traceable from the shipped
  documentation, not left to live only in exploration notes.
- Add a `## Resolved` subsection to `openspec/specs/first-access/spec.md`, after `## Open
  Issues`, and move both `#3` (closed by this change) and `#2` (already closed by the merged
  `oidc-error-log-sanitization` change, but never marked as such — an existing inconsistency
  this proposal also cleans up) into it, each annotated `closed (change-name)`, matching the
  format `## Known Limitations` already uses for its one closed entry. `## Open Issues` keeps
  only genuinely open items (`#4`–`#7`) so its "remain active" framing stays accurate. No
  precedent for in-place "closed" annotations exists in `## Open Issues` itself (see
  engineer design review), so this introduces one cleanly in its own subsection rather than
  presenting a closed item as if the list format already supported it.
- No application or runtime behavior changes. `emitAuditEvent`'s logic, the events it emits,
  and Fastify's logger construction in `app.ts`/`config.ts` are unmodified.

## Capabilities

### New Capabilities

- `audit-logging-operations`: operational/documentation obligations for audit logging that
  exist independent of application code — specifically, that the deployment runbook
  accurately documents the transport-level-filtering gap in `emitAuditEvent`'s log-level
  protection, names the audit events actually at risk, and states the required
  precondition before adopting a filtering transport. This is a new capability rather than a
  modification to `first-access` because it governs the deployment runbook, not
  `emitAuditEvent`'s behavior — `first-access`'s existing "Audit log level independence"
  property (that the child logger's level is pinned to `"info"`) is unchanged by this
  proposal, and its own Open Issues list still names issue #3 as active until this change
  moves it to the new Resolved subsection.

### Modified Capabilities

(none — this change does not alter the behavior of `emitAuditEvent`, its child-logger-level
override, or any other existing requirement. It adds documentation of an existing, unchanged
limitation.)

## Impact

- `docs/deployment.md` — new `### Logging` subsection (content drafted in
  `exploration-notes.md`, ready to lift as-is).
- `packages/backend/src/auth/audit-logger.ts` — one new inline comment; no logic change.
- `openspec/specs/first-access/spec.md` — new `## Resolved` subsection; `#3` and `#2` moved
  there from `## Open Issues` and marked closed.
- Closes GitHub issue #3: action 1 (runbook documentation) is built by this change; action 2
  (revisit `audit-logger.ts` if transport filtering is adopted) is captured as a discoverable
  trigger condition in both the runbook and the code comment; action 3 (startup reachability
  check) is deferred and recorded as a traceable "Future consideration," not silently
  dropped. The change/PR description states this disposition explicitly so the deferral is
  visible from the issue itself.
- No dependency, API, schema, or infrastructure changes.
