## Context

Five changes have built the data model this layer must query: Sign In established the user record and `global_role`; First Access assigned `global_role = 'engineering_manager'` from IdP claims; Join a Team created `team_memberships` rows with `role = 'participant'`; Assign a Role introduced `team_memberships.role = 'engineering_manager'` for users whose team role differs from their global role; Establish Manager/Team Relationship created EM associations and the `audit_log` table. What has not been built is the enforcement layer that reads all of this correctly on every content request.

The existing enforcement points are point-in-time: the session-participation spec governs who can join a session; the manager-team-association spec governs what EMs can do when the relationship is established. Neither governs what happens when an authenticated user requests team content outside those specific flows. Every content endpoint — session history, trend data, action items, topic configuration, live session state — currently has no shared authorization contract.

The ritual's psychological safety guarantee depends on this layer not having gaps. One engineer discovering a bypass — a direct API call that returns vote history without checking team membership, a WebSocket subscription that does not revoke when membership is removed — ends the ritual's credibility. The threat is not external attackers. It is an engineer who, reasonably, tests whether the tool actually does what it says it does.

**Stakeholders:** Devon Calloway (ritual integrity, access model design), Marcus Delgado (requirements, access matrix confirmation), Rachel Okonkwo (VP Engineering, Application Admin boundary decision), Tomás Ferreira (security, WebSocket authorization mechanism), Priya Nair (facilitator workflow, pre-session and post-session access), Ingrid Sollenberger (ADR-007, architecture enforcement).

---

## Goals / Non-Goals

**Goals:**
- Establish a single reusable server-side authorization helper that every content endpoint calls, returning a role-qualified access grant (not a boolean).
- Enforce the content type access matrix at the serializer layer, producing distinct response shapes for each role, independent of the authorization check.
- Add delivery-time authorization to the four named WebSocket content-access events, with zero-latency revocation on membership removal.
- Implement ADR-007's facilitator session-scoped access model with a `draft` pre-session status and a 30-minute post-session grace window.
- Close the Application Admin surveillance gap: admins access team administrative data only, with audit logging.
- Establish consistent 403/404 behavior across all team content endpoints as a system-wide rule.

**Non-Goals:**
- Authentication — handled at sign-in, not here.
- Privileged facilitator actions (reveal trigger, topic advance, session close) — covered by the session state machine, not this change. Those are action authorization checks; this change covers content access checks.
- Session creation authorization — covered by the facilitator-from-another-team constraint in the session-participation spec.
- Notification of membership revocation to the affected user — out of scope.
- Removal of EM/team relationships — separate use case.

---

## Decisions

### Decision 1: New shared authorization infrastructure, not an audit

**Choice:** This change builds new enforcement infrastructure — a shared authorization helper and serializer contracts — rather than auditing what prior changes happened to implement.

**Rationale:** The prior changes built individual enforcement points scoped to specific operations (session join, EM association). They did not build a general-purpose authorization layer for content reads. Building one now ensures that all future content endpoints inherit correct enforcement by calling the helper rather than implementing their own check. An audit-only scope would leave every current content endpoint without a shared contract and produce an unauditable patchwork.

**Alternative considered:** Audit-and-document (identify gaps in existing enforcement, produce a spec, defer new infrastructure). Rejected because it produces a description of the problem, not a solution, and leaves every future endpoint author responsible for independently re-deriving the authorization model.

---

### Decision 2: Application Admin access boundary — Option B (administrative data only)

**Choice:** Application Admins have access to team administrative data (membership lists, role assignments, EM associations, topic configuration metadata) but not session content (votes, scores, readiness state, trend data, action items, discussion notes). This is ADR-aligned: BRD Constraint 1 names the three roles authorized for session data (team member, associated EM, active facilitator); Application Admin is not in that list.

**Affirmative scope of admin access:**
- Team metadata: team name, creation date, active/archived status
- Team membership lists: user IDs, display names, assigned roles, join date, active/removed status
- Role assignments: current `membership_role` for each member
- Engineering Manager associations: which EM is linked to which team
- Topic configuration: topic names and descriptions, team-level customizations (no session data attached)

