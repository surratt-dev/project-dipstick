# topic-annotation

## Purpose

Defines the team annotation ("Our team's definition"): an optional, team-authored plain-text definition of what a topic means for that team, stored on the team's own `topics` row with provenance of its last change. This spec covers: the schema (migration `19_topics_team_annotation.sql`); `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007), including its facilitator-only authorization (application administrators excluded, BRD FR-8.7), check-ordering cascade, customization-lock gate, body validation and normalization, no-op behaviour, provenance, and text-free audit; plain-text handling; survival across archive/restore and isolation from the template team and new-team seeding; and the rule that TOPIC-001 does not return the annotation.

This spec does NOT cover: TOPIC-002's annotation fields and `canEditAnnotations` flag (see `topic-customization-lock`), the session-payload `topicAnnotation` and the `session_topics` snapshot write at room open (see `session-topic-lifecycle`), or the Topic Management screen's display and editor (see `topic-management-screen`). In-session display to participants is follow-up work (#56/#57/#62).

**Implementation note — files:** TOPIC-007 is in `packages/backend/src/routes/topics.ts` (`validateAnnotationBody`, the handler, and `toAnnotationResponse`). `MAX_ANNOTATION_LENGTH` and `normalizeAnnotation` are exported from `packages/shared/src/types/topic.ts` (`@dipstick/shared`) and imported by both the handler and `TopicManagementPage.tsx`. Real-Postgres coverage is in `packages/backend/src/routes/__tests__/topic-annotation-integration.test.ts`.

## Requirements

### Requirement: A team's topic carries an optional team annotation with editor provenance

Each `topics` row SHALL carry an optional team annotation (`team_annotation`, NULL meaning "no annotation") and provenance recording who last changed it and when (`annotation_updated_by`, `annotation_updated_at`). These columns SHALL be added by an additive, nullable migration with no default and no backfill, so every existing topic reads as having no annotation and no provenance. `annotation_updated_by` SHALL reference `users(id)` with no `ON DELETE` behaviour, following the `archived_by`/`restored_by` precedent. `session_topics` SHALL gain a nullable `topic_annotation` column. Neither table SHALL carry a length CHECK on these columns: TOPIC-007 is the single enforcement point for the 500-unit limit (a Postgres `char_length` CHECK counts code points and would be a different, looser rule), and a snapshot must always be able to hold whatever its source topic held. The migration's rollback SHALL drop exactly these four columns and nothing else.

#### Scenario: Existing topics read as unannotated after migration
- **WHEN** the migration is applied to a database with existing `topics` and `session_topics` rows
- **THEN** every existing `topics` row has `team_annotation`, `annotation_updated_by`, and `annotation_updated_at` all NULL
- **AND** every existing `session_topics` row has `topic_annotation` NULL

#### Scenario: Rollback removes only the annotation columns
- **WHEN** the migration's down step is run
- **THEN** the four annotation columns are dropped
- **AND** no other column, constraint, or index is changed

### Requirement: Only a standing Facilitator may set or clear a topic's annotation; Application Administrators are excluded

The application SHALL provide `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007). It SHALL be authorized only for a caller with `global_role = 'facilitator'` who is not an active member of the target team. A caller with `global_role = 'application_admin'` SHALL be rejected with `403 Forbidden`, even though sibling topic-write endpoints admit admins. This divergence is deliberate: the annotation is the team's words, captured by the facilitator who was in the room with them, and administrators have no session context. It is recorded as BRD FR-8.7.

#### Scenario: A standing facilitator who is not a team member can annotate
- **WHEN** a facilitator who is not an active member of an unlocked team submits a valid annotation for one of that team's active topics
- **THEN** the response is `200 OK` and the annotation is stored

#### Scenario: An application administrator is rejected
- **WHEN** a caller with `global_role = 'application_admin'` submits a valid annotation for an active topic of an unlocked team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the topic's annotation and provenance are unchanged

#### Scenario: A facilitator who is a member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team submits an annotation
- **THEN** the response is `403 Forbidden` with reason code `FACILITATOR_IS_TEAM_MEMBER`

#### Scenario: An engineer or engineering manager is rejected
- **WHEN** a caller whose `global_role` is neither `facilitator` nor `application_admin` submits an annotation
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`

### Requirement: TOPIC-007 evaluates its checks in a fixed order and applies the timing floor on every exit

An unauthenticated request SHALL be rejected with `401` by the shared authentication layer before this cascade runs, as for every sibling topic endpoint. Malformed JSON and a non-UUID `teamId` SHALL follow the sibling endpoints' (TOPIC-004/005/006) existing behaviour. A `topicId` that is not a UUID SHALL be answered at the topic step with `404 TOPIC_NOT_FOUND`, never by a database error. Within the handler, TOPIC-007 SHALL evaluate in this order, returning on the first failure: (1) identity/role → `403`; (1b) topic-write rate limit → `503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` or `429 TOPIC_WRITE_BURST_LIMIT_EXCEEDED` / `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED` (see `topic-write-rate-limiting`); (2) team existence → `404 TEAM_NOT_FOUND`; (2a) template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team, `404 TEAM_NOT_FOUND` (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) customization lock → `409 TOPIC_CUSTOMIZATION_LOCKED`; (4) request body → `422 INVALID_ANNOTATION` with `field: "annotation"`; (5) topic existence on this team → `404 TOPIC_NOT_FOUND`; (6) topic status → `422 TOPIC_ALREADY_ARCHIVED`. Every non-2xx response from the handler SHALL use the envelope `{ error: { category, code, message, correlationId } }` (plus `field` on `422 INVALID_ANNOTATION`). Every handled response, success or failure, SHALL apply `applyTimingFloor`. Every response, including the identity/role `403`s and an unhandled-error `500`, SHALL carry `Cache-Control: no-store`.

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

#### Scenario: An over-budget actor receives 429 before team existence, template, lock or body checks
- **WHEN** an authorized actor who is over the topic-write budget submits an annotation request against a nonexistent team, the template team, a locked team, or with an invalid body
- **THEN** the response is `429 Too Many Requests` with the same body in every case
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: A caller who fails authorization receives 403, never 429
- **WHEN** a caller who fails identity/role authorization submits an annotation request, however many requests that caller has made
- **THEN** the response is `403 Forbidden`

### Requirement: The first-session customization lock covers annotation

TOPIC-007 SHALL be rejected with `409 TOPIC_CUSTOMIZATION_LOCKED` for any team that has not completed a session, using the shared lock-check function and gate. Each such rejection SHALL write a `topic.write_denied_locked` audit row with `attempted_operation: "topic.annotation_updated"` before the response is sent. As a consequence, a team's first session can never carry an annotation.

#### Scenario: Annotating before the first completed session is rejected and audited
- **WHEN** a standing facilitator submits an annotation for a team with no completed session
- **THEN** the response is `409` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** an `audit_log` row with `operation = 'topic.write_denied_locked'` and `metadata.attempted_operation = 'topic.annotation_updated'` is written
- **AND** no annotation is stored

### Requirement: The annotation body is validated, normalized, and limited to 500 UTF-16 code units after trimming

The request body SHALL be an object with an `annotation` field of type string. A body that is not a JSON object (for example a bare string or an array), a missing field, a `null` value, or a non-string value SHALL be rejected with `422` and `field: "annotation"`; `null` SHALL NOT be treated as a request to clear. Unknown top-level keys SHALL be ignored. The server SHALL normalize the value by converting every `\r\n` to `\n` and then trimming leading and trailing whitespace; interior whitespace and line breaks SHALL be preserved. The normalized value SHALL be at most 500 UTF-16 code units (the JavaScript `String.length` unit, the same unit a browser `<textarea maxlength>` enforces); a longer value SHALL be rejected with `422`. A normalized value that is empty SHALL clear the annotation (store NULL). The normalized value SHALL be rejected with `422`, not stripped, if it contains U+0000, an unpaired UTF-16 surrogate, any other C0 control character except line feed and tab (U+0001–U+0008, U+000B, U+000C, U+000D, U+000E–U+001F), U+007F, or a bidirectional embedding, override, or isolate control (U+202A–U+202E, U+2066–U+2069); this check SHALL be evaluated before the length check. Characters outside this set are accepted; in particular C1 controls (U+0080–U+009F), zero-width and directional marks (U+200B–U+200F, U+061C), an interior U+FEFF, U+2028/U+2029, and Unicode tag characters (U+E0000–U+E007F) are stored as submitted. This is an accepted residual (security implementation review N1): the rejected set is the set that can make text display differently from what was typed or break storage, and widening it is a recorded follow-up product decision. The normalization rule and the 500-unit limit SHALL be defined once, as `normalizeAnnotation` and `MAX_ANNOTATION_LENGTH` exported from the shared package, and used by both TOPIC-007 and the Topic Management screen; the character-rejection rules are enforced by the server only. All body failures SHALL use code `INVALID_ANNOTATION` and `field: "annotation"`, with these exact messages: a missing, `null`, or non-string value → "annotation must be a string."; a disallowed character → "Team definition contains characters that can't be saved."; an over-length value → "Team definition must be 500 characters or fewer." No error response SHALL echo the submitted value. The screen's `maxlength` means the type and length failures are not expected from the editor in normal use; the screen shows `error.message` whenever one arrives.

#### Scenario: Exactly 500 units after trim is accepted
- **WHEN** a facilitator submits an annotation of 500 UTF-16 code units surrounded by leading and trailing spaces
- **THEN** the response is `200 OK` and the stored value is the 500-unit trimmed string

#### Scenario: 501 units after trim is rejected
- **WHEN** a facilitator submits an annotation whose trimmed value is 501 UTF-16 code units
- **THEN** the response is `422` with code `INVALID_ANNOTATION`, `field: "annotation"`, and message "Team definition must be 500 characters or fewer."
- **AND** the stored annotation is unchanged

#### Scenario: Astral characters count as two units
- **WHEN** a facilitator submits 250 emoji outside the Basic Multilingual Plane
- **THEN** the response is `200 OK`
- **AND WHEN** a facilitator submits 251 such emoji
- **THEN** the response is `422`

#### Scenario: Null is rejected rather than treated as clear
- **WHEN** a facilitator submits `{ "annotation": null }` for an annotated topic
- **THEN** the response is `422` with code `INVALID_ANNOTATION`, `field: "annotation"`, and message "annotation must be a string."
- **AND** the stored annotation is unchanged

#### Scenario: Whitespace-only input clears the annotation
- **WHEN** a facilitator submits `{ "annotation": "   \r\n  " }` for a topic whose annotation is `"X"`
- **THEN** the response is `200 OK` with `teamAnnotation: null`
- **AND** `topics.team_annotation` is NULL

#### Scenario: A NUL character is rejected, not a server error
- **WHEN** a facilitator submits an annotation containing U+0000
- **THEN** the response is `422` with code `INVALID_ANNOTATION` and message "Team definition contains characters that can't be saved."
- **AND** the stored annotation is unchanged

#### Scenario: An unpaired surrogate is rejected
- **WHEN** a facilitator submits an annotation containing a lone U+D800
- **THEN** the response is `422` with code `INVALID_ANNOTATION`
- **AND** the stored annotation is unchanged

#### Scenario: A bidirectional override is rejected
- **WHEN** a facilitator submits an annotation containing U+202E
- **THEN** the response is `422` with code `INVALID_ANNOTATION`

#### Scenario: Characters outside the rejected set are accepted
- **WHEN** a facilitator submits an annotation containing a tab or a zero-width space (U+200B)
- **THEN** the response is `200 OK` and the value is stored as submitted (after normalization)

#### Scenario: Interior line breaks are preserved and CRLF is normalized
- **WHEN** a facilitator submits `"Line one\r\nLine two"`
- **THEN** the stored value is `"Line one\nLine two"`

### Requirement: A changed annotation records provenance and returns the stored state; an unchanged one writes nothing

When the normalized value differs from the stored value, TOPIC-007 SHALL store it (or NULL when clearing) and set `annotation_updated_by` to the caller and `annotation_updated_at` to the transaction timestamp (`now()`), including when clearing. When the normalized value equals the stored value (an empty normalized value is equal to a stored NULL), TOPIC-007 SHALL return `200 OK` with the current state and SHALL NOT change provenance or write an audit row. The response SHALL be `{ topicId, teamAnnotation: string | null, annotationUpdatedAt: string | null, annotationUpdatedBy: { userId, displayName } | null }`, where `annotationUpdatedBy` is non-null only when both the editor's user ID and display name are present (TOPIC-002's rule). If the scoped `UPDATE` affects no row because the topic was archived between the in-transaction read and the write, the transaction SHALL roll back and the response SHALL be `422 TOPIC_ALREADY_ARCHIVED`, with no further lookup, mirroring TOPIC-004. Concurrent writes SHALL resolve as last-writer-wins, with no precondition token.

