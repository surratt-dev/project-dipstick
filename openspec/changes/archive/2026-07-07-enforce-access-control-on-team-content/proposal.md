## Why

The ritual's psychological safety guarantee rests on engineers believing their vote cannot be seen by anyone who would use it against them. Every protective feature we have built — holding votes in Redis until the reveal, showing EMs only aggregate distributions, restricting the facilitator to a readiness grid before the reveal — is undone the moment an unauthorized user can reach raw session data through any path the UI did not think to gate. This change installs the floor the rest of the application stands on: a server-side authorization layer, enforced independently on every content endpoint and every WebSocket delivery, that answers one question on every request — "is this authenticated user authorized to see this team's content?" — and refuses to answer it from a cache.

This is the right moment to build it because every prior change in this sequence (Sign In, First Access, Join a Team, Assign a Role, Establish Manager/Team Relationship) has written the data model this layer must query. The `users` table has `global_role`. The `team_memberships` table has `role` and `removed_at`. The `sessions` table has `facilitator_id`, `team_id`, and `status`. The relationships are in place. The enforcement layer that reads them correctly on every request is the only thing missing.

## What Changes

- **New:** A reusable server-side authorization helper that evaluates three access paths (team member, associated EM, active session facilitator) against live database state — no cache, no client-supplied claims — and returns a role-qualified access grant, not a single boolean.
- **New:** A defined content type access matrix enforced at the serializer layer, with distinct response shapes for Engineer, EM, Facilitator, and Application Admin roles on every content endpoint.
- **New:** Delivery-time authorization checks on the four WebSocket content-access events (`vote_readiness_update`, `session_state_change`, `vote_revealed`, `topic_history_update`), with delivery-time revocation when a user's team membership is removed mid-connection: no content-access events for that team are delivered to that connection after `team_memberships.removed_at` is committed to the database. If a timer-based fallback is used, the maximum latency bound must be named by the engineering lead before Group 8 begins (see Named Prerequisites).
- **New:** A facilitator session-scoped access model that implements ADR-007: historical data access is tied to an active session row (status in `draft`, `lobby`, `pre_session`, `active`, `wrap_up`) and a bounded 30-minute post-session grace window, not to `global_role = 'facilitator'` alone.
- **New:** A `draft` session status enabling facilitator preparation access to team history before the session opens, with automatic expiry after 24 hours if not advanced.
- **New:** A `facilitator_access_expires_at` column on `sessions`, set to `completed_at + 30 minutes` at session close, providing a read-only post-session access window.
- **New:** An Application Admin access boundary (Option B): admins may access team administrative data (membership lists, role assignments, EM associations, topic configuration metadata) but not session content. All admin access to administrative data is audited in the same `audit_log` table established by the manager-team-association change.
- **New:** Consistent 403/404 handling across all team content endpoints: an unauthorized request returns the same response code and body regardless of whether the requested resource exists, preventing existence disclosure.
- **New:** Named facilitator-facing error states for live session contexts (authorization failure during reveal, historical data unavailable, session status transition, cross-team denial), distinct from general 403/404 handling.
- **Modified:** The `session-participation` spec's dual-check pattern (`users.global_role` AND `team_memberships.role`) is promoted from a session-join constraint to a system-wide authorization principle, referenced explicitly by the new authorization helper.

## Capabilities

### New Capabilities
- `team-content-access`: The server-side authorization layer for all team-scoped content HTTP endpoints. Covers the three authorization paths, the content type access matrix (with role-specific response shapes), Application Admin boundaries, consistent 403/404 behavior, and the no-caching constraint scoped to HTTP, ORM, and application-session layers. **Content type access matrix (normative):** Engineer receives aggregate vote distribution plus their own individual vote per topic; EM receives aggregate distribution only (no individual vote attribution or row-per-voter representation); Facilitator on revealed topics receives individual attribution; Facilitator on unrevealed topics receives readiness grid only (no vote values). **Cache prohibition (all three layers required):** HTTP-layer prohibition (`Cache-Control: no-store`) is covered by Task 5.7. ORM-level query cache prohibition and application-session cache prohibition must be separately verified — see Tasks 5.8 and 5.9. **Consistent 403/404 (testable):** the response body for unauthorized requests must not include the team ID, session ID, or any identifier that confirms the resource exists.
- `websocket-session-authorization`: Delivery-time authorization for the four named WebSocket content-access events. Covers the three distinct check points (connection, subscription, delivery), the requirement that delivery-time checks are mandatory (connection and subscription checks are additive), and the revocation criterion for membership changes mid-connection. **Revocation criterion (testable):** when `team_memberships.removed_at` is set for a connected subscriber, no content-access events for that team are delivered to that connection after the membership change is committed to the database. If the implementation uses a timer-based fallback, the maximum latency between database commit and event cessation must be stated in tasks.md before Group 8 implementation begins — "no more than X seconds from database commit" is the required form; an unbound phrase is not acceptable.

