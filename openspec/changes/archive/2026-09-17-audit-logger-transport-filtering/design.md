## Context

The `emitAuditEvent` fix (archived under `2026-07-05-first-access`) sets `level = "info"` on
a child logger so audit events survive application-wide log-level changes. The security
review that approved that fix flagged, as an explicit caveat rather than a blocking issue,
that this protection stops at the application boundary: a pino **transport** configured with
its own level filter sits downstream of the logger and can drop audit events silently, with
nothing in the application aware it happened. The reviewer's own remedy was documentation,
not code ("This edge case should be noted in the deployment runbook, not in code"). GitHub
issue #3 asks for three things: (1) runbook documentation of the gap, (2) a revisit of
`emitAuditEvent` if transport filtering is ever adopted, (3) a startup check that verifies
audit events reach their configured sink.

Today, no pino transport is configured anywhere in this codebase — confirmed by grepping the
backend for `transport`, `pino-`, and `LOG_LEVEL`. `docs/deployment.md` has no logging
guidance of any kind yet.

## Goals / Non-Goals

**Goals:**
- Close the documentation gap the original security review called for, precisely enough that
  an operator configuring a pino transport can act on it without re-deriving the analysis.
- Make the caveat discoverable from the code itself, not only from the runbook.
- Dispose of all three actions requested in issue #3 — including the two not being built now
  — with an explicit, traceable rationale, so the issue can close cleanly.

**Non-Goals:**
- No change to `emitAuditEvent`'s logic, the audit event set, or Fastify's logger
  construction in `app.ts`/`config.ts`.
