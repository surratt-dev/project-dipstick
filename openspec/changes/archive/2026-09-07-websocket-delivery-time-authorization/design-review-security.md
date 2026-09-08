# Security Review — websocket-delivery-time-authorization

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-07
**Status:** Conditional — the authorization model is sound and correctly reuses the archived change's enforcement contract, but five findings below need a disposition before this reaches production. None of them require re-deriving the headline transport/fan-out decision; all are additive or corrective to what's already written.

Scope of this review, per my usual mandate: authentication flows, data access boundaries, audit logging, and threat-model impact of the real-time layer. I have not reviewed the ritual model, the client UX, or the concurrency/latency engineering (Decision D5/D6's skew budget) beyond where they touch a security property. I verified every finding below against the actual code in `packages/backend/src`, not against the design document's description of it — the same discipline this document itself insists on (the "Blocking Dependency" section, D7's schema correction), and the discipline I apply to every review.

---

## Finding 1 — Admin-grant rejection is correct as a security boundary, but it fully denies a dual-role user rather than serving them through their legitimate membership path

**What I checked:** `packages/backend/src/auth/team-content-access-helper.ts`, `evaluateTeamAccess(userId, teamId)`.

The function runs one query that fetches `users.global_role` and the caller's `team_memberships.role` for the target team **in the same row**. It then branches in strict priority order:

```
if (global_role === "application_admin") {
  return { path: "admin", actorGlobalRole: "application_admin" };   // <-- returns immediately
}
if (membership_role !== null) {
  return { path: "member", role: membership_role, ... };
}
```

Path 0 (admin) returns unconditionally on `global_role === 'application_admin'`, before `membership_role` — already sitting in memory from the same query — is ever inspected. A user who is both `application_admin` globally **and** holds a genuine, non-self-granted `team_memberships` row for the team in question receives only `{ path: 'admin' }`. Their legitimate membership grant is never surfaced, to this caller or to any endpoint that calls the helper.

For `topic_history_update`, the design (and the delta spec) require rejecting the `admin` path outright. Combined with the helper's precedence, the practical effect is: **a user who is a genuine team member and also happens to hold the `application_admin` global role receives zero WebSocket team-content events for their own team — not the reduced admin view, not the full member view, nothing.** The delta spec's own scenario text confirms this is intentional, not an oversight: *"this holds regardless of whether the Application Admin is also, separately, a team member or facilitator (the admin grant path is evaluated and rejected before any other path is considered for this subscriber)."*

**Assessment:** this is not a new decision introduced by this design — it's inherited verbatim from the archived change's Decision 2/Decision 8 (Option B), and it is applied identically at the HTTP layer today (an admin who is also a real team member gets 403 on session-content HTTP endpoints too, per the archived champion sign-off). So this design does not introduce a new inconsistency between HTTP and WebSocket — it correctly propagates an existing one. From a pure surveillance-prevention standpoint, blocking the union is the safer failure mode than trying to disambiguate "is this admin session legitimately also a member session" at delivery time, which would require carrying additional context through the grant that Decision 8 deliberately kept out of the helper's contract.

**What I want on record, not what I'm blocking on:** this is a real availability cost to a real, plausible person — someone who legitimately needs both the admin role (for administrative duties) and ordinary team membership (because they're also an individual contributor on a team) loses all live WebSocket content for their own team, with no differentiated error and, per the non-goals, no disclosure of why. The archived design's Risk register anticipated the *self-add* variant of this problem (an admin granting themselves access) but never explicitly named the *legitimately-dual-role* variant. I recommend design.md add one sentence acknowledging this is a known, accepted trade-off of Option B rather than leaving it discoverable only by reading the spec's scenario text closely, and that onboarding guidance (outside this change) flag that assigning `application_admin` to someone who also needs ordinary session access on a team they belong to will silently cost them that access. This is a documentation gap, not an enforcement gap — the code and spec do the secure thing.

---

## Finding 2 — D7's audit-logging metadata correctly excludes vote values, but the design verifies reveal/state-change logging while silently leaving vote-submission logging unverified and unaddressed

**What I checked:** Decision D7's metadata shape against BRD SEC-13/SEC-14/SEC-16, and `packages/backend/src/routes/sessions.ts`'s vote lock-in handler (`POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in`).

D7's metadata design (`{ session_id: sessionId, ... }`, mirroring `em-views.ts`'s `JSON.stringify({ session_id: sessionId })` precedent at line 380) is correct and consistent with SEC-16 ("audit log entries must not contain sensitive data values") and SEC-22 (vote data must not be written to logs absent a documented operational need). Nothing in D7's proposed `INSERT INTO audit_log` fields or `emitAuditEvent` payload carries a vote value. Good — this is the one place I went in expecting to find a problem (the archived precedent for this exact mistake is a live one, per D7's own corrected mechanism section) and didn't.

