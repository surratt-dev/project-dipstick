# Q6 Decision: Rate Limiting Threshold for TEAM-006

**Resolves:** design.md Q6 ("Required before Phase 2: Rate limiting threshold for TEAM-006")
**Unblocks:** tasks.md task 3.10
**Co-signed by:** Marcus Delgado (Business Analyst) and Tomás Ferreira (Senior Application Security Analyst), per Q6's joint ownership
**Status:** RESOLVED — ready for implementation
**Traceability:** GitHub issue #13

This document is the final, agreed resolution of Q6. It supersedes the four working documents that produced it (`q6-rate-limit-proposal-ba.md`, `q6-rate-limit-proposal-security.md`, `q6-rate-limit-reconciliation-ba.md`, `q6-rate-limit-reconciliation-security.md`), which are retained for traceability but should not be read as the current decision where they conflict with this document.

---

## 1. Thresholds

All limits are enforced server-side against `POST /api/v1/teams/:teamId/managers`, keyed on the caller's authenticated identity (`session.userId`, the same identity already used for the Application Admin authorization check), **not** source IP — an internal admin-only endpoint behind shared corporate NAT egress makes IP the wrong trust boundary, and the threat model's attacker is a compromised credential, which IP-based limiting does not constrain.

| Limit | Threshold | Window | Scope | Purpose |
|---|---|---|---|---|
| Per-actor burst | **20 requests** | rolling 10 minutes (sliding window) | per `actor_user_id` | Bounds how fast a single credential — legitimate or compromised — can act; guarantees an early audited signal in an active attack |
| Per-actor sustained | **100 requests** | rolling 24 hours (sliding window) | per `actor_user_id` | Hard ceiling on same-day blast radius per credential; closes the gap where an attacker paces just under the burst threshold indefinitely |
| Global secondary | **100 requests** | rolling 10 minutes (sliding window) | all Application Admin actors combined | Defense-in-depth against multiple admin credentials compromised close together (e.g. an IdP-side incident); sized at 5x the per-actor burst threshold so it does not fire on ordinary multi-admin traffic |

No `teamId` or target-`engineeringManagerUserId` dimension: TEAM-006 is idempotent per `(user, team)` (Decision 3), so repeat calls against the same pair gain an attacker nothing, and the attacker controls the request body's target, so a target-scoped limit is trivially routed around by spreading grants across targets. The actor-scoped limits already bound every variant of "spread the grants around."

All three limits use a true sliding window (e.g. a Redis sorted-set timestamp log), not a fixed calendar bucket — a fixed window lets an attacker double their effective rate by straddling a boundary, which matters when the thresholds are deliberately tight.

**Implementation:** Redis-backed (the existing shared `ioredis` client in `packages/backend/src/redis.ts`), not in-process memory — an in-process counter silently under-enforces the moment the backend runs more than one instance. A small, purpose-built limiter for this one endpoint, not a new `@fastify/rate-limit` dependency — this is a single high-value route with an exact, reviewed threshold, not a general cross-cutting policy.

**Enforcement placement in the handler:** immediately after the Application Admin authorization check and before the team-existence / global-role-precondition queries, so unauthorized callers don't consume rate-limit budget and rate-limited callers don't generate unnecessary DB load.

## 2. Early-warning signals (non-blocking)

At 80% of each per-actor threshold, emit a structured, non-blocking log event (the request still succeeds normally):

- **Burst approach:** fires the first time an actor reaches 16 of 20 requests within a rolling 10-minute window. Event: `team.manager_association_rate_approaching` (metadata: `window: "burst"`).
- **Daily approach:** fires the first time an actor reaches 80 of 100 requests within a rolling 24-hour window. Event: `team.manager_association_rate_approaching` (metadata: `window: "daily"`).

These exist so a patient attacker pacing just under the hard ceiling still produces a detectable pattern, ahead of the harder daily-cap tripwire, once admin-account monitoring (threat-model.md Finding 2.3, currently unbuilt) exists to consume it. Task 3.10 is scoped to emitting these events correctly, not to building the monitoring/alerting pipeline itself — that is Finding 2.3's separate, already-tracked scope.

## 3. Behavior on breach

**HTTP 429 Too Many Requests** for every limit type (burst, daily, global). Never a silent failure, never an account lockout, never a CAPTCHA.

- **`Retry-After` header**, in seconds, reflecting the specific window that was breached.
- **Response body**, using the endpoint's existing error envelope shape, with a distinct machine-readable `code` per limit type and a message that gives the caller (a) that this is a rate limit, not a bug, (b) when they can resume, and (c) an escalation path if their legitimate need genuinely exceeds the limit:

```json
{
  "error": {
    "category": "rate_limited",
    "code": "TEAM006_BURST_LIMIT_EXCEEDED",
    "message": "You've reached the limit of 20 manager-association requests per 10 minutes. Wait a few minutes and try again. If you're onboarding a large number of teams at once, contact [security/support channel] about a scoped, time-limited increase.",
    "correlationId": "..."
  }
}
```

