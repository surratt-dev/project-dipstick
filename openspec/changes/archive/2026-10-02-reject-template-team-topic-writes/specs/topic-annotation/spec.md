## MODIFIED Requirements

### Requirement: TOPIC-007 evaluates its checks in a fixed order and applies the timing floor on every exit

An unauthenticated request SHALL be rejected with `401` by the shared authentication layer before this cascade runs, as for every sibling topic endpoint. Malformed JSON and a non-UUID `teamId` SHALL follow the sibling endpoints' (TOPIC-004/005/006) existing behaviour. A `topicId` that is not a UUID SHALL be answered at the topic step with `404 TOPIC_NOT_FOUND`, never by a database error. Within the handler, TOPIC-007 SHALL evaluate in this order, returning on the first failure: (1) identity/role → `403`; (2) team existence → `404 TEAM_NOT_FOUND`; (2a) template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team, `404 TEAM_NOT_FOUND` (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) customization lock → `409 TOPIC_CUSTOMIZATION_LOCKED`; (4) request body → `422 INVALID_ANNOTATION` with `field: "annotation"`; (5) topic existence on this team → `404 TOPIC_NOT_FOUND`; (6) topic status → `422 TOPIC_ALREADY_ARCHIVED`. Every non-2xx response from the handler SHALL use the envelope `{ error: { category, code, message, correlationId } }` (plus `field` on `422 INVALID_ANNOTATION`). Every handled response, success or failure, SHALL apply `applyTimingFloor`. Every response, including the identity/role `403`s and an unhandled-error `500`, SHALL carry `Cache-Control: no-store`.

#### Scenario: A locked team's 409 takes priority over an invalid body
- **WHEN** a standing facilitator submits an over-length annotation for a team that has not completed its first session
- **THEN** the response is `409 TOPIC_CUSTOMIZATION_LOCKED`, not `422`

#### Scenario: An invalid body takes priority over a missing topic
- **WHEN** a standing facilitator submits `{ "annotation": null }` against an unlocked team for a topic ID not on that team
- **THEN** the response is `422` with `field: "annotation"`, not `404`

#### Scenario: A topic belonging to another team is not found
- **WHEN** a standing facilitator submits a valid annotation naming a topic that exists but belongs to a different team
- **THEN** the response is `404 TOPIC_NOT_FOUND`

#### Scenario: An archived topic cannot be annotated
- **WHEN** a standing facilitator submits a valid annotation for an archived topic of an unlocked team
- **THEN** the response is `422 TOPIC_ALREADY_ARCHIVED`
- **AND** the stored annotation is unchanged

#### Scenario: A non-UUID topic ID is not found
- **WHEN** a standing facilitator submits a valid annotation for an unlocked team with `topicId` `"order"`
- **THEN** the response is `404 TOPIC_NOT_FOUND`, not `500`

#### Scenario: Authorization and server failures are not cacheable
- **WHEN** a TOPIC-007 request is rejected with `403`, or fails with an unhandled `500`
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: A nonexistent team is not found
- **WHEN** a standing facilitator submits an annotation for a team ID that does not exist
- **THEN** the response is `404 TEAM_NOT_FOUND`

#### Scenario: The template team is rejected with 404 before the customization lock (tested in both lock states)
- **WHEN** a standing facilitator, with any body and any `topicId`, submits a request against `teamId = DEFAULT_TOPICS_TEAM_ID`, in either lock state
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the customization lock is not evaluated and no `topic.write_denied_locked` row is written
- **AND** exactly one `topic.write_denied_template` row is written, with `metadata.attempted_operation = "topic.annotation_updated"`
- **AND** the response matches this endpoint's own nonexistent-team `404` (see `default-topic-provisioning`)
- **AND** no topics row is modified

#### Scenario: An administrator annotating the template team receives 403, not 404
- **WHEN** an `application_admin` submits an annotation against `teamId = DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response is `403 Forbidden`, because identity/role is evaluated before the template-team step
- **AND** no `topic.write_denied_template` row is written
