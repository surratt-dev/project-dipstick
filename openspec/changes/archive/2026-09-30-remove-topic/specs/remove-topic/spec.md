## ADDED Requirements

### Requirement: A standing facilitator or an application administrator can archive an active topic on an unlocked team

`DELETE /api/v1/teams/:teamId/topics/:topicId` SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to transition that team's topic from `active` to `archived`, provided the team's customization lock (per the `topic-customization-lock` capability) is not active. This is a soft-delete: `topics.status` transitions to `archived` and `topics.archived_at`/`topics.archived_by` are set; no row is deleted, and no `votes` or `session_topics` record is modified.

#### Scenario: A valid request archives an active topic
- **WHEN** a standing facilitator who is not a member of the team submits a request to archive one of two or more active topics on an unlocked team
- **THEN** the response is `200 OK` with `status: 'archived'` and `archivedAt`
- **AND** the topic's `status` is `archived` in the database
- **AND** the topic no longer appears in future session snapshots

#### Scenario: An application administrator can archive a topic for any team
- **WHEN** an authenticated user with `global_role = 'application_admin'` submits a request to archive an active topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'archived'` and `archivedAt`
- **AND** this succeeds regardless of whether the admin is also an active member of the target team

#### Scenario: Historical vote data is preserved after archiving
- **WHEN** a topic with existing `votes` and `session_topics` records from past sessions is archived
- **THEN** those `votes` and `session_topics` records are unchanged
- **AND** the topic's historical data remains accessible in trend views

#### Scenario: An in-progress session is unaffected by a concurrent archive
- **WHEN** a topic is archived while a session that already includes it in its `session_topics` snapshot is in progress
- **THEN** the in-progress session's topic sequence is unchanged
- **AND** the archived topic still appears normally for the remainder of that session

### Requirement: Archive Topic evaluates checks in a fixed order — identity/role, team existence, lock, topic existence, topic status, then the last-active-topic guard

`DELETE /api/v1/teams/:teamId/topics/:topicId` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization — the caller satisfies (`global_role = 'facilitator'` AND not an active member of the target team) OR `global_role = 'application_admin'` (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` is exempt from both the role and the membership sub-check); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) topic existence and ownership — the `topicId` path parameter references a row belonging to the target team (`404 Not Found`, `TOPIC_NOT_FOUND`); (5) topic status — the topic is currently `active` (`422 Unprocessable Entity`, `TOPIC_ALREADY_ARCHIVED`); (6) the last-active-topic guard (`409 Conflict`, `TOPIC_LAST_ACTIVE` — see the dedicated requirement below). The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus both `200` outcomes (with and without `requiresConfirmation`), so this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences.

#### Scenario: A non-facilitator, non-admin caller receives 403 regardless of team or topic state
- **WHEN** a caller without `global_role = 'facilitator'` and without `global_role = 'application_admin'` submits a request against any `teamId`/`topicId` combination
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal whether the team or topic exists, is locked, or is already archived

#### Scenario: An application administrator is exempt from the team-membership check
- **WHEN** an authenticated user with `global_role = 'application_admin'` who is also an active member of the target team submits a request to archive one of that team's active topics on an unlocked team
- **THEN** the request is not rejected at the identity/role check
- **AND** it proceeds to the remaining checks in the cascade (team existence, lock, topic existence, topic status, last-active-topic guard) as normal