**Rationale:** A blanket admin grant to session content creates an organization-wide surveillance path. An admin who self-adds to a team gains session content access for that team; the audit log catches the membership change but the content access occurs regardless. Option B prevents this by keeping session content outside the admin's scope unconditionally.

**Audit logging under Option B:** Because admins do not access session content, the conditional audit requirement ("if admins access session content, log it") never triggers. However, admin reads and writes of administrative data (membership records, role assignments, EM associations) must be logged in the `audit_log` table with the same fields as EM content access events: `timestamp`, `actor_user_id`, `actor_global_role`, `actor_ip`, `action`, `resource_type`, `resource_id`. An admin who adds themselves to a team — gaining indirect access to session content — must be detectable from the audit trail before the content access occurs.

**Audit logging of denied admin access to session content:** Any Application Admin request to a session content endpoint — regardless of whether it is permitted or denied — must be logged in the `audit_log` table with the standard audit fields plus the HTTP status code of the response. Access to session content is unconditionally denied for admins under Option B; what must be visible in the audit log is that the attempt occurred. An admin who systematically probes session content endpoints across multiple teams after hours engages in security-relevant behavior that is detectable only if the failed requests are logged. The audit entry must be written even when the response is 403.

**Alternative considered:** Option A (blanket admin access to all team content). Rejected because it creates a surveillance risk that cannot be adequately mitigated by audit logging alone. An admin who accesses every team's vote history leaves a log trail but has already seen the data.

---

### Decision 3: Facilitator pre-session access via `draft` session status

**Choice:** Add a `draft` session status. A facilitator may create a `draft` session associated with a specific team to unlock read-only historical access for preparation. A `draft` session that is not advanced within 24 hours becomes inaccessible at read time: the authorization SQL conditions `draft` access on `created_at + INTERVAL '24 hours' > NOW()`, so a stale draft is invisible to the authorization check without requiring a background process to delete it. This is lazy expiry at read time — no new background task infrastructure is required. Orphaned `draft` rows may be cleaned up by a periodic maintenance query as a follow-on operational concern; the security property (access ends at 24 hours) is enforced by the SQL check, not by deletion.

**Rationale:** Without `draft`, a facilitator must create an open session to access the historical data they need to decide how to structure that session. That reverses the preparation workflow: the facilitator is in "preparation mode" at their desk the day before, not in the room with the team. Forcing session creation as the prerequisite to preparation makes the historical data less useful (by the time the session is open, preparation context is gone) and creates confusion about whether the session has "started" before the facilitator is ready.

The `draft` status preserves the team-scoping principle of ADR-007: historical access is still tied to a specific session row associated with a specific team. It does not grant open-ended browsing access. A facilitator cannot create a `draft` session for a team they cannot facilitate.

**Full SQL check for facilitator access path:**
```sql
sessions.facilitator_id = $current_user
AND sessions.team_id = $requested_team
AND (
  sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
  OR (
    sessions.status = 'draft'
    AND sessions.created_at + INTERVAL '24 hours' > NOW()
  )
  OR (
    sessions.status = 'complete'
    AND sessions.facilitator_access_expires_at > NOW()
  )
)
```

**Lazy expiry rationale:** Separating the `draft` branch from the active-status IN clause allows the 24-hour window to be evaluated inline without a background deletion process. The existing codebase has no background task runner, no scheduled job mechanism, and no worker process. Adding one for this feature would introduce new infrastructure with its own failure modes (silent task failure could extend draft access beyond 24 hours). Lazy expiry at the authorization check provides the same security property — access ends at 24 hours — without that dependency. The check fails cleanly when the window closes, and no residual access is possible.

**Alternative considered:** Accept that session creation is the access gate; document it as a known workflow constraint in facilitator onboarding. Acceptable fallback if the implementation team judges `draft` out of scope — but the workflow inversion must be explicitly documented and the session creation UX must frame the creation step as "start preparation," not "open the room," to reduce confusion.

