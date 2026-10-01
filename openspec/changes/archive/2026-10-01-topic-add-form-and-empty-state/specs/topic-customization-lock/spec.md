## ADDED Requirements

### Requirement: The all-topics endpoint tells the screen whether the caller can add a custom topic

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include a top-level `canAddTopics: boolean`. It SHALL be `true` for every caller with `global_role = 'facilitator'` that TOPIC-002 admits (TOPIC-002 already rejects facilitators who are active members of the team, so the flag computes no membership of its own) and `false` when the caller is an `application_admin`.

The `false` value for an `application_admin` is **temporary**: it mirrors TOPIC-003's current rejection of administrators, which is FR-8.2 defect **#176**. When #176 is fixed, this flag SHALL become `true` for an `application_admin` in the same change. It SHALL NOT be read as a product rule that administrators may not add topics, and it SHALL NOT be derived from or replaced by `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent and deliberate.

The flag reflects authorization only and SHALL NOT be the server's enforcement: `POST /api/v1/teams/:teamId/topics` enforces its own authorization and the customization lock independently. The flag does not consider `isCustomizationLocked`; the screen combines the two.

#### Scenario: A standing facilitator can add topics
- **WHEN** a standing facilitator who is not a member of the team requests the team's full topic list
- **THEN** the response includes `canAddTopics: true`

#### Scenario: An administrator cannot add topics while #176 is open
- **WHEN** an `application_admin` requests a team's full topic list
- **THEN** the response includes `canAddTopics: false`
- **AND** the response still includes the full `active` and `archived` lists

#### Scenario: The flag agrees with the add endpoint's authorization for every caller class
- **WHEN** each of a non-member standing facilitator, a facilitator who is a member of the team, an `application_admin`, an `application_admin` who is a member of the team, an engineer, an engineering manager, and a caller whose session's user has no `users` row requests an unlocked team's full topic list and also sends a valid `POST /api/v1/teams/:teamId/topics` for that team
- **THEN** for every caller that the full topic list admits, `canAddTopics` is `true` exactly when the add request does not answer `403`
- **AND** every caller that the full topic list rejects also receives `403` from the add request

#### Scenario: The flag does not depend on the lock
- **WHEN** a standing facilitator requests the full topic list of a team that has not completed its first session
- **THEN** the response includes `isCustomizationLocked: true` and `canAddTopics: true`
