## MODIFIED Requirements

### Requirement: A topic-write request against a locked team is rejected with 409 Conflict, evaluated after identity/role authorization

Any endpoint that writes to a team's topic configuration SHALL evaluate the requester's identity/role authorization (standing facilitator, not an active member of the target team) before evaluating the customization lock. A request that fails identity/role authorization SHALL be rejected with `403 Forbidden` and SHALL NOT reveal the team's lock state. A request that passes identity/role authorization but targets a team where the lock-check function returns locked SHALL be rejected with `409 Conflict`. No topic configuration change SHALL be made when either rejection occurs.

**The one exception.** `POST /api/v1/teams/:teamId/topics/assign-defaults` (see Requirement: An application administrator can assign the canonical default topics to a team with zero active topics) does not evaluate the customization lock. Its justification is its structural precondition, zero active topics on the target team, and not the caller's role. It can only ever write the canonical default set, so it permits no customization. No other topic-write endpoint is exempt, and the exemption is not configurable. The lock can be released for a team only by completing a first session, except for this recovery; the recovery itself does not release the lock.

A fixed status-code ordering alone does not close this ordering's enumeration-resistance guarantee: the shipped handler(s) SHALL also apply a constant minimum response-time floor (`applyTimingFloor`, `packages/backend/src/content/timing-oracle.ts`) at every early-return in the cascade — the `403`, the `404` team-existence check, and the `409` lock rejection alike — so that response latency does not distinguish "never going to be authorized" from "authorized but blocked by the lock" for a caller who was never going to be authorized regardless.

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

#### Scenario: Recovery does not exempt any other endpoint from the lock
- **WHEN** an application administrator has just assigned the default topics to a locked team with zero active topics, and then submits add, archive, restore, reorder and annotation requests for that team
- **THEN** each of the lock-gated requests is rejected with `409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED` (annotation as an administrator is rejected with `403` as before)
- **AND** the team's lock state is still locked

## ADDED Requirements

### Requirement: An application administrator can assign the canonical default topics to a team with zero active topics

`POST /api/v1/teams/:teamId/topics/assign-defaults` SHALL copy the canonical default topic set onto the target team when, and only when, the team has zero ACTIVE topics, and only for a caller whose `global_role` is `application_admin`. The endpoint SHALL ignore any request body and any query parameter, SHALL never accept a source team id or template id (the template is always the canonical sentinel), and no header or configuration SHALL alter its outcome. This recovers FR-8.6 ("restorable for any team at any time") for the zero-active-topic state. It is not a customization mechanism: it can write only the canonical set.

**Check order.** The endpoint SHALL evaluate, rejecting on the first failure and evaluating no later check: (1) the non-canonical `teamId` rejection (`404`, as the sibling topic-write endpoints), with the id lowercased immediately after; (2) authorization, application admin only (`403`, `NOT_AN_ADMIN`); (3) the shared topic-write rate limit (`429`/`503` exactly as the sibling endpoints; no new limit values); (4) team existence (`404`, `TEAM_NOT_FOUND`) and the template-team guard (`404`, and the `topic.write_denied_template` audit with `metadata.attempted_operation = 'topic.defaults_assigned'`); (5) NO customization-lock check; (6) inside one transaction, after taking the team's topic advisory lock, the precondition that the team has zero active topics (`409`, `TEAM_HAS_ACTIVE_TOPICS`); (7) the copy. The timing floor SHALL be applied at every return (201, 403, 404, 409, 500), as on the sibling endpoints, and the 201 and 409 SHALL carry the siblings' `Cache-Control`.

**Authorization.** The caller's role SHALL be read from the `users` row at request time (never from a role cached in the session or a token claim), so a demoted or deprovisioned administrator is refused on the next call; a caller with no user row is a non-admin. The caller SHALL be admitted if and only if `global_role = 'application_admin'`, whatever their membership on the target team (none, or any value of `team_memberships.role`), consistent with #208. A facilitator, an engineering manager, an engineer and a caller with no user row SHALL receive `403` with `error.code` `NOT_AN_ADMIN` in the standard error envelope (`{ error: { category: "forbidden", code, message, correlationId } }`), whatever the team's state and whether or not the team exists; the refusal is audited (see `audit-logging-operations`). The `403` SHALL NOT reveal the team's lock state or topic count. A facilitator is never admitted by this endpoint, so its facilitator-from-another-team rule is not engaged.