---

### Decision 4: Post-session access grace window via `facilitator_access_expires_at`

**Choice:** Add `facilitator_access_expires_at TIMESTAMPTZ` to the `sessions` table. When a session transitions to `completed`, the server sets this field to `completed_at + INTERVAL '30 minutes'`. During the grace window, the facilitator retains read-only access to the team's historical data. After the window expires, the SQL check fails and access ends.

The grace window is read-only unconditionally. No write access of any kind during the grace window. The mechanism is the SQL check in Decision 3, which includes the `completed + expires_at > NOW()` branch.

**Rationale:** A facilitator closes the session at the natural completion point. In the ten to thirty minutes after close, they are often still in the room: adding action items, verifying the wrap-up note, responding to participant questions about prior trends. The moment they close the session, they lose the context they need to finish that work. The system penalizes the act of completing. A bounded, read-only grace window removes the penalty without opening a standing access path.

The 30-minute window is deliberately bounded and does not accumulate: a facilitator who ran Team A's session two weeks ago has no grace window access, as ADR-007 requires.

**Expiry terminology:** This design consistently uses "expiry" when referring to the `facilitator_access_expires_at` mechanism — not "revocation." Revocation implies an active administrative decision to terminate access; expiry accurately describes what happens: the time-limited window closes when the clock runs out. These are different concepts with different incident response implications. When the question arises "can we revoke the grace window immediately?" the accurate answer is: the window cannot be shortened from within the application. Shortening the window — for example, following a post-session security incident involving a compromised facilitator account — requires a direct database write (`UPDATE sessions SET facilitator_access_expires_at = NOW() WHERE id = $id`) executed by a support engineer with database access. This is a stated design acceptance, not an oversight. The operational runbook for post-session security incidents must document this escalation path.

**Alternative considered:** No grace window; document session close as a hard cutoff. Acceptable if the implementation team cannot implement `facilitator_access_expires_at` in this change — but the UX of the session close action must clearly communicate "complete all post-session work before closing," and the session-close button label must reflect this. The workflow cost must be named in facilitator documentation, not discovered by accident.

---

### Decision 5: WebSocket authorization at delivery time

**Choice:** All content-access WebSocket events use delivery-time authorization checks. Connection-time and subscription-time checks may exist in addition but cannot substitute for delivery-time checks.

**The four content-access events and their required check:**

| Event | Subscriber requirement |
|---|---|
| `vote_readiness_update` | Caller must be the active facilitator for this session (`sessions.facilitator_id = $subscriber AND sessions.status IN ('pre_session', 'active')`) |
| `session_state_change` | Caller must be an active participant or the active facilitator for this session |
| `vote_revealed` | Caller must hold valid participant or facilitator authorization for this session |
| `topic_history_update` | Caller must pass the same team membership check as the corresponding HTTP endpoint |

**Revocation criterion (testable):** When `team_memberships.removed_at` is set for a connected subscriber, the server MUST stop delivering content-access events to that connection. No further events will be delivered after the membership change is committed to the database. The mechanism is delivery-time evaluation of the authorization check on each event — a check that fails for a removed member returns nothing rather than pushing the event.

**Wire-level push requirement (implementation constraint):** The delivery-time check must be evaluated at the moment of per-connection wire-level push — the instant immediately before bytes leave the server for a specific WebSocket connection. Checks at queue-dequeue time (when an event is taken off a pub/sub channel) are not sufficient. If a pub/sub intermediary such as Redis pub/sub is in the delivery path, events generated before a membership removal and still buffered in the intermediary queue must be checked at the push layer, not at the dequeue layer. An implementation that evaluates authorization when events are dequeued from the channel and caches the result until wire delivery does not satisfy this requirement — the authorization state at the moment of wire-level push is what governs, not the authorization state at the moment the event was fetched from the queue.

