## MODIFIED Requirements

### Requirement: Facilitator-from-another-team enforcement at session creation

A user attempting to create a session for a team via `POST /api/v1/teams/:teamId/sessions/draft` SHALL be rejected if they have an active `team_memberships` row (`removed_at IS NULL`) for `:teamId`. This check is a hard block with no exception path, enforced server-side at this endpoint, independent of and re-validated regardless of whatever eligible-teams list the caller was shown before submitting. "Not a member" for this check means no row with `removed_at IS NULL`; a user previously removed from the team is eligible to facilitate it again.

The endpoint SHALL evaluate two independent conditions, in order, with distinguishable rejection reasons:
1. `users.global_role !== 'facilitator'` → `403`, with an error message identifying "not a facilitator" as the reason.
2. An active `team_memberships` row exists for the caller and `:teamId` → `403`, with an error message identifying the cross-team constraint by name (e.g., "You cannot create a session for a team you belong to"). This message is distinguishable from condition 1's message.

Both checks read directly from the database on every request; neither may be satisfied from a client-supplied value, a cached role, or the eligible-teams list response. This holds regardless of whether the request originates from the session-creation picker UI or is submitted directly (e.g., via API call).

This constraint is evaluated only at the moment of session creation. It is not re-evaluated against a session that already exists: a facilitator subsequently acquiring an active `team_memberships` row for the team they already facilitate has no effect on that already-created session. There is no mechanism in this system that re-checks or invalidates an existing `sessions` row in response to a later `team_memberships` change. This is a statement about the session record's own continued validity and creatability, scoped to this creation-time constraint — it makes no claim about whether that facilitator may subsequently participate in or vote within the session they facilitate. Participation and voting eligibility are governed entirely by `session-participation`'s own requirements, which this change does not modify and this requirement does not speak to.

#### Scenario: Facilitator with active membership on the target team is rejected
- **WHEN** a caller with `users.global_role = 'facilitator'` and an active (`removed_at IS NULL`) `team_memberships` row for `:teamId` calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is rejected with `403`, the error identifies the cross-team constraint by name
- **AND** no session record is created

#### Scenario: Previously removed member is eligible to facilitate
- **WHEN** a caller with `users.global_role = 'facilitator'` has a `team_memberships` row for `:teamId` with `removed_at` set (a past, ended membership) and calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is permitted (subject to the other requirements in this capability)

#### Scenario: Non-facilitator caller is rejected with a distinguishable message
- **WHEN** a caller whose `users.global_role` is not `facilitator` calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is rejected with `403`, and the error message is distinguishable from the cross-team-constraint message
- **AND** no session record is created

#### Scenario: Direct API submission bypassing the picker UI is rejected identically
- **WHEN** a caller with an active `team_memberships` row for `:teamId` submits `POST /api/v1/teams/:teamId/sessions/draft` directly, without having gone through the eligible-teams picker or confirm screen
- **THEN** the request is rejected with the same `403` and the same cross-team-constraint message as the picker-driven path
- **AND** no session record is created

#### Scenario: Membership acquired after the eligible-teams list was fetched is caught at submission
- **WHEN** a caller fetches the eligible-teams list (not including `:teamId`'s exclusion, because they were not yet a member), then joins `:teamId` via a join link, then submits `POST /api/v1/teams/:teamId/sessions/draft` using the stale picker state
- **THEN** the request is rejected with `403` and the cross-team-constraint message, because the check re-reads `team_memberships` at submission time rather than trusting the earlier list

#### Scenario: A facilitator joining the facilitated team after session creation does not invalidate the existing session record
- **WHEN** a facilitator has already created a session for `:teamId` (the session exists with any status), and the facilitator subsequently acquires an active `team_memberships` row for `:teamId`
- **THEN** the existing session record remains valid and unmodified — its `status`, `facilitator_id`, and any in-progress or completed data are unchanged
- **AND** no code path re-evaluates the creation-time membership constraint against a session that already exists
- **AND** this scenario asserts only the session record's continued validity under the creation-time constraint; it makes no claim about the facilitator's eligibility to participate in or vote within that session, which is governed separately by `session-participation` and is unaffected by this change
