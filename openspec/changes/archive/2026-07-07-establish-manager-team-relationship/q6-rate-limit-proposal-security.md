# Q6 Resolution: Rate Limiting Threshold for TEAM-006

**Author:** Tomás Ferreira, Senior Application Security Analyst
**Status:** Proposed resolution for design.md Q6 / tasks.md task 3.10
**Scope:** `POST /api/v1/teams/:teamId/managers` (TEAM-006) only
**Relationship to prior work:** This resolves Q6 as named in design.md's Risks section and Open Questions, and closes the compensating-control gap identified in `threat-model.md` (Finding 3.10, rated Medium-High, "Gap requiring action") and referenced again in Scenario 4's blast-radius quantification. I am not revisiting Decision 6 (undated historical access) — that is an accepted organizational risk and stays out of scope here. I am specifying the one control the design doc's own risk register named but left unspecified: the number.

---

## 1. The threshold

**Per-actor limit: 10 requests per rolling 10-minute window, keyed on `actor_user_id` (the Application Admin's authenticated identity), enforced with a sliding window — not a fixed calendar window.**

**Secondary global limit: 50 requests per rolling 10-minute window, aggregated across all Application Admin actors combined.**

### Why per-actor, and why this actor identifier specifically

The threat model's threat actor is a *compromised Application Admin credential* — not an anonymous or unauthenticated caller. Every TEAM-006 request the endpoint receives already carries a resolved `session.userId`, and the handler already does a live per-request DB read of that user's `global_role` before anything else happens (`teams.ts`, lines ~646-655). The rate-limit key must be that same server-resolved identity, not the request's source IP.

I want to be explicit about why IP is the wrong key, because it's the easy mistake to make here: this is an internal application behind normal corporate networking, so multiple legitimate Application Admins can share a NAT'd egress IP, and a single compromised credential can be replayed from any IP the attacker controls — a stolen session cookie used from a residential proxy defeats IP-based limiting trivially and punishes innocent coworkers on the same IP in the process. Keying on the authenticated actor identity is the only version of this control that actually targets the threat model's own attacker.

### Why 10 per 10 minutes, and not looser or tighter

I worked this from both directions — what a realistic attacker can do, and what a legitimate admin actually needs — because a threshold that only satisfies one of those is either theater or a support ticket generator.

**Attacker capability, unconstrained:** TEAM-006 is a same-origin authenticated POST with no CAPTCHA, no client-side friction, and (correctly, per the design) no meaningful validation delay beyond the DB round-trips already in the handler. A scripted client replaying a stolen session cookie can issue these sequentially in well under a second each, or in parallel across a handful of connections. Without a rate limit, an attacker with 10 minutes of undetected access before the 90-minute absolute session lifetime forces re-authentication (`middleware.ts`, `ABSOLUTE_LIFETIME_MS`) could plausibly associate an EM to every team in a mid-size organization's team list — Scenario 4 in the threat model makes exactly this point, that there is currently no technical bound on how fast the blast radius in Decision 6's accepted risk gets multiplied across teams. A threshold of, say, 100 or 500 per hour does not change that outcome in any way that matters — it still lets an attacker clear the team list of any organization this application is plausibly sized for before the rate limit is ever the binding constraint. That is the "security theater" failure mode: a control that is technically present and practically irrelevant to the threat it's named against.

**Legitimate admin need, honestly assessed:** TEAM-006 is not a bulk-provisioning workflow. It is an Application Admin associating one specific Engineering Manager to one specific team, typically at the point a team is stood up or an EM changes role — not a batch operation run across dozens of teams in a single sitting. The one legitimate burst scenario I can construct is a director-level EM being associated to every team in their reporting line in one admin session during onboarding or a reorg. Even a generous version of that scenario — a new EM taking over 8-10 teams at once — fits comfortably inside a 10-per-10-minute window with room to spare. If that scenario turns out to be more common in practice than I'm assuming, the fix is a documented bulk-admin exception path with its own audit trail, not a loosened blanket threshold that also benefits the attacker.

**The number itself:** 10 per 10 minutes bounds a single compromised admin credential to at most 10 newly-exposed teams before the caller starts receiving 429s — and, per section 3 below, before that rejection itself becomes an audited, alertable event rather than a silent wall. It does not eliminate the accepted Decision 6 risk (an attacker who is patient, or who has a session that survives longer than 10 minutes of activity, can still work through additional 10-request windows) — no rate limit makes an accepted per-team risk into a zero risk. What it does is convert "unlimited teams, limited only by script speed" into "at most 10 teams per 10 minutes, and every window after the first produces a security signal" — which is the actual job a compensating control has here.

### Why a sliding window and not a fixed calendar window

A fixed 10-minute window (e.g., aligned to :00/:10/:20) has the standard boundary problem: an attacker can issue 10 requests at 09:59 and 10 more at 10:01, getting 20 associations in two minutes while never exceeding the stated "10 per window" limit in either individual window. Given that the threshold is deliberately tight, that boundary-doubling defeats a meaningful fraction of what the limit is supposed to buy. Implement this as a true sliding window (a Redis sorted-set timestamp log, or an equivalent sliding-window-counter algorithm) — not the naive fixed-bucket-with-a-timer version.

### Why a global secondary limit, and why it's looser

The primary per-actor limit is the control that maps directly to the named threat (one compromised admin credential). The 50-per-10-minutes global aggregate across all admins is defense-in-depth for a scenario the primary limit doesn't cover on its own: multiple Application Admin accounts compromised close together in time — plausible if the compromise vector is something upstream of any individual admin's own security hygiene (an IdP-side incident, a compromised shared workstation image, a phished admin distribution list). It is set higher than the per-actor limit specifically so it never fires on legitimate traffic under normal multi-admin operation — five admins each legitimately near their own per-actor ceiling in the same window is an unusual but not alarming pattern, and the global limit is sized to tolerate it. If the global limit does fire, that is itself notable — it means multiple admin identities are hitting this endpoint hard at the same time — and it should be logged and alerted with that framing, distinctly from a single-actor rate-limit event (see section 3).

### Why no target-team or target-user dimension

I considered whether the limit also needs to be scoped by `teamId` or by the target `engineeringManagerUserId`, and concluded neither adds protection the actor-scoped limit doesn't already provide:

- **Per-target-team** doesn't fit the operation's semantics — TEAM-006 is idempotent per `(user, team)` pair (Decision 3), so an attacker doesn't gain anything by calling it repeatedly against the same team; the attack is about breadth across *many* teams, which the per-actor limit already bounds directly.
- **Per-target-EM-user** is the closer call, since the specific scenario in the threat model is one EM's reach being expanded across many teams by a compromised admin. But the attacker controls which target user they name in the request body — an attacker who anticipated a per-target cap would simply spread the grants across multiple EM accounts (or a second, less-legitimate-looking EM account they also control) to route around it. Because the limiting actor in every version of this attack is the same compromised admin identity issuing the requests, the per-actor limit already catches every variant of "spread the grants around to avoid a narrower cap." A target dimension would add enforcement complexity without closing a gap the actor-scoped limit leaves open.

---

## 2. Where and how to enforce it

**State store: Redis, not in-process memory.** `ioredis` is already a backend dependency (`packages/backend/src/redis.ts` exports a shared client). A rate limiter backed by in-process memory is a secure-default failure of exactly the kind I flag in every review: it works correctly in local dev and single-instance deployments, and it silently stops enforcing the actual limit the moment the backend runs more than one instance, because each instance keeps its own count. This endpoint's whole threat model is about bounding an attacker's *aggregate* request volume — a limiter that only sees the requests that happened to land on one instance is not enforcing the number in section 1, it's enforcing that number multiplied by however many instances happen to be running. Whatever implementation is chosen must share state through Redis (or an equivalent shared store) so the limit holds cluster-wide.

**Implementation choice — narrow purpose-built limiter over a new dependency.** There is no `@fastify/rate-limit` dependency in this codebase today, and I would not add one for this. `@fastify/rate-limit` is the right tool when an application needs a general, cross-cutting rate-limiting policy applied broadly across routes; that is not this problem. TEAM-006 is a single, specific, high-value endpoint with a threshold that needs to be exactly right, not a default applied uniformly. A small, purpose-built Redis `INCR`/sorted-set helper — a few dozen lines, directly reviewable, with a unit test that pins the exact boundary behavior — is both simpler to get right and easier for the next person (or me, in the pre-production review) to verify against the number in section 1. If the team independently wants `@fastify/rate-limit` for other reasons later, its Redis store adapter is compatible with this approach and TEAM-006's config can be migrated onto it without changing the underlying threshold decision this document makes. What I would object to is enforcing this endpoint's limit only through a plugin default without a specific, reviewed configuration for this route — a generic default is exactly the kind of control that looks present in a dependency list and isn't actually doing the job.

**Where in the handler:** The rate-limit check belongs immediately after the Application Admin authorization check (so unauthorized callers get a clean 403 and don't consume rate-limit budget that should be reserved for legitimate admins) and before the team-existence and global-role-precondition queries (so a rate-limited caller doesn't cause unnecessary DB load on every rejected attempt). Concretely: authorization check → rate-limit check → team lookup → precondition check → transactional upsert.

---

## 3. Behavior on exceeding the threshold

**HTTP response:** `429 Too Many Requests`, with a `Retry-After` header giving the caller a concrete wait time, and a response body consistent with this codebase's existing error envelope shape:

```json
{
  "error": {
    "category": "rate_limited",
    "code": "TEAM_006_RATE_LIMIT_EXCEEDED",
    "message": "Too many Engineering Manager association requests. Please wait before retrying.",
    "correlationId": "..."
  }
}
```

**This must not be treated as an ordinary request denial.** A 403 (wrong role) or a 409 (precondition not met) is a normal, expected outcome of routine admin work and doesn't need special handling beyond what already exists. A rate-limit rejection on *this specific endpoint* is different in kind: by construction, it only fires when a single identity has already established EM access to several teams in a short window, which is precisely the pattern the threat model names as the early signature of a compromised admin account being used for bulk abuse. Treating that the same as a routine 403 — logged generically and otherwise ignored — throws away the one signal this control produces at the exact moment it produces it.

Concretely, when the limit is exceeded:

1. **Write a distinct `audit_log` entry** with `operation = 'team.manager_association_rate_limited'`, `actor_user_id`, `actor_ip`, `team_id` (the team named in the rejected request), and `metadata` containing the request count observed in the current window and which limit was breached (per-actor vs. global). This does not need the same in-transaction atomicity guarantee Decision 9 requires for the TEAM-006 write itself — no `team_memberships` row is being written on this path, so there's nothing for it to be atomic with — but it must be written synchronously and reliably before the 429 is returned, not fire-and-forget.
2. **Emit a structured log event distinct from the routine per-request audit trail** — add `"team.manager_association_rate_limit_exceeded"` to the `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts` (alongside the existing `team.manager_established` / `team.role_changed` pattern) and emit it via `emitAuditEvent`, tagged at a severity level that distinguishes it from routine operational logging — this event should be treated as security-relevant, not merely informational, wherever logs are consumed downstream.

I'm calling out a real gap the threat model already surfaced (Finding 2.3): nothing in this codebase currently *consumes* `audit_log` or the `em.*`/`team.*` structured events to raise an alert — the audit substrate is solid, but there is no monitoring on top of it. Adding a rate-limit-exceeded event to that same unconsumed stream produces a forensic record, which is necessary, but it is not yet a detection. I am recording it as its own event, correctly tagged, specifically so that whoever eventually closes the Finding 2.3 monitoring gap has a well-formed, severity-appropriate event to alert on without needing a second pass through this endpoint's logging. Until that monitoring exists, a rate-limit-exceeded event on TEAM-006 should be added to whatever manual admin-activity review process exists as a "look at this" item — it should not be allowed to sit in a log stream nobody reads, which is the exact failure pattern I called out for EM account monitoring in the threat model.

---

## 4. Compensating control: alert on approach, not only on breach

A hard 429 wall, on its own, has a blind spot: an attacker who paces requests just under the per-actor threshold (e.g., 9 requests every 10 minutes, indefinitely) never trips the limit at all, and produces no rate-limit event to look at. That pacing is slower than an unconstrained attacker would prefer, which is already a partial win, but it is a win with no accompanying visibility.

I want a second, lower-severity signal at **80% of the per-actor threshold within a window (8 of 10 requests)** — not a rejection, the request still succeeds normally, but a distinct log event (e.g., `"team.manager_association_rate_approaching"`) fires the first time an actor crosses that line in a given window. This is cheap to compute (the same sliding-window counter already being maintained for enforcement) and gives whoever eventually staffs the monitoring gap from Finding 2.3 an earlier, softer signal than "the wall was hit" — which matters because "the wall was hit" is also consistent with a legitimate admin having a busier-than-usual but perfectly innocent day, while "consistently sitting at 8-9 out of 10 across multiple consecutive windows" is a harder pattern to explain away as coincidence and a better candidate for a human to actually look at.

I am not asking for this to be built as a full alerting pipeline as part of task 3.10 — that is the same unresolved scope as Finding 2.3's EM-monitoring gap, and I'd rather see it addressed once, deliberately, for both admin-side and EM-side access monitoring, than bolted on twice. What I want out of task 3.10 specifically is that the *event exists and is emitted correctly* so that whichever team eventually builds that monitoring has both signals — breach and approach — already instrumented and doesn't have to come back to this endpoint a third time.

---

## 5. Summary of the resolution

| Dimension | Decision |
|---|---|
| Per-actor threshold | 10 requests / rolling 10-minute sliding window, keyed on `actor_user_id` |
| Global secondary threshold | 50 requests / rolling 10-minute sliding window, all admins combined |
| Target-team / target-user dimension | Not needed — actor-scoped limit already bounds every variant of the named attack |
| State store | Redis (`ioredis`, already a dependency) — must be shared across instances, not in-process |
| Implementation approach | Purpose-built limiter for this one endpoint, not a new general-purpose dependency |
| On breach | `429` with `Retry-After`; distinct `audit_log` row (`team.manager_association_rate_limited`); distinct alertable structured log event, separate from routine request logging |
| Compensating control | Second, lower-severity event at 80% of the per-actor threshold within a window, to enable early detection once admin-account monitoring (Finding 2.3) is built |

This resolves Q6 and unblocks tasks.md task 3.10. It does not resolve, and does not attempt to resolve, threat-model.md Finding 1.3 (the `evaluateTeamAccess` / TEAM-005 authorization gap) or Finding 2.3 (EM account monitoring does not exist) — both remain open items on the Phase 2 production-deployment gate per my recommendation in threat-model.md, independent of this rate-limit threshold.