**Rationale:** Connection-time checks cannot satisfy SEC-25's re-authorization requirement. A user whose membership is revoked mid-connection continues to receive events until they reconnect or the connection expires — which could be the full duration of an active session. Subscription-time checks catch the moment of joining a channel but have the same residual-access problem. Only delivery-time checks guarantee that a membership change takes effect without requiring a reconnect.

**Alternative considered:** Timer-based re-check at a named interval (e.g., every 60 seconds). Acceptable if delivery-time checking introduces unacceptable latency or implementation complexity — but the bound must be a specific number, not a phrase. "Meaningful intervals" is not testable and will not be accepted as a spec value. If a timer is used, the maximum latency between membership removal and event cessation must be specified (e.g., "no more than 60 seconds from the database commit").

---

### Decision 6: Authorization cache prohibition, scoped by layer

**Choice:** Authorization checks are not cached at any of these three layers:
1. **HTTP response cache:** Content endpoints must not set `Cache-Control` headers that would allow a proxy or browser to serve cached responses to a different user or after a role change.
2. **ORM/query cache:** The authorization helper must execute a live database read on every call. No ORM-level query cache may be applied to the team membership, global role, or session status queries used in the authorization check.
3. **Application-session cache:** The authorization check must not be resolved from the application session cookie's role and membership snapshot. Role changes (via Assign a Role or TEAM-006) must take effect on the next request, not on the next login.

**Named caching layers outside application control:** The three-point cache prohibition above addresses layers under direct application control. The following additional caching surfaces are explicitly named and their deployment status confirmed:

- **CDN caching:** No content delivery network is in the current deployment path for this internal application. `Cache-Control: no-store` in the application response is sufficient without CDN-level cache policy configuration. If a CDN is added in the future, its origin cache rules must be audited to confirm that `Cache-Control: no-store` is not overridden. A CDN that caches `200` responses for a fixed TTL could serve session data to a different user without the application's knowledge.
- **Reverse proxy caching:** The current deployment does not use a reverse proxy with caching enabled (no nginx `proxy_cache` or equivalent configuration). If a reverse proxy is introduced, its caching configuration must be verified to pass `Cache-Control: no-store` through to the client without override.
- **Browser service worker caches:** This application does not register a service worker. `Cache-Control: no-store` does not prevent a service worker from caching a response independently. If a service worker is added for any purpose (offline support, push notification handling), its fetch handler must explicitly pass through to the network for all authorization-sensitive endpoints and must not cache their responses.

**Rationale:** Cached authorization results are the most common cause of time-of-check/time-of-use gaps in access control. A role change that takes effect on the next login is a window during which a user whose role has been elevated (e.g., from participant to engineering_manager) can still participate in a live session. The session-participation spec already established the no-cache requirement for lock-in checks; this change extends it to all content access.

**Alternative considered:** Cache with a short TTL (e.g., 5 minutes). Rejected because a 5-minute window is a 5-minute surveillance gap. If a facilitator discovers a bypass and exploits it during a session, the data exposure has already occurred before the cache expires.

---

### Decision 7: System-wide consistent 403/404 behavior

**Choice:** Unauthorized requests to team content endpoints return the same response code and body regardless of whether the requested resource exists. The pattern established by TEAM-006's Decision 4 ("a 404 for 'team not found' must be indistinguishable from a 404 for 'team found but caller is not authorized to know it exists'") is extended as a system-wide rule covering all team content endpoints.

**Implementation:** The authorization check executes before the resource lookup. If the caller is not authorized for a team, the endpoint returns 403 without querying whether the team or its content exists. The response body for unauthorized requests does not include the team ID, session ID, or any identifier that confirms the resource exists.

**Timing oracle mitigation (blocking design requirement):** Because the authorization check returns before the resource lookup for unauthorized callers, unauthorized responses may be detectably faster than authorized responses. An attacker who can observe response time distributions across many requests can statistically distinguish "resource exists, caller unauthorized" from "resource does not exist" — even when both return 403 with identical bodies. Calibration to average authorized-request latency is insufficient: average latency masks variance, and variance differences between the authorized and unauthorized response time distributions are exploitable with enough samples.

