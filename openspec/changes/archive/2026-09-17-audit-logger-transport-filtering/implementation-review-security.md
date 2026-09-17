# Implementation Review — Security Analyst (Tomás Ferreira)

## Scope

Final gate on the corrected "at-risk log-only events" list from design revision (originally 5 false
positives, 14 missing, including all `auth.*`/`join.*`). Verified the list as it actually landed in
`docs/deployment.md`, independently, against code — not against the design doc's own claim.

## Method

1. Enumerated all 41 members of `AuditEventName` in `packages/backend/src/auth/audit-logger.ts`.
2. Found every `emitAuditEvent(...)` call site across `packages/backend/src` (41 call sites, one per
   event name, some events called from multiple sites).
3. Found every `INSERT INTO audit_log` call site across `packages/backend/src` and matched each to the
   `operation` value it writes.
4. Classified each of the 41 events as DB-backed (a same-transaction `audit_log` row exists somewhere)
   or log-only (no `INSERT INTO audit_log` anywhere writes that operation string), from the code alone.

## Result

23 DB-backed + 18 log-only = 41, matching the full `AuditEventName` union exactly. The 18 log-only events
match `docs/deployment.md`'s list bullet-for-bullet:

- All 11 `auth.*` events (confirmed: no `INSERT INTO audit_log` anywhere in `auth.ts`, `middleware.ts`)
- All 3 `join.*` events (confirmed: no `INSERT INTO audit_log` anywhere in `join-links.ts`)
- `team.access_grant_mismatch` (confirmed log-only in `team-content-access-helper.ts`)
- `team.manager_association_rate_approaching` (confirmed log-only in `teams.ts`)
- `team.manager_association_rate_limit_check_failed` (confirmed log-only in `teams.ts`)
- `session.reveal_latency_observed` (confirmed log-only in `sessions.ts`)

Two cases worth flagging as correctly handled, since they're the easiest to get wrong by pattern-matching
alone rather than reading code:

- `team.manager_association_rate_limit_exceeded` is correctly *excluded* from the at-risk list even though
  its DB row is written under a deliberately different operation string
  (`team.manager_association_rate_limited`, `teams.ts:1131`) — the doc's framing ("row is the authoritative
  record... unaffected by transport config") holds regardless of the string mismatch.
- `session.facilitator_connected`/`session.facilitator_disconnected` are correctly excluded — both get a
  same-transaction row via `websocket-routes.ts:254`, which is easy to miss since it's a WebSocket
  lifecycle path rather than an HTTP route.

No false positives, no missing events, no arithmetic errors in the "11 + 3 + 4 = 18" breakdown.

## Comment review (`audit-logger.ts`)

The added comment is technically accurate: pino child loggers own their level independently once set, so
overriding `auditLogger.level` does bypass application-wide level changes — and that override is a
logger-level control, invisible to a downstream pino `transport` that applies its own filter. This
matches actual pino transport semantics (transports run in a separate worker thread/destination and are
not otherwise aware of the emitting logger's specific level).

Diff is comment-only: the seven added lines sit between the existing comment block and the unchanged
`const auditLogger = logger.child(...)` / `auditLogger.level = "info"` / `.info({...})` lines. No
executable line was added, removed, or reordered. Zero runtime/behavioral change, confirmed by direct
reading of the diff.

## Verdict

**Approved.** The corrected 18-event list landed accurately in `docs/deployment.md` — independently
re-verified against `AuditEventName` and every `emitAuditEvent`/`INSERT INTO audit_log` call site in
`packages/backend/src`, not just re-checked against the design doc's claim. No discrepancies found. The
`audit-logger.ts` comment addition is technically correct and behaviorally inert.
