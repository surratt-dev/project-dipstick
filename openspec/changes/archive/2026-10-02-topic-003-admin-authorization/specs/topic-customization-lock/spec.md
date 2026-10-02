## MODIFIED Requirements

### Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, matching every other topic-write endpoint it serves

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates: `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR `global_role = 'application_admin'`. (The non-member facilitator rule is shared by every topic-write endpoint; the `application_admin` arm is shared with add, `DELETE`, restore, and reorder (TOPIC-003/004/005/006) only. `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007, BRD FR-8.7) rejects administrators with `403`; this read endpoint still admits them, and returns `canEditAnnotations: false` and `canAddTopics: true`.) This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

This endpoint SHALL apply the same constant minimum response-time floor (`applyTimingFloor`) at every early-return from this authorization check (`403 Forbidden`, on either rejection reason) as every other endpoint this capability's timing-floor requirement already covers, so that response latency does not distinguish "never going to be authorized" from "authorized" for a caller probing this endpoint.

#### Scenario: A standing facilitator with no session history for the team can list its topics
- **WHEN** a facilitator who is not an active member of a team, and who has never run any session for that team, requests that team's full topic list (active and archived)
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin can list any team's topics
- **WHEN** an authenticated user with `global_role = 'application_admin'` requests a team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller who does not have `global_role = 'facilitator'` (and is not an `application_admin`), or who is an active member of the target team, requests that team's full topic list
- **THEN** the response is `403 Forbidden`

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team requests that team's full topic list
- **THEN** the response is `403 Forbidden`, even though the caller holds `global_role = 'facilitator'`

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately-measured authorized caller's request against the same endpoint is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `200` response's timing, because both apply the same minimum response-time floor

### Requirement: The all-topics endpoint tells the screen whether the caller can add a custom topic

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include a top-level `canAddTopics: boolean`. `canAddTopics` SHALL be `true` for every caller TOPIC-002 admits, that is, every non-member `facilitator` and every `application_admin`. (TOPIC-002 already rejects facilitators who are active members of the team, so the flag computes no membership of its own.) It SHALL NOT be derived from `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent.

The flag reflects authorization only and SHALL NOT be the server's enforcement: `POST /api/v1/teams/:teamId/topics` enforces its own authorization and the customization lock independently. The flag does not consider `isCustomizationLocked`; the screen combines the two.

#### Scenario: A standing facilitator can add topics
- **WHEN** a standing facilitator who is not a member of the team requests the team's full topic list
- **THEN** the response includes `canAddTopics: true`

#### Scenario: An administrator can add topics but cannot edit annotations
- **WHEN** an `application_admin` requests a team's full topic list
- **THEN** the response includes `canAddTopics: true` and `canEditAnnotations: false`
- **AND** the response still includes the full `active` and `archived` lists

#### Scenario: The flag agrees with the add endpoint's authorization for every caller class
- **WHEN** each of a non-member standing facilitator, a facilitator who is a member of the team, an `application_admin`, an `application_admin` who is a member of the team, an engineer, an engineering manager, and a caller whose session's user has no `users` row requests an unlocked team's full topic list and also sends a valid `POST /api/v1/teams/:teamId/topics` for that team
- **THEN** for every caller that the full topic list admits, `canAddTopics` is `true` exactly when the add request does not answer `403`
- **AND** every caller that the full topic list rejects also receives `403` from the add request

#### Scenario: The flag does not depend on the lock
- **WHEN** a standing facilitator requests the full topic list of a team that has not completed its first session
- **THEN** the response includes `isCustomizationLocked: true` and `canAddTopics: true`