**This is a blocking design requirement, not a known limitation.** All content endpoint responses — both authorized and denied — must apply a constant minimum response time floor. The floor must be set at no less than the 95th or 99th percentile of authorized-request latency under realistic database load, not the mean.

**Required before any content endpoint is deployed to production:**
1. Measure the latency distribution of authorized requests to the highest-latency content endpoint under realistic database load.
2. Select a constant minimum response time floor equal to the 95th or 99th percentile of that measured distribution.
3. Implement the floor as a constant minimum applied to all responses (both authorized and denied) — not a dynamic synthetic delay calibrated to the current mean.
4. Document the measurement results and the selected floor value.

The Q-timing-oracle open question is resolved by this requirement: the question is not whether a floor is needed, but what value to select based on measurement. The measurement artifact must exist before the first content endpoint reaches production.

---

### Decision 8: Authorization helper returns a role-qualified grant, not a boolean

**Choice:** The authorization helper returns a typed grant object — or denies access — rather than a boolean. The grant object includes: the user's resolved access path (team member, EM association, or active facilitator), the user's effective role for this team in this context, and the content types authorized for this role. The serializer consumes the grant object to produce the correct response shape.

Example grant type (TypeScript):
```typescript
type TeamAccessGrant =
  | { path: 'member'; role: 'participant' | 'engineering_manager'; teamId: string; actorGlobalRole: string }
  | { path: 'facilitator'; sessionId: string; teamId: string; sessionStatus: SessionStatus; actorGlobalRole: string }
  | { path: 'admin'; actorGlobalRole: string };
```

**`actorGlobalRole` on the grant:** Every audit log write requires `actor_global_role` as a non-null field. The authorization helper already queries `users.global_role` as part of the access check (the dual-check in Path 2 reads it explicitly). Including `actorGlobalRole` in every grant variant surfaces that value to the route handler at no additional query cost. Route handlers must use `grant.actorGlobalRole` for audit log writes and must not re-query the users table to obtain this field.

**Application Admin grant — Option B:** The helper `evaluateTeamAccess(userId, teamId)` always returns `{ path: 'admin', actorGlobalRole: 'application_admin' }` for Application Admin callers, regardless of which endpoint type is calling it. The endpoint handler enforces the scope restriction: a session content endpoint that receives an `admin` grant returns 403; an administrative data endpoint that receives an `admin` grant proceeds. This keeps the helper's contract clean — it answers "what access does this user have to this team?" without knowledge of which endpoint invoked it.

Option A (passing `endpointType: 'session-content' | 'administrative'` to the helper) was rejected because it mixes endpoint routing concerns into the authorization layer. The helper has no business knowing whether its caller serves session data or administrative data; that distinction belongs at the handler level.

**Rationale:** A single `isAuthorized: boolean` loses the role information required to serialize the correct response. An EM and an Engineer both receive `true` from such a check, but their response shapes are different: the EM sees aggregate vote distributions only; the Engineer sees the aggregate plus their own vote; a Facilitator during an active session sees individual attribution on revealed topics. If the serializer does not know which path granted access, it cannot produce the correct shape. Collapsing the grant to a boolean and then re-querying the role downstream is a duplication that invites the two queries to diverge.

The facilitator case illustrates this most clearly: the grant must carry `sessionStatus` so the serializer knows whether the topic has been revealed before deciding whether to include vote values. The authorization check and the serialization contract are not independent — they must share state through the grant object.

---

### Decision 9: Facilitator does not see vote values before the reveal — two enforcement points

**Choice:** The constraint that the facilitator cannot see vote values before the reveal is enforced at two independent layers:
1. **Authorization layer:** The grant object for a facilitator on a live session correctly identifies their access path but does not populate vote values in the response.
2. **Serializer layer:** The serializer checks the topic's reveal status (`session.topics[n].status === 'revealed'`) before including vote values in the response body, regardless of the caller's access path.