The gap is elsewhere. BRD SEC-13 names the required audit categories explicitly: *"vote events (submission, reveal)."* SEC-14 restates it for the WebSocket path specifically: *"Vote submissions, reveals, and session state changes over WebSocket must appear in the audit log with equivalent fields."* Both name **submission** in the same breath as **reveal** — they are not offered as alternatives.

D7, as written, adds audit logging for exactly two triggering actions: the reveal action and session-state-change actions. It does not add — or even discuss — audit logging for vote lock-in, which is the triggering action for `vote_readiness_update`, one of the four in-scope events this change wires up. I checked `packages/backend/src/routes/sessions.ts` directly: the lock-in handler inserts into `votes` (line ~296) and returns; there is no `audit_log` write and no `emitAuditEvent` call anywhere in that file. Vote submission is not currently audit-logged at all, at either the HTTP or the (forthcoming) WebSocket layer.

This matters because, per the design's own Blocking Dependency table, **vote lock-in is one of only two transitions (alongside lobby-advance/session-completion) that already commits today** — it is explicitly *not* blocked on GitHub issue #26. There is no reason this gap has to wait: it's buildable and testable right now, by the same reasoning the design applies to `vote_readiness_update`'s publish wiring itself.

**Recommendation:** design.md should apply the same "verify against actual code, don't assume" discipline it applied to reveal and session-state-change to vote lock-in, and extend D7 (or add a new decision) to add an `audit_log` row for vote submission — matching SEC-13/14's explicit naming of "submission" alongside "reveal," not narrowing SEC-14's scope to two of the three named event types. If the team decides vote-submission volume makes per-vote audit rows undesirable, that's a legitimate call, but it should be an explicit, argued exception to SEC-13/14 recorded in this document — not a silent gap that surfaces later as "the spec says submission, the code doesn't do it."

---

## Finding 3 — The Blocking Dependency disposition is fail-closed by construction, not fail-open; but the transition into issue #26 territory needs an explicit code-level guard, not only a documented one

I read the "Blocking Dependency" section, the Non-Goals, the Migration Plan step 4, and the Risks entry addressing this directly. The core claim — that stubbing the *trigger point* for testing does not create a live authorization bypass — checks out: for `vote_revealed` and `topic_history_update`, no Postgres commit exists today for reveal, topic-advance, or membership-removal, which means the publish call is never invoked in production for those paths. No event published means no delivery-time check runs and nothing is delivered — the system fails closed (nothing shipped) rather than open (something shipped unchecked). I don't have a correctness objection to how this document sequences the work.