#### Scenario: Setting an annotation records who and when
- **WHEN** facilitator F sets the annotation of an unannotated topic to `"Our build and deploy pipeline"`
- **THEN** the response contains that `teamAnnotation`, `annotationUpdatedBy.userId` equal to F, and a non-null `annotationUpdatedAt`

#### Scenario: Clearing records the clearer as provenance
- **WHEN** facilitator G clears an annotated topic by submitting an empty string
- **THEN** `teamAnnotation` is `null`
- **AND** `annotation_updated_by` is G and `annotation_updated_at` is the write transaction's `now()`

#### Scenario: Resubmitting the stored value is a no-op
- **WHEN** facilitator G submits `"  X  "` for a topic whose stored annotation is `"X"`, last edited by F
- **THEN** the response is `200 OK` with `teamAnnotation: "X"` and `annotationUpdatedBy` still F
- **AND** no `topic.annotation_updated` audit row is written

#### Scenario: Clearing an already-empty annotation is a no-op
- **WHEN** a facilitator submits `""` for a topic whose annotation is NULL
- **THEN** the response is `200 OK` with `teamAnnotation: null`
- **AND** no audit row is written and provenance is unchanged

### Requirement: Annotation changes are audited without their text

Each changed annotation SHALL write an `audit_log` row with `operation = 'topic.annotation_updated'`, in the same transaction as the update, carrying `metadata: { topic_id, action: "set" | "cleared", length }`, where `length` is the stored value's UTF-16 length (0 when cleared). No audit metadata key, no field of the structured application-log audit event, and no error response body SHALL contain the annotation text, so neither log can serve as an annotation version history and the text stays out of stores with a different retention and access profile.