#### Scenario: A request against a nonexistent team is rejected with 404 before the lock or topic are evaluated
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`

#### Scenario: A locked team's rejection takes priority over topic-specific state
- **WHEN** a standing facilitator who is not a member of the target team submits a request against a team with zero completed sessions, for a `topicId` that is already archived
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not reveal the topic's status

#### Scenario: A nonexistent topic is rejected with 404 after the lock passes
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a `topicId` that does not belong to that team
- **THEN** the response is `404 Not Found` with reason code `TOPIC_NOT_FOUND`

#### Scenario: An already-archived topic is rejected with 422
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a topic whose status is already `archived`
- **THEN** the response is `422 Unprocessable Entity` with reason code `TOPIC_ALREADY_ARCHIVED`
- **AND** the topic's state is unchanged

#### Scenario: An already-archived topic's rejection takes priority over the last-active-topic guard
- **WHEN** a request targets a topic that is already archived, and archiving it (were it active) would also have left the team with zero active topics
- **THEN** the response is `422 Unprocessable Entity` with reason code `TOPIC_ALREADY_ARCHIVED`, not `409 Conflict` with `TOPIC_LAST_ACTIVE`

### Requirement: Archiving a team's last active topic is rejected with a hard 409 block

`DELETE /api/v1/teams/:teamId/topics/:topicId` SHALL reject a request with `409 Conflict` and reason code `TOPIC_LAST_ACTIVE` if archiving the target topic would leave the team with zero active topics. No topic status change SHALL occur when this rejection is returned. This check and the archive transition SHALL be serialized per team (e.g., via a per-team advisory transaction lock taken before the active-topic count is read) so that two or more concurrent archive requests against the same team can never together leave that team with zero active topics, even when each request individually targets a different topic and each would be permitted in isolation.

#### Scenario: Archiving the only remaining active topic is blocked
- **WHEN** a standing facilitator who is not a member of the target team submits a request to archive a team's sole remaining active topic
- **THEN** the response is `409 Conflict` with reason code `TOPIC_LAST_ACTIVE`
- **AND** the topic's status remains `active`

#### Scenario: Archiving one of several active topics succeeds
- **WHEN** a standing facilitator who is not a member of the target team submits a request to archive one topic on a team with three active topics
- **THEN** the response is `200 OK` with `status: 'archived'`
- **AND** the team retains two active topics

#### Scenario: Two concurrent requests against a team's last two active topics never both succeed
- **WHEN** two archive requests, each targeting a different one of a team's exactly two active topics, are submitted concurrently
- **THEN** exactly one request succeeds with `200 OK`
- **AND** the other is rejected with `409 Conflict` and reason code `TOPIC_LAST_ACTIVE`
- **AND** the team retains at least one active topic at all times

### Requirement: Archiving a topic with open action items requires explicit confirmation

`DELETE /api/v1/teams/:teamId/topics/:topicId` SHALL, when the target topic has one or more open action items (across all sessions the topic has ever appeared in) and the request does not include `confirm=true`, respond `200 OK` with `requiresConfirmation: true`, `reason: 'openActionItems'`, the open action item count, and the list of open action items (at minimum each item's identifier and description) — without archiving the topic. A subsequent request for the same topic including `confirm=true` SHALL independently re-compute the open-action-item count and list at the time of that request — it SHALL NOT rely on any count or list value supplied by, or previously shown to, the caller — and SHALL proceed to archive the topic regardless of whether the recomputed count differs from what was previously shown.

#### Scenario: A topic with open action items returns a confirmation-required response without archiving
- **WHEN** a standing facilitator submits a request to archive an active topic that has two open action items, without `confirm=true`
- **THEN** the response is `200 OK` with `requiresConfirmation: true`, `openActionItemCount: 2`, and an `openActionItems` array containing both items' identifiers and descriptions
- **AND** the topic's status remains `active`

#### Scenario: A topic with no open action items archives immediately without requiring confirmation
- **WHEN** a standing facilitator submits a request to archive an active topic that has zero open action items
- **THEN** the response is `200 OK` with `status: 'archived'`, not a `requiresConfirmation` response

#### Scenario: A confirmed request archives the topic
- **WHEN** a standing facilitator submits a request with `confirm=true` for a topic that has open action items
- **THEN** the response is `200 OK` with `status: 'archived'`

#### Scenario: The confirming request re-derives the open-action-item state rather than trusting a prior value
- **WHEN** a topic had two open action items when a facilitator first requested archiving it, one of those items is resolved before the facilitator submits a second request with `confirm=true`, and the second request is otherwise unmodified
- **THEN** the archive proceeds successfully
- **AND** no part of the archive's outcome depends on the count or list shown in the first response

### Requirement: A successful archive sets provenance and is audited in the same transaction

Every accepted `DELETE /api/v1/teams/:teamId/topics/:topicId` request SHALL, in the same database transaction, set `topics.archived_at` to the current time, set `topics.archived_by` to the acting user's ID, and write a row to `audit_log` (`operation = 'topic.archived'`) carrying `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum the archived topic's `topic_id` and the open-action-item count determined for that request (`openActionItemCount`, per the open-action-item requirement above — the count independently derived server-side, never a client-supplied value). A request rejected under the customization lock SHALL be audited via the same shared `operation = 'topic.write_denied_locked'` event this capability's write endpoints already use for lock denials, not a new per-endpoint operation name.

#### Scenario: A successful archive records who and when
- **WHEN** a standing facilitator successfully archives a topic
- **THEN** the topic's `archivedAt` matches the transaction's commit time and `archivedBy` matches the acting facilitator's user ID
- **AND** an `audit_log` row with `operation = 'topic.archived'` and matching `team_id`/`metadata.topic_id` is written in the same transaction

#### Scenario: A confirmed archive's audit row records the server-derived open-action-item count
- **WHEN** a facilitator submits a `confirm=true` request to archive a topic, and the server independently re-derives the topic's current open-action-item count as part of evaluating that request
- **THEN** the resulting `audit_log` row's `metadata.openActionItemCount` matches the server's freshly re-derived count at the time of that request, not any count previously shown to the caller

#### Scenario: A lock-denied archive attempt is audited under the shared denial operation
- **WHEN** an archive request is rejected with `409 Conflict` under the customization lock
- **THEN** an `audit_log` row with `operation = 'topic.write_denied_locked'` is written before the response is sent
- **AND** no `audit_log` row with `operation = 'topic.archived'` is written

#### Scenario: A rejected request other than a lock denial writes no archive audit row
- **WHEN** an archive request is rejected by identity/role, team existence, topic existence, topic status, or the last-active-topic guard
- **THEN** no `audit_log` row with `operation = 'topic.archived'` is written
- **AND** the topic's `archived_at`/`archived_by` remain unset