**Precondition and atomicity.** The zero-active check and the copy SHALL occur in one transaction under the same transaction-scoped topic advisory lock that the room-open snapshot takes (released on commit and on every rollback path), and the zero-active count SHALL be read by a statement issued after the lock is acquired, at READ COMMITTED isolation, so that the check cannot be invalidated between check and copy. If the team has one or more active topics the response SHALL be `409` with `error.code` `TEAM_HAS_ACTIVE_TOPICS` and nothing SHALL change. Two simultaneous calls on a team with zero active topics SHALL yield exactly one `201` and one `409`, and the team SHALL end with exactly as many active topics as the template has.

**Copy.** The topics SHALL be copied by the same routine that team creation uses, so that the result is identical to a freshly created team: the template's active topics as read inside the transaction under the lock (later template edits do not affect an assignment already made), in template display order, numbered 1 to n, each carrying the template's name, prompt, vote type and description, marked as default, with no annotation fields. A team recovered later receives the current template, not the template of its creation date. The team's existing archived rows SHALL be left untouched, and an active topic with the same text as an archived topic is acceptable, provided the all-topics listing never offers that archived topic as a restorable default (see the all-topics requirement). A team whose topics are all archived is a team with zero active topics. If the copy yields zero rows (an empty template) the transaction SHALL roll back with no topics written and the response SHALL be `500` with `error.code` `DEFAULT_TOPICS_UNAVAILABLE`. Any other failure inside the transaction (constraint drift, connection loss, audit insert failure) SHALL roll back and answer a fixed generic `500` with `error.code` `ASSIGN_DEFAULTS_FAILED`, never `DEFAULT_TOPICS_UNAVAILABLE`, with the underlying error logged and never placed in the body.

**Tenancy.** An assignment SHALL change only the target team's topics: no other team and not the template.

**Lock exception.** This endpoint is the only exception to the customization lock. The four lock-gated endpoints (add, archive, restore, reorder) are unchanged, and any further exception requires explicit product owner sign-off.

**Success.** `201` with body `{ topicCount }`, where `topicCount` is the number of topics created. The body SHALL NOT contain the topic list, topic text, or any team id other than what the caller supplied. After success the team's customization lock state SHALL be unchanged (still locked until a first session completes), and no notification SHALL be sent to anyone.

**Responses never leak.** No response SHALL include the template team id or any topic text. The `500` body SHALL be fixed in shape with a `correlationId`; the template id appears only in the server log.

| Outcome | Status / code |
|---|---|
| Success | 201 `{ topicCount }` |
| Non-admin | 403 `NOT_AN_ADMIN` |
| Template team | 404 (parity with missing team, plus `topic.write_denied_template` audit) |
| Missing team (well-formed id) | 404 `TEAM_NOT_FOUND` |
| Team has active topics | 409 `TEAM_HAS_ACTIVE_TOPICS` |
| Empty template | 500 `DEFAULT_TOPICS_UNAVAILABLE` |
| Other fault | 500 `ASSIGN_DEFAULTS_FAILED` |
| Rate limited | Shared topic-write limit, unchanged |

#### Scenario: An application admin assigns the defaults to a locked team with zero active topics
- **WHEN** an `application_admin` posts to `assign-defaults` for a locked team with zero active topics
- **THEN** the response is `201` with `{ topicCount }` equal to the number of active template topics
- **AND** the team has exactly those topics, numbered 1 to n in template order, marked default, with no annotation fields
- **AND** the team is still locked

#### Scenario: Recovered topics match the template field for field
- **WHEN** an `application_admin` assigns the defaults to a team
- **THEN** each created topic has the template's name, prompt, vote type and description, is marked default, has null annotation fields, and `display_order` 1 to n in template order

#### Scenario: Assigning on one team changes no other team
- **WHEN** an `application_admin` assigns the defaults to team A
- **THEN** no topic of any other team and no template topic changes

#### Scenario: An unlocked zero-topic team can also be assigned
- **WHEN** an `application_admin` posts to `assign-defaults` for an unlocked team with zero active topics
- **THEN** the response is `201` and the team's lock state is unchanged

#### Scenario: Team membership is irrelevant to the admin
- **WHEN** an `application_admin` who is a participant of the team, an `application_admin` who is an engineering manager of the team, an `application_admin` on another team, and an `application_admin` on no team each post to `assign-defaults` for a team with zero active topics (one fresh team each)
- **THEN** each receives `201`

#### Scenario: A non-admin is refused with NOT_AN_ADMIN whatever their relationship to the team
- **WHEN** a facilitator who is not a member of the team, a facilitator who is a member of the team, an engineering manager, and an engineer each post to `assign-defaults` for a team with zero active topics
- **THEN** each receives `403` with `error.code` `NOT_AN_ADMIN`
- **AND** no topic is written

#### Scenario: A non-admin gets 403 for a team that does not exist
- **WHEN** a facilitator posts to `assign-defaults` for a well-formed team id that names no team
- **THEN** the response is `403` with `error.code` `NOT_AN_ADMIN`, not `404`