What I want named, because the document already anticipates the failure mode in its Risks section but only mitigates it procedurally: *"An implementer treats the reveal, topic-advance, or membership-removal publish/audit wiring as a simple 'add a call after the existing commit' task, discovers mid-sprint that no such commit exists, and either invents one under time pressure or stalls."* The named mitigation is documentation (this section, the proposal's Out-of-Scope, tasks.md annotations). That's necessary but, on its own, is exactly the kind of control I don't trust to hold under deadline pressure — a developer two days from a demo who "invents one under time pressure" is not going to stop and re-read design.md first.

The archived change has a precedent for a *code-level* backstop against exactly this class of risk: `timing-oracle.ts`'s startup guard, which throws at application boot if `NODE_ENV === 'production'` and the placeholder timing floor is still in place. I recommend the same pattern here: when GitHub issue #26 is eventually implemented and the reveal/topic-advance publish calls are wired into real commits, that implementation should be required to pass through (or be reviewed against) the same authorization-helper-plus-serializer contract this change establishes, and ideally a lightweight assertion (unit test or startup check) should verify that any code path publishing `vote_revealed` or `topic_history_update` in production has a corresponding delivery-time `evaluateTeamAccess`/`evaluateSessionSubscriberAccess` call inline before the `.send()` — not merely trust code review to catch a regression to subscription-time caching (Decision D3 already names this exact drift risk and pairs it with an integration test; I'd extend that same instinct to the issue #26 handoff boundary specifically, since that's a second team, possibly a second sprint, picking up code they didn't design).

---

## Finding 4 — SEC-25/26 deferral leaves an unbounded idle-connection window even though a compensating control already exists in this codebase and isn't being reused

Decision D8 and the new spec requirement correctly scope SEC-25 (periodic re-authorization) and SEC-26 (token-expiry handling) to a companion effort, and I agree with not inventing a heartbeat mechanism under this change's time pressure — Decision D8's reasoning (delivery-time checks structurally cannot reach a connection receiving no events) is correct and I have no objection to deferring the *mechanism*.

What the design does not check, and should have, per the same "verify against actual code" discipline it applies elsewhere in this document: **`packages/backend/src/auth/middleware.ts` already implements the exact control SEC-26 names** — `ABSOLUTE_LIFETIME_MS = 90 * 60 * 1000`, enforced in the `onRequest` hook: if `Date.now() - sessionCreated > ABSOLUTE_LIFETIME_MS`, the session is destroyed and an audit event (`auth.session_invalidated`, `reason: "absolute_timeout"`) is written, regardless of whether the access token is still valid. This is precisely BRD SEC-26's requirement: *"The absolute maximum session lifetime of 90 minutes must be enforced even if a valid token is present."*

The problem: this hook fires on Fastify's HTTP request lifecycle. Per Decision D1, "the WebSocket upgrade handshake runs through the same `request.session` resolution every HTTP route already gets" — so this check *does* run once, at connection time, during the upgrade. It does **not** run again for the lifetime of an already-established WebSocket connection, because there is no subsequent HTTP request for it to hook into. A connection opened at minute 0 that receives events sparsely (or not at all, per Finding-adjacent SEC-25 scenario already named in the spec) can remain open indefinitely past the 90-minute absolute cap without anything in this design's own scope ever re-checking it. The spec's own "idle connection" scenario acknowledges the gap exists; it does not acknowledge that a partial, already-built compensating control sits one file away and simply isn't wired into the WebSocket connection lifecycle.

**Recommendation:** before this change is considered complete, wire the existing absolute-lifetime value into the WebSocket connection registry as a stated, minimal addition — not a new mechanism requiring SEC-25/26's full design. Concretely: capture `sessionCreatedAt` (already present on `request.session` at upgrade time) into the per-pod connection registry entry, and either (a) have the delivery-time check reject if `now - sessionCreatedAt > ABSOLUTE_LIFETIME_MS` — cheap, no new query, reuses a value already resolved at connect time — and/or (b) schedule a server-side force-close of the socket at the 90-minute mark, mirroring what `authMiddleware` already does for HTTP. This converts the residual risk statement from *"an idle or long-lived connection's authorization window is unbounded until SEC-25/26 ships"* to *"bounded to a maximum of 90 minutes, matching the same absolute cap already enforced everywhere else in the application"* — a materially different, and already partially-BRD-mandated, risk posture. This is a small addition to this change's scope, not a request to design the SEC-25 heartbeat here; I'd treat its absence as a gap in this document's own stated intent to close what it can close now (the same instinct that produced D7's audit-logging fix once the gap was found).

---

## Finding 5 — Redis pub/sub broadcasts the full event payload — including revealed vote values — to every pod before any authorization check runs; Redis hardening for this new sensitivity class is unaddressed

Decision D2's fan-out model is: every pod publishes to a single shared channel (`ws:events`); every pod's subscriber receives **every** message regardless of whether it holds any locally-relevant candidate connection, and only then performs the local-registry lookup and per-recipient authorization check. This is architecturally correct for solving the cross-pod delivery problem, and I have no objection to the design choice itself (it's inherited from the exploration stage and correctly implements "check at push time, not dequeue time").

The security-relevant consequence that isn't discussed: for `vote_revealed`, the JSON envelope published on `ws:events` carries "the full revealed vote distribution" (per the delta spec's own scenario text) to **every pod in the fleet**, unconditionally, before any per-recipient authorization decision is made. Today, `ioredis`/Redis in this codebase carries session-store data (`dipstick:session:` keys) — already sensitive, but opaque server-side session identifiers, not room-readable vote values in a broadcast channel. This change adds a new, higher-sensitivity payload class (actual revealed vote content, team/session identifiers) to the same Redis instance, and it does so as a broadcast primitive by design — the whole point of Decision D2 is that Redis doesn't know or care who's authorized, every pod gets the message and filters locally.

This is fine as long as Redis itself is treated as inside the trust boundary and hardened accordingly — but the design doesn't say that anywhere, and per my own foundational position (stated in my persona and worth restating here because it applies directly): **"internal" and "backend-only" are not risk exemptions.** A misconfigured Redis instance — no `requirepass`/ACL, reachable from a broader network segment than intended, or with `MONITOR`/slow-log capturing full command arguments — would let anyone who can reach it read every team's revealed vote distributions in real time, completely bypassing the delivery-time authorization this entire change exists to build. The authorization model this design builds governs the *last hop* (pod-to-socket); it says nothing about the hop that now also carries sensitive content (trigger-to-Redis-to-every-pod).

**Recommendation, scoped to what's missing rather than re-litigating the fan-out decision:**
1. Confirm and state explicitly (in this design or in deployment configuration it references) that the Redis instance requires authentication (`requirepass` or ACL) and is network-isolated to the backend pods — not reachable from outside the cluster/VPC.
2. Confirm whether Redis command logging (`MONITOR`, slow log with argument capture) is disabled in production, or if enabled, whether its output is treated as a `audit_log`-adjacent sensitive destination — SEC-22's "vote data must not be written to application logs" logic extends naturally to "vote data must not be written to Redis's own operational logs," and nothing in this document confirms that's been checked.
3. If Redis ever needs to cross a network boundary that isn't already fully trusted (e.g., a managed Redis service reached over a shared network), TLS in transit should be a named requirement, not an assumption.

None of this changes the transport or fan-out decision. It's the same category of finding as Finding 4: a real control that either already exists or is cheap to state explicitly, currently absent from the document's threat model.

---

## What I checked and have no finding on

- **`vote_revealed` reveal-gating (Decision D4):** reuse of `serializeForFacilitator`/`serializeForMemberParticipant` rather than parallel logic is the right call and directly extends the archived change's two-layer enforcement model (Decision 9) to the new transport. No new serializer logic to independently audit is the correct posture.
- **SEC-27 (revocation latency):** trivially satisfied by construction — the delivery-time check is evaluated at the moment of push, not on any interval, so there is no "defined interval" to miss.
- **SEC-28 (WebSocket handshake authentication):** correctly delegated to the existing `request.session` resolution at upgrade time; no new authentication mechanism is introduced, which is the secure-default pattern I look for (a framework/lifecycle hook doing the work, not a developer remembering to add a check).
- **Admin-denial audit logging under this change:** D7 doesn't name a `topic_history_update` admin-denial audit event the way the archived change logs denied admin HTTP attempts (`admin.session_content_denied`). Given the volume difference (an admin subscribed to a team's stream could be silently rejected on every single event indefinitely, vs. one HTTP request = one denial), I'd treat this as a minor open item worth a one-line decision (log once per subscription-rejection, not once per rejected push) rather than a finding — flagging it here so it isn't lost, not blocking on it.
- **Cache/TOCTOU concerns (Decision 6 lineage):** the design correctly inherits the no-cache rule from the archived change's Decision 6 and states it applies structurally to the new transport. I have no evidence it's being violated in anything written here.

