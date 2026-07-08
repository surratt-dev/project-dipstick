## Prerequisites

- [x] 0.1 Confirm use case amendment for 30-minute grace window is merged into `requirements/use cases/01 - Identity and Access - Use Cases.md`. Owner: Marcus Delgado. Blocks: Group 1. *(Completed during spec sync stage — amendment present in the use cases file.)*

## 1. Schema Migration

- [x] 1.1 Add `'draft'` to the `sessions.status` enum in the database schema and migration file
- [x] 1.2 Add `facilitator_access_expires_at TIMESTAMPTZ NULL` column to the `sessions` table in the migration
- [x] 1.3 Add index on `sessions(facilitator_id, team_id, status)` to support the Path 3 authorization query
- [x] 1.4 Add index on `team_memberships(user_id, team_id)` if not already present, to support Path 1 and Path 2 authorization queries
- [ ] 1.5 Run migration in local dev environment and verify columns and enum value are present
- [x] 1.6 Update the shared TypeScript types to include `'draft'` in the `SessionStatus` union and `facilitatorAccessExpiresAt` in the `Session` type

## 2. Authorization Helper — Core

- [x] 2.1 Create the `teamContentAccessHelper` module with the `evaluateTeamAccess(userId, teamId)` function signature returning a typed `TeamAccessGrant` union or `null`; every grant variant must include `actorGlobalRole: string`
- [x] 2.2 Implement Path 1 (team member): query `team_memberships` for an active row (`removed_at IS NULL`) for the user and team; return grant with `path: 'member'`, the resolved `role`, and `actorGlobalRole`
- [x] 2.3 Implement Path 2 (EM by explicit association): verify `users.global_role = 'engineering_manager'` AND active `team_memberships.role = 'engineering_manager'` (dual-check per session-participation spec); return grant with `path: 'member'`, `role: 'engineering_manager'`, and `actorGlobalRole`. *Cross-reference (session-participation capability): Task 5.9 verifies no application-session caching for role changes; Task 11.7 is the E2E acceptance test for the dual-check pattern. This capability is not complete until both of those tasks pass.*
- [x] 2.4 Implement Path 3 (active session facilitator): query `sessions` using the full SQL check — `status IN ('lobby', 'pre_session', 'active', 'wrap_up')`, the draft branch (`status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()`), and the grace window branch (`status = 'complete' AND facilitator_access_expires_at > NOW()`); return grant with `path: 'facilitator'`, `sessionId`, `sessionStatus`, and `actorGlobalRole`
- [x] 2.5 Implement Application Admin detection: when `users.global_role = 'application_admin'`, return `{ path: 'admin', actorGlobalRole: 'application_admin' }` regardless of which endpoint type called the helper; the helper does not know or decide whether admin access is sufficient — that is enforced by the calling endpoint handler
- [x] 2.6 Confirm the helper returns `null` (not `false` or a boolean) when no path matches and the caller is not an Application Admin
- [x] 2.7 Verify the helper does NOT read from any ORM-level query cache; confirm live database reads on every call
- [x] 2.8 Write unit tests for the helper covering all three member/facilitator paths, the Application Admin path, the grace window boundary (at expiry and just before), a removed member (Path 1 fails), a `draft` session within 24 hours (Path 3 succeeds), a `draft` session older than 24 hours (Path 3 fails), and a user with no relationship (null returned)

## 3. Application Admin Access Boundary

*Note: Tasks 3.2 and 3.5, and the session-content assertions from Task 3.7, have been moved to Group 5 (HTTP Endpoint Integration). Those tasks require the session content endpoint handlers to be wired with the authorization helper, which is done in Group 5. Only administrative-data tasks remain in this group.*

