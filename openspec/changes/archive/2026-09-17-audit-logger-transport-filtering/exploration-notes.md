# Exploration Notes: Audit Logger Transport-Level Filtering (GitHub issue #3)

Explored by Devon Calloway (Internal Champion), 2026-09-17.
Revised 2026-09-17 to address feedback from `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado).
Revised again 2026-09-17 (Ingrid Sollenberger, Solution Architect) to correct the at-risk event list per `design-review-security.md` (Tomás Ferreira) Finding 1 — see the "Second finding" section below.

## Review disposition

- **Priya's scope note (facilitator lens):** accepted and recorded explicitly below. This change is backend/ops documentation with no participant, facilitator, or EM ever seeing it — Priya's standing concerns (reveal integrity, pacing, outlier flagging) aren't implicated, and she deferred the real usability review to whoever represents the ops/deployment-operator reader. Noting this here rather than silently, per her request.
- **Priya's "make the consequence concrete" suggestion:** accepted — the drafted runbook section below names the specific log-only signals rather than saying "some events."
- **Marcus's three points (concrete runbook content, concrete/pinned code comment, explicit "Future consideration" disposition for action 3):** all accepted. Nothing here inflates scope beyond documentation-only — it's the same three actions, specified precisely enough to build and verify rather than improvise. Drafted content below is meant to be liftable into the proposal as-is.
- **Nothing rejected.** Both reviews stayed within the documentation-only scope Devon's original notes proposed; there was no push toward code changes, a startup check, or new infrastructure to push back on.

## Audience note (Priya's scope flag)

This change has no ritual-facing surface — no participant, facilitator, or EM interacts with it. The intended reader of everything produced here (the runbook section, the code comment) is an SRE/on-call engineer or deployment operator configuring the runtime logging environment. Facilitator-experience review doesn't apply to this change; usability review of the runbook language should be routed to whoever represents that ops audience, not to the facilitator-experience lens.

## What I checked

- `packages/backend/src/auth/audit-logger.ts` — the `emitAuditEvent` fix (child logger, `level = "info"`) and its extensive inline commentary on which events are DB-backed vs. log-only.
- `packages/backend/src/app.ts` and `packages/backend/src/config.ts` — how Fastify's logger is constructed.
- Grepped the whole backend for `transport`, `pino-`, `LOG_LEVEL` — no hits outside one unrelated comment.
- `docs/deployment.md` — current runbook content (env vars, Docker/K8s guidance). No logging section exists at all today.
- The source review this issue quotes: `openspec/changes/archive/2026-07-05-first-access/implementation-review-security.md`, Section 5 and the Follow-on Recommendations.
- `requirements/BRD.md` §10.3 (SEC-12 through SEC-16, audit logging requirements).

## Key finding: this is a hypothetical risk, not a live one

There is **no pino transport configured anywhere in this codebase today**. Fastify's `logger` option in `app.ts` sets only `serializers`; no `level`, no `transport`, no `LOG_LEVEL` env var exists in `config.ts` or `docs/deployment.md`. The issue is correctly framed as a *caveat about a future deployment configuration that does not exist yet* — not a bug in the current fix. The original security review said this explicitly and directly: "This edge case should be noted in the deployment runbook, not in code" (implementation-review-security.md, Section 5, Caveat). Devon reads issue #3 as operationalizing that exact sentence, not reopening the code fix.

## Second finding (corrected during design review): the "entire audit trail" framing in the issue was closer to correct than this exploration's first pass gave it credit for

**Correction, post security design review (`design-review-security.md`, Finding 1):** the paragraph below is Devon's original read and is **factually wrong** — it was independently re-verified against every `emitAuditEvent` and `INSERT INTO audit_log`/`writeAuditLogRow` call site in `packages/backend/src` during design review and corrected. 5 of the 8 events originally named here as "log-only" are actually DB-backed (`session.access_revoked_live`, `session.token_refresh_failed_live`, `session.connection_recovered`, `session.facilitator_connected`, `session.facilitator_disconnected` — each has an `INSERT INTO audit_log`/`writeAuditLogRow` call immediately before its `emitAuditEvent` call, in `connection-reauthorization.ts`, `connection-token-refresh.ts`, and `websocket-routes.ts` respectively), and the list omitted 15 events that are genuinely log-only, most importantly **every `auth.*` event and every `join.*` event** — the entire login/logout/session-creation/session-invalidation/token-refresh trail, none of which write any `audit_log` DB row anywhere in `routes/auth.ts`, `routes/join-links.ts`, or `auth/middleware.ts`. The corrected, independently re-verified total is **18 log-only events**, not 8 — see `design.md` Decision D3 for the full list and verification method.

This flips the scoping conclusion below: the issue's "entire audit trail" framing was not overstated — for the authentication and session-lifecycle trail specifically, it was accurate. That trail *is* the primary "who did what" audit record SEC-12–SEC-16 are protecting, and it has zero DB fallback. This does **not** change the documentation-only scope decision (D1 still stands — no transport is configured anywhere today, so the risk remains hypothetical), but it does change how the runbook needs to characterize the risk: as the primary audit record going dark, not a handful of anomaly-detection signals.

<details>
<summary>Original (incorrect) paragraph, kept for traceability of the mistake</summary>

Reading through the `AuditEventName` union and its comments, most security-relevant audit events (auth events, session lifecycle, role changes, rate-limit breaches, action item status changes) are written as an `audit_log` DB row **in the same transaction** as the state change — the DB row is repeatedly called out as "the authoritative audit record," with the pino `emitAuditEvent` call as "the operational alert path." Transport-level suppression would not touch the DB row for those events.

A smaller set of events are genuinely log-only, with no DB backing (called out in-file as deliberate, given call volume): `team.access_grant_mismatch`, `team.manager_association_rate_approaching`, `session.reveal_latency_observed`, `session.facilitator_connected/disconnected`, `session.access_revoked_live`, `session.token_refresh_failed_live`, `session.connection_recovered`. These are the ones actually at risk from transport filtering — mostly operational/anomaly-detection signals, not the primary "who did what" audit record SEC-12–SEC-16 are protecting.

This matters for scoping: the issue's Risk section ("the entire audit trail... stops being recorded") is the worst-case framing worth documenting, but the actual exposure is narrower than that sentence implies, which argues for a documentation-weight response rather than a code or infra response.

</details>

## Devon's read on proportionality

This is an internal ops/security concern, not a ritual-facing feature — no participant, facilitator, or EM ever sees it. Weighed against the persona's standing concerns (don't over-build for the sake of building, effort should match risk, don't let the tool become more prominent/complex than the ritual needs), plus the project's general instruction against designing for hypothetical requirements:

- **Required action 1 (runbook documentation)**: clearly worth doing now. Cheap, closes the actual gap (nothing currently documents log-level/transport guidance at all), and matches what the original reviewer already called for. Placement: a new `### Logging` subsection under `## Running the Application` in `docs/deployment.md`, as the last subsection there (after `### Health check`, before `## Kubernetes`, line ~147 today) — that's where operational/runtime guidance already lives (env vars, health checks), and it's the natural home for a future `LOG_LEVEL` env var too. No `Observability` heading exists in the doc today, so this isn't a subsection of one.
- **Required action 2 (revisit audit-logger.ts if transport filtering is ever adopted)**: correctly framed as conditional/future — no code change now, since no transport config exists. Stated as an explicit trigger condition in the runbook draft below, and pinned as a specific code comment in `audit-logger.ts` (also drafted below) so it's discoverable by whoever adds transport filtering later, rather than something only Devon remembers.
- **Required action 3 (startup check that verifies the audit trail is reachable)**: this is the one to scope down. Building a startup health check against a failure mode that requires a configuration that doesn't exist in this codebase is exactly the kind of premature engineering effort that's disproportionate to current risk — it's solving for a deployment topology nobody has built. This is recorded as an explicit "Future consideration" in the runbook draft below (not built now), with its own trigger condition and a reference back to issue #3, so the deferral is traceable in the shipped doc rather than living only in these exploration notes.