Error codes: `TEAM006_BURST_LIMIT_EXCEEDED`, `TEAM006_DAILY_LIMIT_EXCEEDED`, `TEAM006_GLOBAL_LIMIT_EXCEEDED` — each with equivalent wording pointing at the relevant reset and the same escalation path.

**Every breach writes a durable `audit_log` row**, synchronously and reliably, before the 429 is returned: `actor_user_id`, `actor_ip`, `team_id` (the team named in the rejected request), `operation = 'team.manager_association_rate_limited'`, and `metadata` recording which limit was breached and the observed count. This does not need Decision 9's in-transaction atomicity (there is no `team_memberships` write for it to be atomic with), but it must not be fire-and-forget.

**A distinct structured event** — `team.manager_association_rate_limit_exceeded` — is also emitted (added to the `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts`), tagged as security-relevant, separate from routine per-request audit entries, so it is ready for Finding 2.3's eventual monitoring/alerting work without a second pass through this endpoint.

**No account lockout or suspension on breach.** A rate-limit breach and a suspected-compromise determination are different signals with different evidentiary weight — conflating them would punish legitimate heavy usage (a real rollout) exactly as hard as an actual attack, and would train admins to treat 429s as something to route around rather than report. Suspected-compromise lockout remains a separate, richer-signal-driven decision (anomalous IP, impossible travel, IdP-side alerts), out of scope for this control.

## 4. Escape hatch for legitimate large rollouts

The daily cap (100/24hr) is not raised by default to accommodate a large one-time rollout (e.g., initial onboarding of an organization with more than ~100 teams). Instead:

- A time-boxed increase to the **daily cap only** (the burst and global windows are not adjustable via this path) may be granted for a specific admin account for a bounded period.
- **The approval step must go through a channel independent of the requesting admin's own session or credential**, with a named human approver distinct from the requesting admin — e.g. a ticket opened and approved by a second person, not an in-app self-service toggle and not an email thread reachable via the same account's own inbox access. An escape hatch reachable using only the credential the threat model already assumes might be compromised is not an escape hatch, it is a bypass with extra paperwork.
- The increase is itself written to `audit_log` (who requested it, who approved it, what temporary value was granted, when it expires).
- It expires automatically and reverts to the default 20/10-min and 100/24-hr thresholds with no manual restoration step required.

Tomás (Security Analyst) owns the specific operational mechanism for the approval channel; the properties above are the requirement the mechanism must satisfy.

## 5. What this resolves and what it doesn't

- **Resolves Q6** with specific, buildable numbers, jointly agreed by BA and security analyst as design.md required.
- **Unblocks task 3.10.**
- **Does not relitigate Decision 6** (undated historical access from association date is unchanged; this control bounds how many associations a compromised credential can create, not what any single association exposes).
- **Does not close threat-model.md Finding 1.3** (the `evaluateTeamAccess`/TEAM-005 bypass that never calls TEAM-006 at all — tracked separately as GitHub issue #109). A TEAM-006 rate limit has no effect on a path that never calls TEAM-006.
- **Does not close threat-model.md Finding 2.3** (EM/admin account monitoring does not exist yet). This decision's early-warning and breach events are instrumented so that future monitoring work has well-formed signals to consume, but building that monitoring is out of scope here.
- **Non-blocking recommendation carried forward, not adopted:** a global 24-hour aggregate cap (all admins combined), as a companion to the global 10-minute limit, scoped as follow-up work whenever Finding 2.3 is addressed. Not required to close Q6.

## 6. Acceptance criteria for task 3.10

- 21st call from the same actor within a rolling 10-minute window → `429`, `TEAM006_BURST_LIMIT_EXCEEDED`, `Retry-After` header.
- 101st call from the same actor within a rolling 24-hour window → `429`, `TEAM006_DAILY_LIMIT_EXCEEDED`, `Retry-After` header.
- 101st call across all actors combined within a rolling 10-minute window → `429`, `TEAM006_GLOBAL_LIMIT_EXCEEDED`, distinct from the per-actor codes.
- 16th call from an actor within a 10-minute window emits `team.manager_association_rate_approaching` (`window: "burst"`) without rejecting the request.
- 80th call from an actor within a 24-hour window emits `team.manager_association_rate_approaching` (`window: "daily"`) without rejecting the request.
- A test asserting calls from a different actor are unaffected by another actor's per-actor and daily-cap state, but are counted toward the shared global-limit state.
- A 429 on any of the three limits writes the corresponding `audit_log` row and `team.manager_association_rate_limit_exceeded` structured event, and does not write a `team_memberships` row.
- Limits reset correctly at each window's boundary (per-actor 10-min, global 10-min, per-actor 24-hr) under sliding-window semantics, not fixed-bucket resets.