---

## Summary disposition

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| 1 | Admin-grant rejection over-denies a legitimate dual-role user | Low (documentation/acknowledgment gap; enforcement is correct and intentional) | No — recommend one clarifying sentence in design.md |
| 2 | Vote-submission audit logging (SEC-13/14) unaddressed by D7 | Medium (named BRD requirement, not implemented, not discussed) | Yes — should be resolved before this change is considered complete, since it's buildable now (no issue #26 dependency) |
| 3 | Blocking-dependency handoff to issue #26 lacks a code-level guard | Low-Medium (documented mitigation exists; recommend hardening it) | No — recommend for issue #26's own scope, named here so it isn't lost |
| 4 | SEC-25/26 deferral leaves idle-connection window unbounded despite an existing compensating control | Medium-High (a cheap, already-built control isn't reused; residual risk is currently *unbounded* when it could be *bounded to 90 minutes* for near-zero cost) | Yes — recommend wiring `ABSOLUTE_LIFETIME_MS` into the WS connection lifecycle as part of this change |
| 5 | Redis pub/sub broadcasts unfiltered sensitive payloads to every pod; Redis hardening unaddressed | Medium (architecture is sound; trust boundary assumption is implicit, not stated or verified) | Yes — recommend explicit Redis AUTH/network-isolation/logging confirmation before production |

I'll revisit this once Findings 2 and 4 have a disposition — both are inexpensive relative to the risk they close, and both are consistent with work this document has already shown it's willing to do (D7's own reveal/state-change audit fix is the direct precedent for Finding 2; nothing about Finding 4 requires designing SEC-25's real mechanism, only reusing code that already exists). Findings 1, 3, and 5 I'm comfortable carrying forward as named, tracked items rather than blockers, provided they're actually recorded somewhere durable — my persistent complaint about deferred security items is never that they're deferred, it's that deferral becomes indistinguishable from being forgotten.

— Tomás Ferreira
