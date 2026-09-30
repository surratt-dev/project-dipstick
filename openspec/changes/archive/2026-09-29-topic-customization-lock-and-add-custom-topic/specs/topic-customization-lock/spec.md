## ADDED Requirements

### Requirement: A single reusable function computes whether a team's topic configuration is customizable

The application SHALL provide one reusable, named server-side function that determines whether a team's topic configuration is customizable ("unlocked"). The function SHALL evaluate to unlocked if and only if the team has at least one session with `status = 'complete'`, and locked otherwise. This function SHALL execute a live database read on every call; its result MUST NOT be cached at any layer, in memory, in the session, or otherwise. No other code path SHALL independently query `sessions.status = 'complete'` to answer this question — every consumer of the lock state, on both the read side and the write side, SHALL call this same function.

#### Scenario: A team with zero completed sessions is locked
- **WHEN** the lock-check function is called for a team that has never had a session reach `status = 'complete'`
- **THEN** the function returns locked (customization not permitted)

#### Scenario: A team with at least one completed session is unlocked
- **WHEN** the lock-check function is called for a team that has at least one session with `status = 'complete'`
- **THEN** the function returns unlocked (customization permitted)

#### Scenario: A session that was started but abandoned does not count toward unlocking
- **WHEN** the lock-check function is called for a team whose only session exists but has a status other than `complete` (e.g., abandoned, in progress)
- **THEN** the function returns locked

#### Scenario: The lock state is read live, not from a cache
- **WHEN** a team's first session transitions to `status = 'complete'`
- **THEN** the very next call to the lock-check function for that team returns unlocked, with no caching delay at any layer

### Requirement: The active-topics response exposes the team's customization lock state

`GET /api/v1/teams/:teamId/topics` SHALL include an `isCustomizationLocked` boolean field in its response body, computed via the shared lock-check function. This field SHALL be present on every successful response from this endpoint, regardless of the requesting user's role.

#### Scenario: Locked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with zero completed sessions
- **THEN** the response includes `isCustomizationLocked: true` alongside the topic list

#### Scenario: Unlocked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with at least one completed session
- **THEN** the response includes `isCustomizationLocked: false` alongside the topic list

### Requirement: A topic-write request against a locked team is rejected with 409 Conflict, evaluated after identity/role authorization

Any endpoint that writes to a team's topic configuration SHALL evaluate the requester's identity/role authorization (standing facilitator, not an active member of the target team) before evaluating the customization lock. A request that fails identity/role authorization SHALL be rejected with `403 Forbidden` and SHALL NOT reveal the team's lock state. A request that passes identity/role authorization but targets a team where the lock-check function returns locked SHALL be rejected with `409 Conflict`. No topic configuration change SHALL be made when either rejection occurs.

A fixed status-code ordering alone does not close this ordering's enumeration-resistance guarantee: the shipped handler(s) SHALL also apply a constant minimum response-time floor (`applyTimingFloor`, `packages/backend/src/content/timing-oracle.ts`) at every early-return in the cascade — the `403`, the `404` team-existence check, and the `409` lock rejection alike — so that response latency does not distinguish "never going to be authorized" from "authorized but blocked by the lock" for a caller who was never going to be authorized regardless (design.md Decision 9's security-review amendment).

#### Scenario: A caller who fails identity/role authorization receives a response no faster than an authorized-but-locked caller's
- **WHEN** a caller who fails identity/role authorization submits a topic-write request, and a separately-measured standing facilitator's request against a locked team is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `409` response's timing, because both apply the same minimum response-time floor

#### Scenario: An otherwise-authorized facilitator is rejected with 409 when the team is locked
- **WHEN** a standing facilitator who is not a member of the target team submits a topic-write request against a team with zero completed sessions
- **THEN** the request is rejected with `409 Conflict`
- **AND** no topic configuration change is made

#### Scenario: A caller who fails identity/role authorization receives 403 regardless of the team's lock state
- **WHEN** a caller who is not a facilitator, or who is an active member of the target team, submits a topic-write request against that team
- **THEN** the request is rejected with `403 Forbidden`
- **AND** the response does not reveal whether the team is locked or unlocked

#### Scenario: A direct API call bypassing the UI is rejected identically to a UI-originated call
- **WHEN** a topic-write request is submitted directly against the API for a locked team, without going through any client UI
- **THEN** the request is rejected with `409 Conflict` under the same rule as any other caller
- **AND** no topic configuration change is made

### Requirement: The lock-rejection response body carries a machine-readable reason code and a stable message, nested in the standard error envelope

Every rejected topic-write request SHALL return this codebase's standard error envelope, `{ error: { category, code, message, correlationId } }` — the same shape `teams.ts`'s `GLOBAL_ROLE_PRECONDITION_NOT_MET`/`TEAM006_BURST_LIMIT_EXCEEDED` responses already use — not a bare top-level `{ code, message }` body. `error.code` SHALL distinguish the specific rejection cause: `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER` (both `error.category: "forbidden"`), or `TOPIC_CUSTOMIZATION_LOCKED` (`error.category: "precondition_failed"`). For `TOPIC_CUSTOMIZATION_LOCKED` specifically, `error.message` SHALL be the fixed literal string `"Topics cannot be customized until this team's first session is completed."`, not per-request or client-generated text. `error.correlationId` SHALL be present on every rejection, as it is on every other error response in this codebase.

#### Scenario: A lock rejection carries the stable reason code and message, nested under error
- **WHEN** a topic-write request is rejected because the team's customization lock is active
- **THEN** the response body includes `error.code: "TOPIC_CUSTOMIZATION_LOCKED"`, `error.category: "precondition_failed"`, and `error.message: "Topics cannot be customized until this team's first session is completed."`

#### Scenario: A non-facilitator rejection carries a distinct reason code
- **WHEN** a topic-write request is rejected because the caller does not have `global_role = 'facilitator'`
- **THEN** the response body includes `error.code: "NOT_A_FACILITATOR"` and `error.category: "forbidden"`, distinct from the lock rejection's code and category

#### Scenario: A same-team-member facilitator rejection carries a distinct reason code
- **WHEN** a topic-write request is rejected because the caller is a facilitator but is an active member of the target team
- **THEN** the response body includes `error.code: "FACILITATOR_IS_TEAM_MEMBER"` and `error.category: "forbidden"`, distinct from the lock rejection's code

### Requirement: Every request denied under the customization lock is audited before the response is sent

Every topic-write request rejected with `409 Conflict` under the customization lock SHALL result in a synchronous `audit_log` row (`operation = 'topic.write_denied_locked'`) written before the rejection response is sent to the caller. The audit row SHALL include the actor's user ID, global role, and IP address; the target team ID; and metadata identifying the endpoint and attempted operation.

#### Scenario: A denied lock-bypass attempt is recorded in the audit log before the caller receives the response
- **WHEN** a topic-write request is rejected with `409 Conflict` under the customization lock
- **THEN** an `audit_log` row with `operation = 'topic.write_denied_locked'` is written to the database
- **AND** that write completes before the `409` response is sent to the caller

#### Scenario: Denied attempts against different endpoints all use the same audit operation
- **WHEN** requests to two different topic-write endpoints are each rejected under the customization lock
- **THEN** both rejections write an `audit_log` row with `operation = 'topic.write_denied_locked'`, distinguished from each other only by their metadata (e.g., endpoint identifier), not by a different operation name