#### Scenario: Setting an annotation is audited without its text
- **WHEN** a facilitator sets an annotation to `"Pipeline speed and reliability"`
- **THEN** a `topic.annotation_updated` row is written with `metadata.action = "set"` and `metadata.length = 30`
- **AND** no metadata value contains the submitted text

#### Scenario: The text reaches neither the application log nor an error body
- **WHEN** a facilitator submits the sentinel text `"ZQX-annotation-sentinel-7781"` as a successful annotation, and separately as part of each kind of rejected body
- **THEN** no field of the emitted `topic.annotation_updated` log event contains the sentinel
- **AND** no `422` response body contains the sentinel

#### Scenario: A rejected write is not audited as an update
- **WHEN** a TOPIC-007 request is rejected at any check
- **THEN** no `topic.annotation_updated` row is written

### Requirement: Annotations are stored and returned as plain text

The application SHALL treat annotation text as plain text on every surface. It SHALL NOT interpret Markdown or HTML, and it SHALL render the text escaped with line breaks preserved.

#### Scenario: Markup round-trips as literal text
- **WHEN** a facilitator saves `<script>alert(1)</script>` as an annotation
- **THEN** TOPIC-002 returns that exact string
- **AND** the Topic Management screen displays it as literal text, with no script executed and no element created from it

