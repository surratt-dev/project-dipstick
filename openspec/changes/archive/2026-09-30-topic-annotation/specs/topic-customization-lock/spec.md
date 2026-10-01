## MODIFIED Requirements

### Requirement: The all-topics endpoint's response carries the team's display name, each active topic's description, and each archived topic's provenance — extensions beyond the originally-drafted contract

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include, in addition to the topic lists themselves:

- A top-level `teamName: string`, the target team's display name. Before this endpoint shipped, no endpoint reachable by a standing, non-member facilitator returned a team's display name; this field exists so the Topic Management screen's remove-confirmation dialog can name the team it is acting on (see `topic-management-screen`'s "names both the topic and the team" requirement), without a second round trip against an endpoint this contract does not otherwise specify.
- Each `active[]` entry's `firstSessionDescription: string | null`, matching the existing View Active Topic Configuration acceptance criteria ("prompt, vote type, and description" per row) so the Topic Management screen's active list is not a stripped-down name list.
- Each `archived[]` entry's `archivedAt` (the timestamp the topic transitioned to `archived`) and `archivedBy` (the archiving user's ID and display name, or `null` if unavailable — `null` only for a topic archived before the `archived_by` column existed; none exist today).
- Each `archived[]` entry's `restoredAt: string | null` and `restoredBy: { userId: string; displayName: string } | null` — set only if the topic was previously restored and subsequently archived again (i.e., it reflects the most recent restore event prior to the current archive, if one occurred); `null` for a topic that has never been restored. Added by `restore-topic`, mirroring `archivedAt`/`archivedBy`'s provenance shape rather than introducing a different one.
- Each `active[]` **and** `archived[]` entry's `teamAnnotation: string | null` (read from `topics.team_annotation`; previously hard-coded `null` on active entries and absent on archived entries), `annotationUpdatedAt: string | null`, and `annotationUpdatedBy: { userId: string; displayName: string } | null`. Added by `topic-annotation`, reusing the `archivedBy` provenance shape. Archived entries carry the annotation so the facilitator can see what will return on restore; the Topic Management screen displays it read-only on archived rows (see `topic-management-screen`), and archived entries are read-only, so this exposes nothing new.
- A top-level `canEditAnnotations: boolean`, `true` when the caller is a standing facilitator and `false` when the caller is an `application_admin`. Added by `topic-annotation` because TOPIC-007 deliberately excludes administrators while this endpoint admits them; the flag lets the screen avoid offering a control that would only return `403`. It reflects authorization only and SHALL NOT be the server's enforcement — TOPIC-007 enforces independently. Administrators SHALL still receive the annotation fields read-only: topic configuration is administrative data they already read, and TOPIC-007's administrator exclusion concerns who authors the team's words, not who may view the configuration.

None of the first three fields were present in this endpoint's originally-drafted response contract; each was added to close a gap the Topic Management screen's own stated requirements exposed once that screen was actually built against this endpoint. `restoredAt`/`restoredBy` were added by `restore-topic` for the same reason, on the same footing: a strict subset of what the standing, org-wide facilitator model already discloses to this caller — the full topic list and content of a team they are, by design, trusted to read and archive from and restore to — not a new category of disclosure, and none of these fields is personal data about an individual beyond a facilitator's own display name, which is already visible org-wide in other bounded contexts (e.g., team membership screens). The `archivedBy`/`archivedAt` and `restoredBy`/`restoredAt` pairs are a facilitator-facing read path, distinct from and in addition to any audit-log record of the same events — a facilitator viewing this endpoint's response SHALL NOT need to consult the audit log to determine who archived or restored a topic, or when. The same holds for `annotationUpdatedBy`/`annotationUpdatedAt`.

**Implementation note — `defaultTopicsNotActive`:** The response also includes a top-level `defaultTopicsNotActive: Array<{ topicId, name, isArchived }>`, listing the team's canonical default topics that are not currently in the `active` list. This field was part of the originally-drafted TOPIC-002 contract and is correctly computed by this endpoint's query. It remains unread by this endpoint's current consumers (`topic-management-screen`'s active and archived lists are both driven by `active[]`/`archived[]` directly); it is documented here only so its presence in the response shape is not mistaken for an unspecified or accidental field.

#### Scenario: The response includes the team's display name
- **WHEN** a standing facilitator requests a team's full topic list
- **THEN** the response includes a top-level `teamName` matching the target team's display name

#### Scenario: An active topic's entry includes its first-session description
- **WHEN** a standing facilitator requests a team's full topic list, and one of its active topics has a non-null description
- **THEN** the corresponding entry in the `active` array includes `firstSessionDescription` matching that topic's stored description

#### Scenario: An archived topic's entry includes who archived it and when
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic
- **THEN** the corresponding entry in the `archived` array includes `archivedAt` matching the time it was archived
- **AND** includes `archivedBy` with the archiving user's ID and display name

#### Scenario: An archived topic that was previously restored and re-archived includes its most recent restore provenance
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic that was restored at some point before its current archive
- **THEN** the corresponding entry in the `archived` array includes `restoredAt` and `restoredBy` reflecting that most recent restore event

#### Scenario: An archived topic that has never been restored has null restore provenance
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic that has never been restored
- **THEN** the corresponding entry's `restoredAt` and `restoredBy` are both `null`

#### Scenario: An annotated active topic returns its annotation and provenance
- **WHEN** a standing facilitator requests a team's full topic list, and an active topic was annotated `"X"` by facilitator F
- **THEN** that `active` entry includes `teamAnnotation: "X"`, `annotationUpdatedBy` with F's ID and display name, and a non-null `annotationUpdatedAt`

#### Scenario: An unannotated topic returns null annotation fields
- **WHEN** a standing facilitator requests a team's full topic list, and an active topic has never been annotated
- **THEN** that entry's `teamAnnotation`, `annotationUpdatedAt`, and `annotationUpdatedBy` are all `null`

#### Scenario: An archived topic returns its annotation
- **WHEN** a standing facilitator requests a team's full topic list, and an archived topic carries annotation `"X"`
- **THEN** that `archived` entry includes `teamAnnotation: "X"`

#### Scenario: The edit flag distinguishes facilitators from administrators
- **WHEN** a standing facilitator requests a team's full topic list
- **THEN** `canEditAnnotations` is `true`
- **AND WHEN** an `application_admin` requests the same list
- **THEN** `canEditAnnotations` is `false`

#### Scenario: An administrator can read annotations and provenance
- **WHEN** an `application_admin` requests a team's full topic list, and an active topic was annotated `"X"` by facilitator F
- **THEN** that `active` entry includes `teamAnnotation: "X"` and `annotationUpdatedBy` with F's ID and display name