**Grant-path-specific queries and serializers:** The serializer module does not accept a single shared raw data type across all grant paths. Each grant path uses a distinct query function and a distinct serializer function:

- `serializeForMemberParticipant(grant, result: ParticipantQueryResult)` — called after a query that selects `voter_id` alongside `vote_value`. The Engineer path requires `voter_id` to identify the caller's own vote. `ParticipantQueryResult` includes this field.
- `serializeForMemberEM(grant, result: EMQueryResult)` — called after a query that never selects `voter_id`. The EM path must not have `voter_id` in memory; the attribution boundary is enforced at the query layer, not the serializer layer. `EMQueryResult` does not include this field.
- `serializeForFacilitator(grant, result: FacilitatorQueryResult)` — called after a query appropriate to the facilitator's session-scoped access.

The route handler selects the appropriate query function based on the grant path and passes the result to the corresponding serializer. There is no single `rawData: SessionHistoryData` parameter shared across paths: a shared type that includes `voter_id` would place that field in memory during EM serialization; a shared type that omits it would prevent the Engineer serializer from identifying own votes. Grant-path-specific query functions prevent this by construction.

**Rationale:** An authorization check that grants the facilitator access to "live session data" does not automatically restrict what shape that data takes. Without serializer enforcement, a facilitator who is correctly authorized gets the full session state including pre-reveal vote values. The serializer must independently enforce the pre-reveal/post-reveal boundary. Both enforcement points are required; neither is sufficient alone.

This is a load-bearing ritual constraint (the simultaneous reveal mechanic) implemented partly as a security control and partly as correct data serialization. The implementation team must treat both layers as separate acceptance criteria, not a single concern.

**Required integration test cases:** The behavioral contract enforced by the two-layer model cannot be verified by the TypeScript type system alone — the type system can verify grant shape but not serializer logic. The following named integration test cases are acceptance criteria for this design and must be present before the serializer is integrated into any endpoint:

| Test name | Condition | Required assertion |
|---|---|---|
| `facilitator-unrevealed-topic` | Facilitator grant; topic `revealStatus !== 'revealed'` | Vote values are absent from the response body |
| `facilitator-revealed-topic` | Facilitator grant; topic `revealStatus === 'revealed'` | Full vote attribution is present in the response body |
| `layer-removal-serializer-check` | Facilitator grant; serializer reveal check removed | Test fails — vote values appear on unrevealed topic |
| `layer-removal-auth-check` | Authorization check bypassed; serializer check present | Test fails — unauthorized access reaches the serializer |

Tests `layer-removal-serializer-check` and `layer-removal-auth-check` verify that removing either enforcement layer independently causes a test failure. A test suite that only verifies correct output from the combined system does not satisfy this requirement; each layer must be independently verifiable as necessary.

---

## Risks / Trade-offs

**[Risk: `draft` session complexity] → Mitigation:** Adding `draft` to the session state machine introduces a new status that the session setup flow, scheduling logic, and all status-querying code must handle. The 24-hour expiry is enforced via lazy expiry at read time (the SQL check conditions `draft` access on `created_at + INTERVAL '24 hours' > NOW()`), which requires no background task infrastructure. If the broader `draft` status complexity is judged too high for this change, Decision 3's fallback (document workflow inversion) applies. The fallback is less good for facilitators but does not compromise security.

**[Risk: Delivery-time WebSocket checks add latency to every pushed event] → Mitigation:** The authorization helper must be fast — a live database read on every WebSocket push during a live session adds latency to the real-time experience. The helper's team membership query must be indexed on `(user_id, team_id)` and the session status query on `(facilitator_id, team_id, status)`. If latency is unacceptable, the timer-based fallback in Decision 5 is the escape valve.

**[Risk: Consistent 403/404 behavior is incomplete at rollout] → Mitigation:** The system-wide rule (Decision 7) applies to all team content endpoints. If the implementation team cannot audit all endpoints before rollout, the known-uncovered endpoints must be explicitly listed and committed to a follow-up change. Partial compliance with a known gap list is better than partial compliance with an unknown gap.

