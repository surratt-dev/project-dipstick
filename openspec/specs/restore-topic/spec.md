# restore-topic

## Purpose

Defines `POST /api/v1/teams/:teamId/topics/:topicId/restore` (TOPIC-005) — the inverse of `remove-topic`'s archive transition. Covers authorization (the standing, org-wide facilitator-or-admin model shared with TOPIC-004; TOPIC-002 shares the facilitator side but adds a no-manager rule to its admin side, #232), the check-ordering cascade, the advisory-lock-guarded append-position reposition, provenance (`restored_by`/`restored_at`, and preservation of `archived_at`/`archived_by`), and audit posture.

This spec does NOT cover the frontend restore action or its confirmation dialog (see `topic-management-screen`). It also does not cover a trend-view gap signal — that work is deferred to a separate follow-up change and is not part of this capability.

---

## Requirements

### Requirement: A standing facilitator or an application administrator can restore an archived topic on an unlocked team

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to transition that team's topic from `archived` to `active`, provided the team's customization lock (per the `topic-customization-lock` capability) is not active. The topic SHALL be appended at the end of the team's current active display order — its prior `display_order` position is not restored. No `votes` or `session_topics` record is modified by this transition.

#### Scenario: A valid request restores an archived topic
- **WHEN** a standing facilitator who is not a member of the team submits a request to restore an archived topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'active'`, a `displayOrder` at the end of the team's current active order, and `restoredAt`
- **AND** the topic's `status` is `active` in the database

#### Scenario: An application administrator can restore a topic for any team
- **WHEN** an authenticated user with `global_role = 'application_admin'` submits a request to restore an archived topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'active'`
- **AND** this succeeds regardless of whether the admin is also an active member of the target team

#### Scenario: A restored topic is appended, not returned to its prior position
- **WHEN** a topic that was at `displayOrder` 2 before being archived is restored to a team that currently has three active topics at positions 1, 3, and 4
- **THEN** the restored topic's `displayOrder` is 5, not 2

#### Scenario: A restored topic's historical vote data remains accessible
- **WHEN** a topic with existing `votes` and `session_topics` records from before it was archived is restored
- **THEN** those `votes` and `session_topics` records are unchanged and remain accessible

#### Scenario: A restored topic is included in the next room-open snapshot
- **WHEN** a topic's `status` transitions to `active` via a successful restore, and the team's next session then reaches room open (see `session-topic-lifecycle`)
- **THEN** that session's `session_topics` rows include the restored topic, with no restore-specific flag, field, or exclusion distinguishing it from any other active topic

#### Scenario: A topic archived and restored during the draft lands at its appended position
- **WHEN** a team's session is in `draft`, the facilitator archives a topic and then restores it, and then opens the room
- **THEN** the restored topic is in the session's snapshot, positioned after every topic that was active when it was restored, because restore appended it to the end of the active order

