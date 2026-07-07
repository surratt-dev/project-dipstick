# Security Review: Enforce Access Control on Team Content

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-07
**Documents reviewed:** `design.md`, `proposal.md`
**Scope:** Authentication flows, data access boundaries, audit logging, threat model impact. Focused on six specific design questions raised during review assignment.

---

## Summary

The design establishes meaningful enforcement infrastructure. Decision 8's role-qualified grant object, Decision 6's no-cache mandate, and Decision 5's delivery-time revocation requirement are all well-reasoned, and I support their inclusion. I am flagging six specific findings below — two blocking, four advisory. The blocking findings require design resolution before implementation begins; the advisory findings should be resolved or explicitly accepted before the change reaches production.

---

## Finding 1 (Blocking): Decision 5 — Event buffering window is not addressed

**The gap.** The revocation criterion states that no content-access events are delivered after `team_memberships.removed_at` is committed to the database. This criterion is correctly framed. What the design does not address is the architecture-level behavior between event generation and wire-level delivery.

Real-time systems that use pub/sub intermediaries — Redis pub/sub is the most common pattern for this stack type — operate in two stages: events are published to a channel when something happens, and subscribers receive them when the intermediary delivers them. If a membership removal is committed and then the delivery-time check runs, the check correctly gates delivery for that user. But if an event is published to the channel *before* the membership is removed and is still in flight through the intermediary, it can arrive at the delivery layer after the removal is committed. Whether the delivery-time check is evaluated at the moment of wire-level push or at the moment of dequeue from the intermediary determines whether this event is blocked.

The design's revocation criterion implies that the check must occur at the moment of client push — the moment before bytes leave the server for that specific connection. If the implementation evaluates the check when the event is taken off the pub/sub channel (earlier in the pipeline), there is a window in which in-flight events still reach the removed subscriber.

**What needs to be explicit.** The design should state that the delivery-time authorization check is evaluated at the point of per-connection message dispatch — not at subscription time, not at channel publication time, and not at queue-dequeue time. "Delivery time" must be defined as the moment immediately before the message is pushed to the wire for a specific connection. Any buffered or in-flight events that have not yet reached that point must be checked, not passed through.

**Why this is blocking.** Without this clarification, the implementation team may satisfy the stated criterion — delivery-time checks are present — while still delivering in-flight events from a buffered stage. An engineer testing the revocation behavior will see a brief window in which removed users receive events. That is the exact failure mode the design is trying to prevent.

---

## Finding 2 (Blocking): Decision 7 — Timing oracle is deferred without a blocking prerequisite

**The gap.** The design correctly identifies the timing oracle: unauthorized requests that return before the database is queried for resource content may complete measurably faster than authorized requests that complete the full data fetch. It proposes a synthetic delay and classifies this as "a known limitation to mitigate at implementation time — not a blocking concern." The open question assigns co-ownership to me (Q-timing-oracle). I am responding here.

This is a blocking concern, and I am not accepting its classification as advisory.

The timing oracle is an existence inference path, exactly what Decision 7 is designed to close. A caller who wants to determine whether a team or session ID exists — despite receiving identical 403 responses — can observe the response time distribution across many requests. An unauthorized request for a resource that does not exist (no database query) will return faster than an unauthorized request for a resource that does exist (the authorization check finds the team, denies access, returns). If the variance is consistent, the attacker can distinguish the two cases statistically. They do not need a single definitive measurement; they need enough samples to separate the distributions.

The design's proposed synthetic delay calibrated to average authorized-request latency is insufficient. Average latency conceals variance. A constant floor value — chosen to be no lower than the 99th percentile of authorized-request latency — is more robust. This requires measuring the latency distribution of authorized requests under realistic database load, not just the average.

**What needs to happen.** The Q-timing-oracle open question must be converted to a blocking prerequisite with the same structure as the WebSocket latency bound prerequisite: a named owner, a required artifact (timing measurement results and the selected floor value), and a "required before" gate. The gate should be: before the first team content endpoint is deployed to production, not after the authorization helper is built.

The prerequisite should require the implementation team to: (a) measure the latency distribution of authorized requests to the highest-latency content endpoint, (b) select a constant floor value equal to the 95th or 99th percentile of that distribution, and (c) implement the synthetic delay as a constant minimum, not a calibration to the mean.

**An additional timing gap.** The design addresses timing for HTTP endpoints but not for WebSocket event delivery. If a removed subscriber can observe a change in event delivery frequency (events stop arriving) with measurable timing correlation to the membership removal, this is a separate, lesser timing channel — but one that may confirm to the subscriber that their membership was revoked at a specific moment. This does not require the same treatment as the existence-inference timing oracle, but it should be noted in the threat model.

---

## Finding 3 (Advisory): Decision 6 — Three named layers do not cover all caching surfaces in a typical deployment