- No startup-reachability check (issue #3, action 3) built now — no transport exists yet to
  make such a check meaningful against.
- No new logging infrastructure, env var, or config surface (e.g. no `LOG_LEVEL` variable
  introduced — the doc references one only as a plausible future example).

## Decisions

**D1 — Documentation-only scope, no code behavior change.** The actual risk today is
hypothetical: no transport is configured, so nothing is currently being dropped. Building
code or infrastructure against a configuration that doesn't exist would be premature
engineering disproportionate to current risk. Alternative considered: add a defensive
runtime check now (e.g. warn if a transport is detected at startup) — rejected because there
is no transport-detection surface to check against yet, and it would be speculative code with
no way to exercise it.

**D2 — Placement: new `### Logging` subsection under `## Running the Application` in
`docs/deployment.md`, as the last subsection there (after `### Health check`, before
`## Kubernetes`).** This is where existing operational/runtime guidance already lives (env
vars, health checks), and it is the natural home for a future `LOG_LEVEL` env var too.
Alternative considered: a new top-level `## Observability` section — rejected because no such
section exists today and creating one for a single subsection would be over-structuring a
small addition.

**D3 — Name the at-risk log-only events by category, then enumerate them individually,
rather than describing the risk generically.** Most audit events also write an `audit_log`
DB row in the same transaction as the state change (the authoritative record, unaffected by
transport filtering); a larger set than an earlier draft of this document assessed does not:
every `auth.*` event (11 — `auth.authorization_initiated`, `auth.callback_received`,
`auth.success`, `auth.failure`, `auth.first_access_created`, `auth.session_created`,
`auth.session_invalidated`, `auth.token_refresh_success`, `auth.token_refresh_failure`,
`auth.idp_logout_failed`, `auth.role_claim_mapped`), every `join.*` event (3 —
`join.link_created`, `join.link_redeemed`, `join.link_rejected`), and 4 others
(`team.access_grant_mismatch`, `team.manager_association_rate_approaching`,
`team.manager_association_rate_limit_check_failed`, `session.reveal_latency_observed`) — **18
events total.**

This corrects the design's earlier draft, which named 8 events, 5 of which
(`session.access_revoked_live`, `session.token_refresh_failed_live`,
`session.connection_recovered`, `session.facilitator_connected`,
`session.facilitator_disconnected`) are actually DB-backed (verified against `INSERT INTO
audit_log` / `writeAuditLogRow` call sites in `connection-reauthorization.ts`,
`connection-token-refresh.ts`, and `websocket-routes.ts`), and which omitted the entire
`auth.*` and `join.*` categories along with `team.manager_association_rate_limit_check_failed`.
The corrected list above was independently re-verified against every `AuditEventName` member's
`emitAuditEvent` call site and every `INSERT INTO audit_log` / `writeAuditLogRow` call site in
`packages/backend/src` as of this revision, not transcribed from the security review that
flagged the error (see `design-review-security.md`, Finding 1) — that review's own prose states
"17 events," but its own enumeration lists 18 (3 correct originals + 15 additions); this
document uses the independently re-verified figure of 18.

Grouping by category (all of `auth.*`, all of `join.*`) rather than only hand-enumerating
individual names makes the composition legible on its own: these are the application's entire
authentication and session-lifecycle trail, not a handful of anomaly-detection signals, and
that composition needs to be obvious from the framing, not just derivable from a flat list.
Naming the events individually, in addition to the category framing, still lets a reader
confirm exact scope. This list is a snapshot as of this change; it is not enforced or
generated, so it can drift if new log-only audit events are added later without a
corresponding doc update (see Risks, and Finding 3 of the security review).

**D4 — Code comment placement: immediately after the existing "Fix: explicitly set the child
logger's level..." comment in `audit-logger.ts`, before the `auditLogger` child-logger
declaration.** Matches the file's existing house style of dense inline commentary at the
point of relevance, and sits exactly where a future implementer touching this function to add
transport-awareness would already be reading.

**D5 — Action 3 (startup reachability check) recorded as an explicit "Future consideration"
inside the `### Logging` subsection, not as a separate tracking issue or a TODO comment, with
its trigger condition stated as non-negotiable rather than conditional.** Keeping the deferral
in the same doc section that describes the risk it responds to keeps the trigger condition next
to the context needed to act on it. The trigger condition itself is: build this check before
any transport that could touch `info`-level events at all ships to production — not framed as
"if" the `emitAuditEvent` rework happens to get to it. Given D3's corrected scope, a dropped
`auth.failure` or `auth.session_invalidated` event is a materially worse blind spot than a
dropped anomaly signal, so the deferral note needs to read as a hard precondition, not a
nice-to-have (security review Finding 2). The change/PR description also states the deferral
plainly so it's traceable from GitHub issue #3 itself before the issue closes.

## Risks / Trade-offs

- **The log-only event list (D3) can silently go stale — and already proved unreliable once,
  before this document shipped.** If a future change adds a new log-only audit event and its
  author doesn't know this doc section exists, the list under-reports exposure. This isn't
  hypothetical: two independent readings of `audit-logger.ts`'s own inline comments (once
  during exploration, again when transcribing into this proposal) miscategorized 5 of 8 named
  events and missed 14 more, before the security review's design-review pass caught it. That
  the comments are ambiguous enough for this to happen twice, on the first attempt, is itself
  evidence the list needs more than "read the file carefully" as its maintenance process.
  Mitigation: none built into this change (would require code-level enforcement, which is out
  of scope per D1); the code comment (D4) is the best available discoverability hook for
  someone editing `audit-logger.ts`, but doesn't cover an event added elsewhere that happens to
  be log-only by omission. Recorded as a named follow-up, not built now: a lint rule or test
  asserting every `AuditEventName` member without a corresponding `INSERT INTO audit_log` /
  `writeAuditLogRow` reference is enumerated in this doc (security review Finding 3) — real
  code/tooling work, disproportionate to this documentation-only change's scope, but worth
  tracking as its own future issue rather than silently repeating this failure mode the next
  time an event is added.
- **Deferring action 3 relies on the "Future consideration" note actually being read before a
  transport is adopted.** Mitigation: the note is placed directly in the runbook section an
  operator would consult when configuring logging, not in a separate document, and the code
  comment (D4) cross-references it.
- **Documentation can drift from code without any build-time signal.** Ordinary risk for any
  runbook; no different here. Not mitigated further, consistent with keeping this change
  proportional to the (currently hypothetical) risk it addresses.

## Migration Plan

Not applicable — no deployed behavior changes, no rollback surface. The doc and comment ship
in the same PR and take effect immediately on merge.