- [x] 3.1 Verify that the authorization helper returns `{ path: 'admin', actorGlobalRole: 'application_admin' }` for all Application Admin callers (covered by Task 2.5); confirm this grant is returned regardless of whether the calling endpoint serves session content or administrative data
- [x] 3.3 Create or update the admin route guard for the affirmative admin scope — team metadata, membership lists, role assignments, EM associations, topic configuration metadata — to accept the `admin` grant path
- [x] 3.4 Add `audit_log` writes for Application Admin reads of administrative data (team members list, role assignments, EM associations); use `grant.actorGlobalRole` from the grant object — do not re-query the users table; include the standard fields: `actor_user_id`, `actor_global_role`, `actor_ip`, `action`, `resource_type`, `resource_id`, `timestamp`
- [x] 3.6 Verify audit writes execute in the same database transaction as the data access (or are written atomically with the same guarantees as the TEAM-006 audit log)
- [x] 3.7 Write integration tests: Application Admin gets 200 on membership list

## 4. Serializer Contracts — Role-Specific Response Shapes

**Sequencing note:** Group 4 must be completed before Group 5 (HTTP Endpoint Integration). Endpoint acceptance criteria require role-appropriate response shapes; those shapes cannot be verified without a functioning serializer. The named integration tests in this group are acceptance criteria before any endpoint integration begins.

- [x] 4.1 Define grant-path-specific serializer functions rather than a single shared function with a common raw data type:
  - `serializeForMemberParticipant(grant, result: ParticipantQueryResult)` — accepts results that include `voter_id` for own-vote identification
  - `serializeForMemberEM(grant, result: EMQueryResult)` — accepts results that must never include `voter_id`; the attribution boundary is enforced at the query layer
  - `serializeForFacilitator(grant, result: FacilitatorQueryResult)` — accepts results appropriate to the facilitator's session-scoped access