**The gap.** The cache prohibition names three layers: HTTP response cache (via `Cache-Control: no-store`), ORM/query cache, and application-session cache. These three layers are under the direct control of the application. They do not include:

- **CDN caching.** If a CDN is in the deployment path, `Cache-Control: no-store` propagates in the response headers, but CDN-specific configuration can override or ignore this. A misconfigured CDN origin rule that caches `200` responses for a fixed TTL will serve a cached session data response to a different user without the application knowing. The design should either confirm that no CDN is in the deployment path, or state that CDN bypass configuration (origin rules, cache behavior overrides) is a required deployment control that must be verified before production.

- **Reverse proxy caching.** If an nginx, HAProxy, or similar reverse proxy sits between the CDN and the application, it may have its own cache configuration. This is a less common risk for internal applications but is not zero — nginx's `proxy_cache` directive is easy to enable and easy to misconfigure.

- **Browser service worker caches.** A service worker registered by the application can intercept network requests and serve responses from a cache that is independent of HTTP cache headers. If the application uses a service worker for any purpose (offline support, push notification handling), that service worker's fetch handler must explicitly pass through to the network for authorization-sensitive endpoints and must not cache their responses. `Cache-Control: no-store` does not prevent a service worker from caching a response; the service worker's logic must opt out explicitly.

**What needs to happen.** The cache prohibition should be extended to explicitly name each of these layers, either as "in scope and controlled by X" or as "out of scope because confirmed not in deployment path." A blanket statement that the three named layers cover all caching is not accurate for a realistic deployment. If this application is ever fronted by a CDN as it scales, the current spec will not flag CDN caching as a gap — it was never in scope.

---

## Finding 4 (Advisory): Decision 2 — Failed admin access attempts to session content are not logged

**The gap.** Decision 2 requires logging of admin reads and writes of administrative data. It does not require logging of admin attempts to access session content — which Option B blocks unconditionally. If an admin makes repeated requests to session content endpoints and receives 403 responses, those requests leave no trace in the current design's audit model.

This matters because the surveillance gap Option B is designed to close — an admin who systematically examines session content — is only partially closed by the access boundary. An admin who probes the API to understand what session data is available, and what the error responses reveal about session state, is conducting reconnaissance. The access boundary prevents them from seeing the data. The audit log, as currently specified, does not record that the probing occurred.

**The specific concern.** An admin attempting to access `/teams/:id/sessions/:sessionId/votes` and receiving a 403 should appear in the audit log. Not because they saw anything — they did not — but because the pattern of such attempts is security-relevant. An admin who probes twenty teams' session endpoints in sequence after hours has engaged in behavior that warrants review, even if every request was blocked.

**What needs to happen.** The audit logging requirement for Application Admins should include: any admin request to a session content endpoint, regardless of whether it is permitted or denied, must be logged with the standard audit fields plus the HTTP status code of the response. This is a read operation on the admin's side (they are reading the API surface), and it should be treated the same as any other security-relevant admin read.

This is distinct from general access logging (which every HTTP request might produce). The audit log entry here is specifically for admin identity exercising the admin access path against any endpoint, permitted or denied.

---

## Finding 5 (Advisory): `facilitator_access_expires_at` — No administrative revocation path within the application

**The gap.** The 30-minute grace window is set server-side at session close and the design correctly states it is not updatable by the facilitator or any client call. The design also notes that an admin who updates the column directly would appear in the audit log. This means the only mechanism to shorten or revoke the grace window is a direct database write — a support escalation, not a self-service action.

**The threat model this leaves open.** If a facilitator's account is compromised in the 30-minute window after a session ends — or if there is a post-session discovery that a specific facilitator should not retain access to that team's data — there is no in-application path to revoke the grace window immediately. The access expires naturally. The correct behavior (no access) eventually occurs, but not on demand.

This is a narrow window and the risk is bounded by the 30-minute duration. I am not treating this as blocking. But I have two specific concerns that should be explicitly accepted or resolved:

1. **The grace window is inviolable from within the application.** This should be a stated design decision, not an implicit consequence of the column being server-set. If an incident requires immediate post-session revocation of a specific facilitator, the documented path is a database write with audit trail — not an admin UI action. That escalation path should be named somewhere in the operational runbook, even if not in this spec.

2. **The terminology matters.** The design uses "revocation" to describe what happens when `facilitator_access_expires_at` passes. This is expiry, not revocation. Revocation implies an active decision to end access; expiry implies access ends when time runs out. The distinction matters when documenting the incident response posture: "we can revoke access" implies an immediate action is available; "access expires in X minutes" is the accurate statement. I recommend the design use "expiry" consistently rather than "revocation" when referring to this mechanism, to avoid overstating the immediacy of the response.

---