### Requirement: Annotations survive archive and restore, and stay scoped to the team's own topic rows

Archiving and restoring a topic SHALL NOT change its annotation or annotation provenance. Annotating a team's copy of a default topic SHALL NOT change the template team's row or any other team's row. Default and custom topics SHALL both be annotatable. New-team seeding SHALL NOT copy any annotation or annotation provenance from the template team.

#### Scenario: Archive then restore preserves the annotation
- **WHEN** a topic is annotated `"X"`, archived, and then restored
- **THEN** TOPIC-002 returns `teamAnnotation: "X"` for that active topic, with its original provenance

#### Scenario: Annotating a team's default topic leaves the template untouched
- **WHEN** a facilitator annotates a team's copy of a default topic
- **THEN** the corresponding template-team topic's `team_annotation` is unchanged

#### Scenario: A new team never inherits an annotation
- **WHEN** a template-team topic has a non-null `team_annotation` and a new team is created
- **THEN** every topic of the new team has `team_annotation`, `annotation_updated_by`, and `annotation_updated_at` all NULL

### Requirement: The active-topics endpoint does not return the team annotation

`GET /api/v1/teams/:teamId/topics` (TOPIC-001) SHALL NOT include the team annotation or its provenance on any topic entry. TOPIC-001 has no consumer of the value, and in-session display reads only the session payload (see `session-topic-lifecycle`). TOPIC-001 now denies engineering managers, by membership role or global role (#187; see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). That denial is a precondition for ever adding the annotation, not a reason to add it now. The annotation SHALL stay off TOPIC-001 until a change introduces a real consumer of TOPIC-001. That change SHALL also convert TOPIC-001's topic entries to the contract's camelCase shape. The tripwire is the backend test "does not remap existing snake_case fields to camelCase". The consumer change has to flip that test on purpose, so it cannot add the annotation without noticing the remap.

Engineering managers do not receive the annotation from TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) either. TOPIC-002 rejects a caller whose global role is `engineering_manager`. It also rejects an `application_admin` who holds an active `engineering_manager` membership on the team, or any membership role other than `participant` (#232; see `topic-customization-lock`, Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model). The statement "engineering managers never see the team's definition" therefore holds across both topic reads, including for an administrator who manages the team.

#### Scenario: TOPIC-001 carries no annotation fields
- **WHEN** an authorized caller requests TOPIC-001 for a team whose topic is annotated `"X"`
- **THEN** no topic entry contains `teamAnnotation`, `team_annotation`, `annotationUpdatedBy`, or `annotationUpdatedAt`

#### Scenario: An engineering manager never sees the annotation through TOPIC-001
- **WHEN** an engineering manager of a team whose topic is annotated `"X"` requests TOPIC-001 for that team
- **THEN** the response is `403`
- **AND** the response body does not contain `"X"`

#### Scenario: An administrator who manages the team never sees the annotation through TOPIC-002
- **WHEN** an `application_admin` with an active `engineering_manager` membership on a team whose active topic is annotated `"X"` and whose archived topic is annotated `"Y"` requests TOPIC-002 for that team
- **THEN** the response is `403` with the message "Topic configuration for this team isn't available to its engineering manager."
- **AND** the response body contains neither `"X"` nor `"Y"`