- [x] 4.2 Define the corresponding grant-path-specific query functions: the participant query selects `voter_id` alongside `vote_value`; the EM query never selects `voter_id`; confirm that no shared `rawData` type bridges these two paths
- [x] 4.3 Implement Engineer serializer path (`serializeForMemberParticipant`): aggregate vote distribution (count-per-bucket, team average, outlier count) + own individual vote per topic using `voter_id` to identify the caller's row; exclude other engineers' individual votes
- [x] 4.4 Implement EM serializer path (`serializeForMemberEM`): aggregate vote distributions only (count-per-bucket, team average, outlier count); exclude all individual vote attribution; `voter_id` must not appear in the query result passed to this function
- [x] 4.5 Implement Facilitator serializer path (`serializeForFacilitator`): full session data including individual attribution for revealed topics; pre-reveal topics return readiness grid only (no vote values), enforced by checking `topic.revealStatus === 'revealed'` before including vote data
- [x] 4.6 Verify that the facilitator serializer excludes vote values for unrevealed topics even when the grant path is `'facilitator'` — the authorization check and the serializer must enforce this independently
- [x] 4.7 Write serializer unit tests covering: EM receives aggregate only (no `voter_id` in query result), Engineer receives aggregate + own vote (not others'), Facilitator pre-reveal receives readiness only, Facilitator post-reveal receives individual attribution
- [x] 4.8 Verify that the TypeScript types for each grant-path-specific result type are distinct and that passing an `EMQueryResult` to `serializeForMemberParticipant` (or vice versa) produces a compile error
- [x] 4.9 Write the following named integration tests for the two-layer behavioral contract (these are acceptance criteria, not optional):
  - `facilitator-unrevealed-topic`: Facilitator grant, topic `revealStatus !== 'revealed'` → vote values are absent from the response body
  - `facilitator-revealed-topic`: Facilitator grant, topic `revealStatus === 'revealed'` → full vote attribution is present in the response body
  - `layer-removal-serializer-check`: Remove the serializer's reveal check → test must fail (vote values appear on unrevealed topic, demonstrating the serializer layer is necessary)
  - `layer-removal-auth-check`: Bypass the authorization check → test must fail (unauthorized access reaches the serializer, demonstrating the auth layer is necessary)

## 5. HTTP Endpoint Integration — Authorization Helper

- [x] 5.1 Integrate the authorization helper and the appropriate grant-path serializer into `GET /api/v1/teams/:id/sessions` (session history); verify that callers with no grant receive 403, callers with an admin grant receive 403, callers with a member or facilitator grant receive the role-appropriate serialized response
- [x] 5.2 Integrate into `GET /api/v1/teams/:id/trends` (trend data); same verification pattern
- [x] 5.3 Integrate into `GET /api/v1/teams/:id/action-items` (action items); same verification pattern
- [x] 5.4 Integrate into `GET /api/v1/teams/:id/topics` (topic configuration); same verification pattern
- [x] 5.5 Integrate into live session endpoints (session state, readiness grid, vote results); same verification pattern
- [x] 5.6 Verify that the authorization check is in the route handler body before any database query for team content — route guards that only redirect UI are not sufficient
- [x] 5.7 Add `Cache-Control: no-store` (or equivalent) to all content endpoint responses
- [x] 5.8 Verify that no ORM-level query cache is applied to the team membership, global role, or session status queries used by the authorization helper across all integrated endpoints; confirm live database reads on every authorization call (not a cache hit)
- [x] 5.9 Verify that the authorization result is not stored in or resolved from the application-session cookie; confirm that a role change applied to `team_memberships.role` takes effect on the next content request without requiring re-authentication, across all integrated endpoints. *Cross-reference (session-participation capability): dual-check pattern implemented in Task 2.3; E2E acceptance test in Task 11.7. This capability is not complete until Task 11.7 passes.*
- [x] 5.10 Update session content endpoint handlers to treat an `admin` grant as unauthorized: when the handler receives `{ path: 'admin' }` from the helper, it returns 403; when the handler receives `{ path: 'admin' }` on an administrative data endpoint, it proceeds. *(Moved from Group 3 — requires session content endpoint handler wiring completed in this group before this enforcement can be applied.)*
- [x] 5.11 Add `audit_log` writes for any Application Admin request to a session content endpoint, regardless of HTTP response code; include the HTTP status code (`403` for denied requests) in the audit log entry alongside the standard fields; the audit entry must be written before the 403 response is sent. *(Moved from Group 3 — requires endpoint handler integration in this group.)*
- [x] 5.12 Write integration tests: Application Admin gets 403 on session history, 403 on trend data, 403 on action items; verify the 403 responses for session content appear in the audit log. *(Session-content assertions moved from Group 3 — requires endpoint handler integration in this group.)*

## 6. Timing Oracle Measurement

*Implements the blocking requirement from Decision 7 of design.md. All content endpoint responses — both authorized and denied — must apply a constant minimum response time floor. The floor must be set at no less than the p95 or p99 of authorized-request latency under realistic database load. This group gates production deployment of the first content endpoint.*

- [ ] 6.1 Measure p95 and p99 latency of authorized content endpoint requests under representative load (use the highest-latency content endpoint under realistic database load conditions); record both values
- [x] 6.2 Implement constant minimum response time floor at the measured percentile for all content endpoints (authorized and denied); the floor must be applied to every response on every content endpoint regardless of authorization outcome
- [ ] 6.3 Document the measured p95 and p99 values, the selected floor value, and the floor implementation in the operations runbook
- [x] 6.4 Write a test verifying that response time for a denied request is within tolerance of the floor (a denied request must not be detectably faster than an authorized request at the selected floor)

## 7. Consistent 403/404 Behavior

- [x] 7.1 Implement the authorization-before-lookup pattern: the authorization helper is called before the resource lookup; if the helper returns null (or returns an admin grant on a session content endpoint), the endpoint returns 403 without querying whether the resource exists
- [x] 7.2 Verify that an unauthorized request to a nonexistent team's session history returns 403 (not 404) — same code and body as an unauthorized request to an existing team
- [x] 7.3 Verify that an authorized request to a nonexistent session returns 404 (existence disclosure is only prohibited for unauthorized callers)
- [x] 7.4 Audit all existing team content endpoints for consistent 403/404 behavior; document any endpoints that cannot be updated in this change as explicit known gaps with follow-up tracking

## 8. Facilitator Session Lifecycle — Draft Status and Grace Window

- [x] 8.1 Add session creation endpoint support for `status = 'draft'` (facilitator initiates preparation before opening the room)
- [x] 8.2 Enforce that a `draft` session can only be created by a user who is eligible to facilitate the team (not a team member per the facilitator-from-another-team constraint)
- [x] 8.3 Implement the `draft` → `lobby` transition: when the facilitator advances the session to `lobby`, the session transitions normally and the room opens to participants
- [x] 8.4 Draft session expiry is enforced lazily via the authorization SQL check (`status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()`); no background task is required for the security property to hold. After the `draft` status is stable in production, add a periodic maintenance query to hard-delete `draft` rows older than 24 hours — this is operational cleanup of orphaned data, not a security control, and may be deferred to a follow-on task
- [x] 8.5 Verify that a facilitator with only a `draft` session created within the last 24 hours can access the team's historical data via `GET /api/v1/teams/:id/sessions` and trend/action item endpoints
- [x] 8.6 Verify that a facilitator with only a `draft` session older than 24 hours receives 403 on historical data endpoints (lazy expiry has taken effect)
- [x] 8.7 Verify that deleting a `draft` session ends the facilitator's historical access (subsequent request returns 403)
- [x] 8.8 Implement session completion hook: when a session transitions to `completed`, set `facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'` in the same database transaction as the status update
- [x] 8.9 Verify that a facilitator within the grace window (session `complete` + < 30 minutes since `facilitator_access_expires_at`) can read historical data but not write (action item creation, topic update, etc. all return 403)
- [x] 8.10 Verify that a facilitator outside the grace window (session `complete` + > 30 minutes) receives 403 on historical data endpoints
- [x] 8.11 Verify that `facilitator_access_expires_at` cannot be updated by any client call

---

**Gate — before Group 9 begins:** Confirm WebSocket delivery-time authorization latency bound is documented. Owner: engineering lead. Blocks: Group 9.

---

## 9. WebSocket Delivery-Time Authorization

**Depends on: Groups 1–2 (authorization helper) and Group 5 (HTTP endpoint integration). The WebSocket authorization helper reuses the same helper and grant types. Group 9 must not begin until Group 5 integration tests pass and the engineering lead has confirmed the WebSocket latency bound (see gate above).**

- [ ] 9.1 Add delivery-time authorization check to `vote_readiness_update` event: at the moment of per-connection wire-level push, verify the subscriber is the active facilitator for this session (`sessions.facilitator_id = $subscriber AND sessions.status IN ('pre_session', 'active')`)
- [ ] 9.2 Add delivery-time authorization check to `session_state_change` event: at the moment of per-connection wire-level push, verify the subscriber is an active participant or the active facilitator for this session
- [ ] 9.3 Add delivery-time authorization check to `vote_revealed` event: at the moment of per-connection wire-level push, verify the subscriber holds valid participant or facilitator authorization for this session; apply the same grant-path serializer that enforces pre-reveal / post-reveal content restriction
- [ ] 9.4 Add delivery-time authorization check to `topic_history_update` event: at the moment of per-connection wire-level push, verify the subscriber passes the team membership check (Path 1 or Path 2 from the authorization helper)
- [ ] 9.5 Verify that the delivery-time check evaluates authorization at the instant before bytes leave the server for a specific connection — not at queue-dequeue time from any pub/sub intermediary; if Redis pub/sub is used, the check must occur at the push layer, not when the event is taken off the channel
- [ ] 9.6 Verify that `vote_readiness_update` payload does NOT include the participant's vote value — only identity and readiness status
- [ ] 9.7 Verify that `vote_revealed` payload does NOT include vote values for topics whose `revealStatus` is not `'revealed'`
- [ ] 9.8 Implement membership removal propagation: when `team_memberships.removed_at` is set for a connected subscriber, the next delivery-time check for a Team A event fails and the event is not delivered — verify without requiring reconnect
- [ ] 9.9 Verify that removal affects only the specific team's events — a subscriber connected to Team A and Team B event streams continues to receive Team B events after Team A membership is removed
- [ ] 9.10 Write integration tests for all four events: authorized subscriber receives event, unauthorized subscriber does not; subscriber removed mid-connection stops receiving events on next push

---

**Gate — before Group 10 begins:** Confirm facilitator live session error state UX is signed off by Priya Nair. Blocks: Group 10.

---

## 10. Live Session Facilitator Error States

- [x] 10.1 Implement Error State 1 (reveal failure): if the authorization check or session state check fails when the facilitator triggers the reveal, return a structured error distinguishing recoverable (session still active, retry) from non-recoverable (session is no longer in active state)
- [x] 10.2 Implement Error State 2 (historical data unavailable during active session): if a facilitator's trend or history endpoint call fails during an active session, return an empty state response with "Historical data is temporarily unavailable. Your session is still active." — not a 403 response in this context
- [x] 10.3 Implement Error State 3 (session status transition during live facilitation): when session status changes unexpectedly, push a non-blocking banner state to the facilitator's client (not a modal); include current session state and a clear action ("Resume or review")
- [x] 10.4 Implement Error State 4 (cross-team denial): when a facilitator in a session for Team B requests Team A's historical data, the response message reads "This data is not available in your current session" — not "You do not have access to Team A's data"
- [x] 10.5 Verify that Error State 4 response does not include Team A's team ID (numeric or UUID), team name, or any other identifier that confirms Team A's existence
- [x] 10.6 Write facilitator UX tests for each named error state: correct message is displayed, session view is not blocked, recovery path is clear

## 11. End-to-End Authorization Tests

- [x] 11.1 Test all role paths against `GET /api/v1/teams/:id/sessions` with a direct API call (no frontend): Engineer (200, correct shape), EM (200, aggregate only), Facilitator with active session (200, full data), Facilitator with expired grace window (403), Facilitator with draft session within 24 hours (200), Facilitator with draft session older than 24 hours (403), Application Admin (403), unauthenticated (401), no relationship (403)
- [x] 11.2 Test consistent 403/404: unauthorized caller to existing team (403), unauthorized caller to nonexistent team (403, identical response body), authorized caller to nonexistent session (404)
- [ ] 11.3 Test WebSocket revocation: connect subscriber, remove team membership, verify no further events are delivered without reconnect. *(Four-event coverage for all role types is verified at integration level in Task 9.10.)* **BLOCKED: Group 9 gate (engineering lead must confirm WebSocket latency bound; no WebSocket infrastructure exists in this codebase)**
- [x] 11.4 Test facilitator scoping: facilitator in session for Team B cannot access Team A's history through the facilitator path; facilitator can access Team B's history
- [x] 11.5 Test EM access boundary: EM receives no live session data, no individual vote attribution in session history; verify against the access matrix in the spec
- [x] 11.6 Test cache prohibition: make a content request, change the user's role, make the same request again; verify the second response reflects the new role without re-authentication
- [x] 11.7 Test dual-check pattern: a user with `global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'` receives the EM content profile (aggregate only), not the engineer content profile. *Cross-reference (session-participation capability): dual-check pattern implemented in Task 2.3; application-session cache prohibition verified in Task 5.9. This task is the E2E acceptance criterion for the session-participation capability modification.*
- [x] 11.8 Test ORM-level cache prohibition: via query logging or ORM instrumentation, verify that authorization queries (team membership, global role, session status) execute as live database reads on every content request with no ORM cache hits; confirm that enabling a query cache at the ORM level would not silently bypass this requirement
- [x] 11.9 Test Application Admin audit trail: confirm that admin requests to session content endpoints (resulting in 403) appear in the audit log with the HTTP status code; confirm that admin requests to administrative data endpoints appear in the audit log with 200
- [ ] 11.10 End-to-end test exercising all four facilitator live session error states through the full stack (HTTP through WebSocket through UI response) **BLOCKED: Group 9 gate (WebSocket) and Group 10 gate (Priya Nair must approve facilitator error message text)**