### Modified Capabilities
- `session-participation`: The dual-check enforcement pattern is extended — the proposal adds the requirement that the same pattern (read both `users.global_role` and `team_memberships.role` from the database, no cache) is used by the new authorization helper for all content access checks, not only at session join time. **Acceptance criterion:** an HTTP request for team content from a user whose `users.global_role` and `team_memberships.role` have diverged (e.g., `global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'`) must be served the EM response shape, not the Engineer response shape. A change to `team_memberships.role` must take effect on the next content request without re-authentication.

### New Capabilities (added post-review)
- `facilitator-live-session-error-states`: Four named error states for facilitator-facing authorization and session status failures in live session contexts, distinct from general 403/404 handling. Implements Task 9. The four states and their required behaviors: (1) **Reveal failure** — authorization or session state check fails when the facilitator triggers the reveal; the response distinguishes recoverable (session is still active, retry is possible) from non-recoverable (session is no longer in active state). (2) **Historical data unavailable during active session** — trend or history endpoint fails during facilitation; returns an empty state with the message "Historical data is temporarily unavailable. Your session is still active." rather than a 403, so the live session is not interrupted. (3) **Session status transition during live facilitation** — unexpected status change is detected; pushes a non-blocking banner (not a modal) to the facilitator's client including current session state and a clear action ("Resume or review"). (4) **Cross-team denial** — a facilitator in Team B's session requests Team A's historical data; the response reads "This data is not available in your current session" without naming or confirming Team A's existence. **Privacy constraint on Error State 4:** the response body must not include the requested team ID, team name, or any identifier that confirms the team exists. Error States 1 and 2 are designed to be recoverable without session disruption. Error States 3 and 4 require facilitator action to proceed. Facilitator error message text and recovery path UX must be reviewed and approved by Priya Nair before Group 9 implementation begins (see Named Prerequisites).

## Impact

- **Backend:** New authorization middleware/helper consumed by all existing and future content endpoints; new `draft` session status in the state machine; new `facilitator_access_expires_at` column on `sessions`; expanded audit logging for Application Admin access to administrative data.
- **Database:** Schema migration adding `facilitator_access_expires_at` to `sessions`; `draft` status added to the `sessions.status` enum; background task to expire `draft` sessions after 24 hours.
- **WebSocket layer:** Authorization check added at delivery time for the four content-access events; connection and subscription checks remain but are not sufficient alone.
- **APIs affected:** All endpoints returning team-scoped content (session history, trend data, action items, topic configuration, live session state); no new endpoints introduced.
- **Existing specs referenced:** `session-participation` (dual-check pattern), `manager-team-association` (EM vote attribution boundary, audit log table, 404 information exposure constraint from Decision 4), `role-assignment` (immediate-effect requirement for role changes).

---

## Named Prerequisites

The following must be resolved before the implementation groups listed begin. These are not implementation tasks — they are decisions and amendments that must exist in writing before code is written against them.

| Prerequisite | Owner | Required Before | Status |
|---|---|---|---|
| Use case amendment: replace "Access does not persist after the session ends" with language reflecting the 30-minute grace window; add `draft` session as a valid facilitator access path in the Alternate Flows section. File: `requirements/use cases/01 - Identity and Access - Use Cases.md` | Marcus Delgado | Group 1 begins | Open |
| WebSocket latency bound: engineering lead must specify a measurable maximum latency for the timer-based fallback (e.g., "no more than 60 seconds from database commit to event cessation"), or confirm delivery-time checks are achievable within acceptable latency bounds. An unbounded phrase is not an acceptable spec value. | Engineering lead | Group 8 begins | Open |
| Facilitator error state UX sign-off: Priya Nair must review and approve error message text and recovery path for all four named facilitator error states before any Group 9 task is marked in progress. | Priya Nair | Group 9 begins | Open |