**[Risk: Serializer and authorization helper diverge post-initial build] → Mitigation:** The grant type (Decision 8) is a shared TypeScript type in the shared types module. Any change to what the authorization helper returns that is not reflected in the serializer produces a compile-time error. This is the primary mechanism for keeping them in sync.

**[Risk: Application Admin Option B creates admin frustration] → Mitigation:** Admins who expect to be able to see session data to diagnose issues will be blocked. The audit log will show them that they cannot access session data but not tell them what the issue is. The trade-off is accepted: the surveillance risk of Option A outweighs the operational friction of Option B. Admins who need session-level diagnostics must work through a team facilitator or team member.

**[Risk: Post-session grace window is extended informally] → Mitigation:** The `facilitator_access_expires_at` value is set server-side at session close and is not updatable by the facilitator or any client call. An admin could theoretically update the column directly, but that action would appear in the audit log. The window is structurally bounded.

---

## Migration Plan

1. **Schema migration:** Add `facilitator_access_expires_at TIMESTAMPTZ NULL` to `sessions`. Add `'draft'` to the `sessions.status` enum. Both are nullable/additive — no existing rows are affected. Existing sessions in terminal states have `facilitator_access_expires_at = NULL`; the SQL check's `expires_at > NOW()` correctly returns false for NULL.

2. **Authorization helper:** Build and test independently of any endpoint changes. The helper must be exercisable in isolation with a test database.

3. **Serializer contracts:** Define and implement the grant-path-specific serializer functions before wiring them into endpoints. Each serializer function must be testable in isolation with the query result type appropriate to its grant path (`ParticipantQueryResult` with `voter_id`, `EMQueryResult` without, `FacilitatorQueryResult`). The named integration test cases from Decision 9 must pass before endpoint integration begins, because endpoint acceptance criteria include role-appropriate response shapes that cannot be verified without a functioning serializer.

4. **Endpoint integration:** Integrate the authorization helper and the appropriate serializer into each content endpoint. Start with the highest-risk endpoint (session history / `GET /teams/:id/sessions`). Each integration is a separate commit with its own test coverage. Endpoint acceptance criteria include both authorization gate behavior (403/401) and correct response shape per role.

5. **WebSocket integration:** Add delivery-time checks to the four named events after the HTTP endpoint integration is complete and stable.

6. **Draft session maintenance:** The `draft` session expiry is enforced lazily by the SQL check in the authorization helper; no background task is required for the security property to hold. After the `draft` status is in production, add a periodic maintenance query (a follow-on operational item) to hard-delete `draft` rows older than 24 hours. This is cleanup of orphaned data, not a security control, and can be deferred until after the draft session workflow is stable in production.

**Rollback:** The schema migration is backward-compatible. If the authorization helper or serializer changes cause a regression, revert the application code without reverting the migration. The `draft` status and `facilitator_access_expires_at` column being present but unused does not affect existing behavior.

---

## Open Questions

**Q-implementation:** If the implementation team cannot achieve delivery-time WebSocket authorization without unacceptable latency, what specific latency bound is acceptable for a timer-based fallback? Requires measurement against the real-time layer — cannot be answered from requirements alone. Owner: engineering lead.

**Q-fallback-draft:** If `draft` session status is descoped from this change, what UX text frames session creation as "start preparation" rather than "open the room"? Requires agreement between BA (Marcus) and facilitator SME (Priya). Owner: Marcus Delgado with Priya Nair confirmation.

**Q-timing-oracle (closed):** Resolved as a blocking design requirement in Decision 7. The timing oracle mitigation is not an open question — it is a prerequisite. The implementation team must measure authorized-request latency under realistic load, select a constant minimum response time floor at the 95th or 99th percentile, and document the results before any content endpoint reaches production. The question of whether the floor is needed is closed; the measurement determines the floor value.