#### Scenario: A missing team is a 404
- **WHEN** an `application_admin` posts to `assign-defaults` for a well-formed team id that names no team
- **THEN** the response is `404` with `error.code` `TEAM_NOT_FOUND`

#### Scenario: The template team is never a target
- **WHEN** an `application_admin` posts to `assign-defaults` for the template team id, in any spelling
- **THEN** the response is the same `404` the endpoint returns for a missing team, with no field that identifies the team as the template
- **AND** exactly one `topic.write_denied_template` audit row is written with `metadata.attempted_operation = 'topic.defaults_assigned'`
- **AND** the template's topics are unchanged

#### Scenario: A team with active topics is refused and unchanged
- **WHEN** an `application_admin` posts to `assign-defaults` for a team with one or more active topics, locked or not
- **THEN** the response is `409` with `error.code` `TEAM_HAS_ACTIVE_TOPICS`
- **AND** no topic is written and no `topic.defaults_assigned` audit row is written

#### Scenario: A repeated or stale request lands on the 409
- **WHEN** an `application_admin` posts to `assign-defaults` twice in succession for the same team
- **THEN** the first response is `201` and the second is `409` with `error.code` `TEAM_HAS_ACTIVE_TOPICS`, and the team has exactly the template's topic count

#### Scenario: Two simultaneous calls produce exactly one success
- **WHEN** two `application_admin` requests to `assign-defaults` for the same team with zero active topics run concurrently against a real database
- **THEN** exactly one response is `201` and the other is `409` with `error.code` `TEAM_HAS_ACTIVE_TOPICS`
- **AND** the team has exactly as many active topics as the template, with no duplicate `display_order`

#### Scenario: A team whose topics are all archived is recovered and its archive is untouched
- **WHEN** an `application_admin` posts to `assign-defaults` for a locked team that has archived topics and zero active topics
- **THEN** the response is `201`, the archived rows are unchanged, and the team has the template's active topics

#### Scenario: An empty template fails cleanly
- **WHEN** an `application_admin` posts to `assign-defaults` for a team with zero active topics and the template has no active default rows
- **THEN** the response is `500` with `error.code` `DEFAULT_TOPICS_UNAVAILABLE`, a `correlationId`, and no template id and no topic text in the body
- **AND** the transaction is rolled back: no topic and no `topic.defaults_assigned` audit row exists (the post-rollback `topic.defaults_assign_failed` row is specified in `audit-logging-operations`)
- **AND** an error-level log entry names the template team id and the correlation id

#### Scenario: An unrelated fault does not use the template-empty code
- **WHEN** an `application_admin` posts to `assign-defaults` and the copy fails with a database error other than an empty result
- **THEN** the response is `500` with `error.code` `ASSIGN_DEFAULTS_FAILED`, the transaction is rolled back, the advisory lock is released, and the body contains no database error text

#### Scenario: A rate-limited caller is limited by the shared limiter
- **WHEN** an `application_admin` exhausts the shared topic-write limit and posts to `assign-defaults`
- **THEN** the response is the same `429` or `503` the sibling topic-write endpoints return, and no new limit value is introduced

#### Scenario: The response carries no template id or topic text
- **WHEN** any request to `assign-defaults` returns any status
- **THEN** the response body and headers contain neither the template team id nor any template topic text

#### Scenario: A non-admin refusal is audited
- **WHEN** a non-admin posts to `assign-defaults`
- **THEN** the response is `403` `NOT_AN_ADMIN` and exactly one `topic.defaults_assign_denied` audit row is written (see `audit-logging-operations`)

#### Scenario: A role downgraded between login and call is refused
- **GIVEN** a user who logged in as `application_admin` and whose `users.global_role` has since been changed
- **WHEN** they post to `assign-defaults` with their still-valid session
- **THEN** the response is `403` `NOT_AN_ADMIN`

#### Scenario: A spoofed client flag changes nothing
- **WHEN** a non-admin posts to `assign-defaults` with a body or header asserting `canAssignDefaults: true`
- **THEN** the response is `403` `NOT_AN_ADMIN`

#### Scenario: No body or query field selects a source
- **WHEN** an `application_admin` posts with a body containing `templateTeamId`, `teamId` and `topics`
- **THEN** the behaviour and the topics written are identical to a request with no body

#### Scenario: Lock-gated endpoints stay gated (permanent regression test)
- **WHEN** the source test runs
- **THEN** it asserts that add, archive, restore and reorder still call `checkCustomizationLockGate` and `assign-defaults` does not