## Drafted runbook content (`docs/deployment.md`, new `### Logging` subsection)

This is meant to be liftable into the proposal directly, not re-derived at implementation time:

> ### Logging
>
> Audit events are emitted via `emitAuditEvent` (`packages/backend/src/auth/audit-logger.ts`) at the `info` level, with the child logger's level explicitly overridden so application-wide log-level changes (e.g. raising Fastify's logger to `warn`) cannot suppress them. **This override does not protect against transport-level filtering.** If you configure a pino transport (a log shipper, a `pino-*` destination, anything set via `transport` in Fastify's `logger` option) that applies its own level filter below `info`, audit events will be silently dropped downstream of this logger, with no indication in the application that anything was lost.
>
> Many audit events also write an `audit_log` database row in the same transaction as the state change — that row is the authoritative audit record and is unaffected by log transport configuration (role changes, rate-limit breaches, action-item status changes, EM data-access reads, admin reads, and most session/WebSocket-lifecycle events all fall in this category). **Every `auth.*` event and every `join.*` event does not** — this is the entire login, logout, session-creation, session-invalidation, and token-refresh trail, and it is **log-only with no database backing anywhere in this codebase**. Four additional events are also log-only. In total, 18 events are at risk if a filtering transport is introduced:
>
> - Every `auth.*` event: `auth.authorization_initiated`, `auth.callback_received`, `auth.success`, `auth.failure`, `auth.first_access_created`, `auth.session_created`, `auth.session_invalidated`, `auth.token_refresh_success`, `auth.token_refresh_failure`, `auth.idp_logout_failed`, `auth.role_claim_mapped`
> - Every `join.*` event: `join.link_created`, `join.link_redeemed`, `join.link_rejected`
> - `team.access_grant_mismatch`
> - `team.manager_association_rate_approaching`
> - `team.manager_association_rate_limit_check_failed`
> - `session.reveal_latency_observed`
>
> This means a filtering transport puts the application's primary "who logged in, when, and whether their session ended" record at risk, with no database fallback — not only a handful of lower-severity operational/anomaly-detection signals.
>
> **Before adopting any pino transport with a level filter:** revisit `emitAuditEvent` in `audit-logger.ts` — the child-logger level override protects against the application log level only, and the transport will need its own accommodation (e.g. a level floor on the transport config, or routing audit events to an unfiltered destination) to keep the events above from going dark.
>
> **Future consideration (deferred, GitHub issue #3):** a startup check that verifies audit events actually reach their configured sink was requested in issue #3 but is not built in this change, because no transport is configured anywhere in this codebase today — building a reachability check against a failure mode that doesn't yet exist would be premature engineering. This is not a nice-to-have to revisit "if" the `emitAuditEvent` rework above happens to get to it: given the events above, a filtering transport shipped without this check risks silently losing the authentication and session-lifecycle audit trail with zero indication anything was lost. Build this check alongside the `emitAuditEvent` rework, before that transport goes to production.

**Suggested acceptance condition** (Marcus's framing): a reader who is about to configure a pino transport with a level filter can, from the Logging section alone, (a) identify which audit events are log-only and therefore at risk — and recognize that this includes the entire `auth.*`/`join.*` trail, not just a handful of anomaly signals, (b) understand why child-logger level overrides in `emitAuditEvent` don't protect against transport-level filtering, and (c) know what to do before adopting such a transport.

## Drafted code comment (`packages/backend/src/auth/audit-logger.ts`)

Pinned location: immediately after the existing "Fix: explicitly set the child logger's level..." paragraph, before `const auditLogger = logger.child({ audit: true });` (currently the line right before that declaration in `emitAuditEvent`) — consistent with the file's existing house style of dense, precise inline commentary rather than a bare one-liner.

> ```
> // This override protects against application-level log-level changes only.
> // It does NOT protect against a pino transport configured with its own
> // level filter (e.g., a shipper that drops below 'warn') — transport-level
> // filtering happens downstream of this logger and is invisible here. See
> // "Logging" in docs/deployment.md for the events at risk and what to check
> // before adopting a filtering transport.
> ```

## Issue #3 disposition

Issue #3 requested three actions. This change disposes of all three, not just the one it builds:

1. Runbook documentation — built (drafted above).
2. Revisit `audit-logger.ts` if transport filtering is adopted — not built now (no transport exists to revisit for), but captured as an explicit, discoverable trigger condition in both the runbook and the code comment.
3. Startup reachability check — not built now, explicitly deferred as a "Future consideration" in the runbook draft above, with its own trigger condition and a direct reference to issue #3.

Because all three actions are accounted for (one built, two explicitly dispositioned with trigger conditions rather than silently dropped), issue #3 can close with this change. The PR/change description should state plainly: "Closes #3 — action 3 (startup reachability check) deferred; see docs/deployment.md § Logging, 'Future consideration'" so the deferral is traceable from the issue itself, not just from this exploration doc.

## Recommendation

Scope this as a **documentation-only change**: add the `### Logging` subsection drafted above to `docs/deployment.md`, plus the drafted forward-pointer comment in `audit-logger.ts`. No application code changes. Action 3 is recorded as an explicit, traceable "Future consideration" in the same doc section rather than built now.

Net effect: closes the actual gap (nothing is documented today), matches the original reviewer's own stated remedy, gives an implementer concrete content to ship rather than a topic to improvise, and doesn't spend engineering effort building infrastructure for a deployment configuration that doesn't exist — consistent with keeping this project's operational footprint proportional to real risk.