## Finding 6 (Advisory): Decision 9 — Two-layer serializer enforcement creates a behavioral contract the type system cannot enforce

**The gap.** Decision 9 is correct: both the authorization layer and the serializer layer are required, and neither is sufficient alone. The risk section of Decision 8 points to the shared TypeScript grant type as the primary mitigation for divergence. This is only partial.

The TypeScript type system can enforce the shape and presence of fields in the grant object. It cannot enforce the behavioral logic inside the serializer. A developer who receives a grant with `path: 'facilitator'` and `sessionStatus: 'active'` has satisfied the type contract. Nothing in the type system prevents them from writing serializer logic that includes vote values for any facilitator grant, regardless of topic reveal status — that code is type-correct and will compile.

The behavioral contract the design requires — "a facilitator on an unrevealed topic receives no vote values, regardless of their authorization path" — cannot be enforced by a type. It can only be enforced by tests that exercise the specific scenario.

**What needs to happen.** The acceptance criteria for Decision 9 must include named integration test cases, not just a type check. Specifically:

- Facilitator on an unrevealed topic: vote values are absent from the response body. Test must fail if the serializer's reveal check is removed or the condition is changed.
- Facilitator on a revealed topic: full vote attribution is present. Test must fail if the serializer blocks attribution on revealed topics.
- These two test cases must be in the same test suite as the authorization layer tests, not in a separate UI or end-to-end suite, so they run as part of the authorization layer's acceptance gate.

The additional divergence risk I want to name: Decision 9 describes these as "two enforcement points" and says "both enforcement points are required; neither is sufficient alone." If that is the design intent, then a test that passes when one enforcement point is removed (and the other correctly blocks) should still fail — because the design says we require both. The tests should verify that removing either layer causes a failure, not just that the combined system produces the correct output.

---

## Authentication Flow and Threat Model Notes (Non-Blocking)

**On the overall authorization architecture.** The decision to return a role-qualified grant rather than a boolean (Decision 8) is the right call. Collapsing access decisions to a boolean and re-querying role downstream is a pattern I have seen produce divergent behavior in three separate applications. The grant object as the shared contract between authorization and serialization is correct.

**On the `draft` session status.** The 24-hour automatic expiry for draft sessions requires a background task. Background tasks that modify authorization-sensitive state (in this case, the `draft` status that grants a facilitator historical access) must be treated as security-sensitive code. The expiry task must not be disableable via configuration in production. If the task fails silently — because the job runner is down, or the task throws an unhandled exception — draft sessions persist beyond their 24-hour window and grant continued facilitator access. The background task's failure mode must be designed toward expiry, not toward continuation: if the expiry task cannot run, it is preferable to treat draft sessions as expired after 24 hours by the SQL check, rather than to allow them to persist by exception.

The SQL check for facilitator access already handles this correctly for `facilitator_access_expires_at` (a NULL check fails, not grants). If the draft session status is not cleaned up by the background task, the session remains in `draft` status and the SQL check continues to grant access. The background task is therefore not merely operational hygiene — it is a security control. It should be monitored and alerted on failure with the same priority as any other security control.

**On the absence of an OIDC re-validation review here.** This design focuses on authorization (content access), not authentication (OIDC integration). That is appropriate scope. However, the note in the persona context stands: the authorization helper in this design queries `users.global_role` from the database, which was set at first access from IdP claims. If a user's IdP role changes after their account is created, the database record may not reflect it. This is not a gap in this design (updating global_role on re-authentication is out of scope here), but it is a gap in the overall system that I will carry into the OIDC integration review.

---

## Findings Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Decision 5: Event buffering window not addressed — delivery-time check must be at wire-level push, not at queue-dequeue | Blocking | Requires design update before Group 8 begins |
| 2 | Decision 7: Timing oracle classified as advisory, not blocking — must be a named prerequisite with measurable acceptance criterion before any endpoint goes to production | Blocking | Convert Q-timing-oracle to blocking prerequisite |
| 3 | Decision 6: CDN, reverse proxy, and browser service worker caches not named in cache prohibition | Advisory | Resolve or explicitly accept before production |
| 4 | Decision 2: Failed admin access attempts to session content are not logged | Advisory | Resolve or explicitly accept before production |
| 5 | `facilitator_access_expires_at`: No in-application administrative revocation path; terminology "revocation" overstates immediacy | Advisory | Document as explicit design acceptance |
| 6 | Decision 9: Pre-reveal behavioral contract is not type-enforceable; named integration tests required to prevent serializer divergence | Advisory | Add named test cases to acceptance criteria |

Items 1 and 2 must be resolved before the implementation groups that depend on them (Group 5 WebSocket integration for Finding 1; any content endpoint in production for Finding 2). Items 3–6 must be resolved or explicitly accepted before the change is marked complete.

I will review the authorization helper implementation directly before it is integrated into any endpoint.