#### Scenario: An admin cannot drive a healthy locked team to zero active topics
- **GIVEN** a locked team with one active topic
- **WHEN** an administrator attempts archive, reassign, edit, delete, restore or reorder
- **THEN** no sequence results in zero active topics (`TOPIC_LAST_ACTIVE` and the lock gate hold)

#### Scenario: A blocked room open snapshots the newly assigned rows
- **GIVEN** an `/advance` waiting on the team's topic advisory lock behind an in-flight assignment
- **WHEN** the assignment commits
- **THEN** the `/advance` completes and its `session_topics` snapshot holds the assigned topics

#### Scenario: Nothing in the request alters the outcome
- **WHEN** a non-admin sends `assign-defaults` with a spurious header, query parameter and body field naming an admin or a "force" option
- **THEN** the response is still `403` with `error.code` `NOT_AN_ADMIN`

#### Scenario: Recovery sends no notification and offers no undo
- **WHEN** an `application_admin` assigns the defaults to a team
- **THEN** no event or notification is emitted to the team's facilitator or members, and no endpoint exists that reverses the assignment

#### Scenario: A draft session created before recovery snapshots the assigned topics at room open
- **WHEN** a facilitator created a draft session for a team with zero active topics, an `application_admin` then assigns the defaults, and the facilitator opens the room
- **THEN** the session opens and its `session_topics` snapshot holds the newly assigned topics

### Requirement: The all-topics endpoint tells the screen whether the caller can assign the default topics

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include a top-level `canAssignDefaults: boolean`. It SHALL be `true` if and only if all three hold: the caller's `global_role` is `application_admin`, the team has zero active topics, and the team is not the template team. In every other case it SHALL be `false` or absent, and the screen SHALL treat a missing or `false` value as "no button" (fail closed). The flag reflects authorization and state only and is not the server's enforcement: `assign-defaults` enforces its own authorization and precondition independently. The flag is computed with the same exported admin predicate the endpoint uses, so the two cannot drift. It is required in the shared response type; the frontend treats only `=== true` as true. The flag does not consider `isCustomizationLocked`, and an unlocked team with zero active topics still reports `true` for an administrator (the screen decides which control to show from the lock state: an unlocked zero-topic team shows its normal Add control, not the Assign button). Truth table over (admin, zero active topics, template team): true only for (yes, yes, no); the other seven combinations are false or absent.

#### Scenario: An admin on a team with zero active topics gets the flag
- **WHEN** an `application_admin` requests the full topic list of a non-template team with zero active topics
- **THEN** the response includes `canAssignDefaults: true`

#### Scenario: An admin on a team with active topics gets no flag
- **WHEN** an `application_admin` requests the full topic list of a team with one or more active topics
- **THEN** `canAssignDefaults` is `false` or absent

#### Scenario: A non-admin on a team with zero active topics gets no flag
- **WHEN** a standing facilitator who is not a member of a team with zero active topics requests its full topic list
- **THEN** `canAssignDefaults` is `false` or absent

#### Scenario: The template team never gets the flag
- **WHEN** an `application_admin` requests the full topic list of the template team, which has active topics, or a template whose active topics are all archived
- **THEN** `canAssignDefaults` is `false` or absent

#### Scenario: The flag follows the full truth table
- **WHEN** all eight combinations of (application admin or not) x (zero active topics or not) x (template team or not) request the full topic list
- **THEN** `canAssignDefaults` is `true` only for admin, zero active, not template, and `false` or absent for the other seven

#### Scenario: The flag clears after a successful assignment
- **WHEN** an `application_admin` assigns the defaults and then requests the full topic list again
- **THEN** the response lists the assigned topics and `canAssignDefaults` is `false` or absent

#### Scenario: The flag agrees with the endpoint
- **WHEN** each caller class requests a zero-active-topic team's full topic list and then posts to `assign-defaults`
- **THEN** `canAssignDefaults` is `true` exactly when the post does not answer `403`

### Requirement: The all-topics endpoint never lists a default as restorable when the team has an active topic of the same name

`GET /api/v1/teams/:teamId/topics/all` SHALL compute `defaultTopicsNotActive` with at most one entry per canonical default. A default for which the team has an active topic of the same name SHALL NOT appear, even if the team also has an archived topic of that name. When the team has only archived matches, the entry reports the archived match.

#### Scenario: A recovered zero-active team with an archived default lists nothing restorable
- **GIVEN** a team with zero active topics and an archived topic named like a canonical default
- **WHEN** an administrator assigns the defaults and the team's full topic list is read
- **THEN** `defaultTopicsNotActive` is empty

#### Scenario: A partially active team lists only the genuinely absent defaults
- **GIVEN** a team with an active topic and an archived topic sharing a default's name, and another default entirely absent
- **WHEN** the full topic list is read
- **THEN** `defaultTopicsNotActive` contains only the absent default