---

## Review Feedback Resolutions

*Post-review update — 2026-07-07. Reviewers: Marcus Delgado (BA), Rachel Okonkwo (VP Engineering).*

This section records how reviewer feedback is resolved. Accepted feedback is incorporated inline above. Declined feedback is documented here with rationale.

### Accepted

**Zero-latency revocation replaced with testable criterion (Marcus, issue 2.2).** The "zero-latency revocation" language in the `websocket-session-authorization` capability and in What Changes has been replaced with the testable criterion from Decision 5 of design.md: no content-access events are delivered after `team_memberships.removed_at` is committed to the database. If a timer-based fallback is used, the latency bound must be stated before Group 8 begins.

**Facilitator error states capability added (Marcus, issue 3.1).** Task 9 was orphaned from the capability model — no capability described what it was building or what it must produce. The `facilitator-live-session-error-states` capability has been added above, specifying all four error states, required messages, recovery classification, and the privacy constraint on Error State 4.

**`session-participation` acceptance criterion added (Marcus, issue 2.3).** A concrete testable acceptance criterion has been added to the `session-participation` modified capability. The dual-check design constraint is now paired with an observable test condition.

**Content type access matrix added to capability (Marcus, issue 2.1).** The normative access matrix has been added to the `team-content-access` capability description. It previously existed only implicitly in Tasks 6.2–6.4 and was not visible in the spec.

**Cache prohibition gap flagged and tasked (Marcus, traceability section).** The `team-content-access` capability now names all three cache prohibition layers explicitly. Tasks 5.8 and 5.9 have been added to tasks.md to cover ORM-level and application-session cache prohibition verification, which Task 5.7 (HTTP layer only) did not address.

**WebSocket latency bound added as named prerequisite (Rachel, concern 2).** The engineering lead must specify a measurable bound before Group 8 begins. This is now a blocking prerequisite.

**Use case amendment required before implementation (Marcus, issues 1.1 and 1.2).** The proposal does not silently override the use case. The conflict between the grace window and the use case's "access does not persist after the session ends" statement, and the absence of `draft` session from the use case's alternate flows, are called out explicitly. The use case (`requirements/use cases/01 - Identity and Access - Use Cases.md`) must be amended before Group 1 begins. This amendment is a named prerequisite above.

### Declined

**Rachel Okonkwo — descope `draft` session status to a follow-on change (Concern 1).**

Rachel recommends removing Group 7 (`draft` session status) from this change and applying Decision 3's fallback — frame session creation as "start preparation" in facilitator UX and reassess after first-team deployment.

This recommendation is declined. `Draft` remains in scope.

Rachel's concern is legitimate on sequencing grounds: `draft` adds state machine complexity, a background task, and lifecycle edge cases to a change whose core is security infrastructure. The authorization model functions without it. These observations are correct.

However, descoping `draft` creates a conflict that cannot be quietly absorbed: **OR-6.3 states that the facilitator briefing view must be accessible without starting or creating a new session.** If `draft` is removed, the only path to facilitator historical access is creating a `lobby`-state session — which opens the participation room before the facilitator is ready to receive participants. Creating a `draft` session is still creating a session, but it does not open the room. If the acceptable threshold for OR-6.3 is "no session creation at all," then no in-scope implementation path satisfies it, and that conflict must be resolved as an explicit requirements change, not by defaulting to the fallback.

The preparation phase is not decoration. A facilitator who cannot review team history before the session opens is structuring the session in the room, in front of the team, with no preparation context. This is the failure mode that produces inconsistent session quality, which is the failure mode that erodes trust in the ritual. The `draft` status prevents that failure mode at minimal implementation cost (the background expiry task is the most substantial addition).

The scope of `draft` in this change is kept to the minimum required to satisfy OR-6.3: read-only historical access during facilitator preparation. It is not a full session lifecycle enhancement. If during implementation the engineering team determines that `draft` cannot be delivered without putting Groups 1–6 or Group 10 at risk, that is the moment to escalate — not the proposal stage.

The OR-6.3 conflict must be named explicitly in any future proposal that revisits this decision.