### Requirement: Restore Topic evaluates checks in a fixed order — identity/role, team existence, lock, topic existence, then topic status

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization — the caller satisfies (`global_role = 'facilitator'` AND not an active member of the target team) OR `global_role = 'application_admin'` (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` is exempt from both the role and the membership sub-check); (1b) the topic-write rate limit (`503 Service Unavailable`, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, or `429 Too Many Requests`, `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED`; see `topic-write-rate-limiting`); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (2a) the template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team (`404 Not Found`, `TEAM_NOT_FOUND`) (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) topic existence and ownership — the `topicId` path parameter references a row belonging to the target team (`404 Not Found`, `TOPIC_NOT_FOUND`; a `topicId` that is not a canonical UUID SHALL be answered here with this same `404` without any query, never with a `5xx`); (5) topic status — the topic is currently `archived` (`422 Unprocessable Entity`, `TOPIC_ALREADY_ACTIVE`). The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the rate-limit `429` and `503` returns and the `200` success outcome, so this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences.

#### Scenario: A non-facilitator, non-admin caller receives 403 regardless of team or topic state
- **WHEN** a caller without `global_role = 'facilitator'` and without `global_role = 'application_admin'` submits a request against any `teamId`/`topicId` combination
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal whether the team or topic exists, is locked, or is already active

#### Scenario: An application administrator is exempt from the team-membership check
- **WHEN** an authenticated user with `global_role = 'application_admin'` who is also an active member of the target team submits a request to restore one of that team's archived topics on an unlocked team
- **THEN** the request is not rejected at the identity/role check
- **AND** it proceeds to the remaining checks in the cascade (team existence, template team, lock, topic existence, topic status) as normal

#### Scenario: A request against a nonexistent team is rejected with 404 before the lock or topic are evaluated
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`

#### Scenario: A locked team's rejection takes priority over topic-specific state
- **WHEN** a standing facilitator who is not a member of the target team submits a request against a team with zero completed sessions, for a `topicId` that is already active
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not reveal the topic's status

#### Scenario: A nonexistent topic is rejected with 404 after the lock passes
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a `topicId` that does not belong to that team
- **THEN** the response is `404 Not Found` with reason code `TOPIC_NOT_FOUND`

#### Scenario: An already-active topic is rejected with 422
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a topic whose status is already `active`
- **THEN** the response is `422 Unprocessable Entity` with reason code `TOPIC_ALREADY_ACTIVE`
- **AND** the topic's state is unchanged

#### Scenario: The template team is rejected with 404 before the customization lock (tested in both lock states)
- **WHEN** a standing facilitator or an `application_admin`, naming any `topicId`, submits a request against `teamId = DEFAULT_TOPICS_TEAM_ID`, in either lock state
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the customization lock is not evaluated and no `topic.write_denied_locked` row is written
- **AND** exactly one `topic.write_denied_template` row is written, with `metadata.attempted_operation = "topic.restored"`
- **AND** the response matches this endpoint's own nonexistent-team `404` (see `default-topic-provisioning`)
- **AND** no topics row is modified

#### Scenario: An over-budget actor receives 429 before team existence, template, lock or body checks
- **WHEN** an authorized actor who is over the topic-write budget submits a restore request against a nonexistent team, the template team, a locked team, or with a non-canonical or nonexistent `topicId`
- **THEN** the response is `429 Too Many Requests` with the same body in every case
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: A caller who fails authorization receives 403, never 429
- **WHEN** a caller who fails identity/role authorization submits a restore request, however many requests that caller has made
- **THEN** the response is `403 Forbidden`

#### Scenario: A malformed topicId is answered 404 without a query
- **WHEN** an authorized actor on an existing, unlocked team submits a restore request whose `topicId` is not a canonical UUID
- **THEN** the response is `404 Not Found` with reason code `TOPIC_NOT_FOUND`, not `500`
- **AND** no query against `topics` is issued for that `topicId`

### Requirement: The append-position assignment is serialized per team, closing the same race TOPIC-003 and TOPIC-004 already guard against

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL compute the restored topic's new `display_order` as one greater than the team's current maximum active `display_order`, and SHALL serialize this computation and the status-transition write against concurrent writes to the same team's topics (e.g., via a per-team advisory transaction lock, taken before the maximum is read) so that two or more concurrent requests that each append a topic to the same team's active order — whether both are restores, or one is a restore and one is a new custom topic via `POST /topics` — never compute and write the same `display_order` value.

#### Scenario: Restoring a topic to a team with existing active topics appends at the end
- **WHEN** a standing facilitator restores an archived topic for a team that currently has three active topics
- **THEN** the restored topic's `displayOrder` is one greater than the highest existing active topic's `displayOrder`

#### Scenario: Two concurrent restores against the same team never compute the same position
- **WHEN** two restore requests, each targeting a different archived topic of the same team, are submitted concurrently
- **THEN** both requests succeed
- **AND** the two restored topics are assigned distinct `displayOrder` values

#### Scenario: A concurrent restore and a concurrent custom-topic addition never compute the same position
- **WHEN** a restore request and a `POST /api/v1/teams/:teamId/topics` request targeting the same team are submitted concurrently
- **THEN** both requests succeed
- **AND** the restored topic and the newly added topic are assigned distinct `displayOrder` values

### Requirement: A successful restore preserves prior archive provenance and sets its own provenance, audited in the same transaction

Every accepted `POST /api/v1/teams/:teamId/topics/:topicId/restore` request SHALL, in the same database transaction, set `topics.restored_at` to the current time and `topics.restored_by` to the acting user's ID, SHALL leave `topics.archived_at` and `topics.archived_by` unchanged from their prior values, and SHALL write a row to `audit_log` (`operation = 'topic.restored'`) carrying `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum the restored topic's `topic_id`. A request rejected under the customization lock SHALL be audited via the same shared `operation = 'topic.write_denied_locked'` event this capability's sibling write endpoints already use for lock denials, not a new per-endpoint operation name.

#### Scenario: A successful restore records who and when, without disturbing archive provenance
- **WHEN** a standing facilitator successfully restores a topic that was previously archived by a different user
- **THEN** the topic's `restoredAt` matches the transaction's commit time and `restoredBy` matches the acting facilitator's user ID
- **AND** the topic's `archivedAt`/`archivedBy`, from the prior archive, are unchanged
- **AND** an `audit_log` row with `operation = 'topic.restored'` and matching `team_id`/`metadata.topic_id` is written in the same transaction

#### Scenario: A lock-denied restore attempt is audited under the shared denial operation
- **WHEN** a restore request is rejected with `409 Conflict` under the customization lock
- **THEN** an `audit_log` row with `operation = 'topic.write_denied_locked'` is written before the response is sent
- **AND** no `audit_log` row with `operation = 'topic.restored'` is written

#### Scenario: A rejected request other than a lock denial writes no restore audit row
- **WHEN** a restore request is rejected by identity/role, team existence, topic existence, or topic status
- **THEN** no `audit_log` row with `operation = 'topic.restored'` is written
- **AND** the topic's `restored_at`/`restored_by` remain unset
