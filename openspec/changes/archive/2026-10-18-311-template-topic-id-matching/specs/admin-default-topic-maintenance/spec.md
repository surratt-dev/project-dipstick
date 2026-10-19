## ADDED Requirements

### Requirement: The rename notice states that existing teams keep their own copy

The `notice` on a successful template rename SHALL equal the constant `RENAME_NOTICE`, whose text is exactly:

> Renamed. Existing teams keep their own copy of this topic under its current name. The rename does not change any team's topics. Teams that never had this topic will see the new name.

(one "Renamed." lead plus three sentences, one fact each; the wording may change only by Facilitator (Priya Nair) sign-off before merge, and the test pins the final constant). The notice SHALL NOT contain, case-insensitively, "stop matching", "name-based", "no longer", "match" or "pair". The scope statement and the rest of the response are unchanged. Only the admin maintenance surface and its docs reference the notice.

#### Scenario: A rename returns the pinned notice
- **WHEN** an administrator renames an active template default
- **THEN** the response `notice` equals `RENAME_NOTICE` and contains none of the forbidden phrases
- **AND** the REST API Contract, the deployment runbook and use case 08 state the same facts

#### Scenario: A rename does not touch any team
- **GIVEN** teams holding linked copies of the renamed default
- **WHEN** the rename is committed
- **THEN** no team topic row, link, session snapshot or team audit row changes

## MODIFIED Requirements

### Requirement: Add, edit, archive, restore and reorder have fixed semantics

**Add** SHALL create an active, `is_default = true` row at the position after the highest active position (N+1 on a healthy template), and add, archive and restore SHALL leave the active rows dense 1..N so that pre-existing gaps are repaired by normal use; every write SHALL set `updated_at` on each row it touches. Add requires `name`, `prompt`, `voteType`, `firstSessionDescription`; it SHALL never create a row with `is_default = false`. **Edit** (`PATCH`) SHALL accept `name`, `prompt` and `firstSessionDescription`; `voteType` is fixed at creation: a different value SHALL be `422 DEFAULT_VOTE_TYPE_IMMUTABLE` and an equal value SHALL be ignored; editing an archived default SHALL be `409 DEFAULT_ARCHIVED`. A rename response SHALL carry a `notice` equal to the constant `RENAME_NOTICE` (see "The rename notice states that existing teams keep their own copy"). An edit is a **no-op** when, after trim, every supplied editable field (`name`, `prompt`, `firstSessionDescription`) equals the stored value byte for byte (case and internal whitespace count; no normalization); it SHALL return `200` with the unchanged resource, `unchanged: true`, and no audit row. An empty body `{}`, or a body carrying only ignored keys or only a `voteType` equal to the stored value, supplies no editable field and is a no-op `200`. A `PATCH` is all-or-nothing: if any supplied field is invalid, no field is applied. When only some supplied fields differ, only those are changed and `changedFields` lists only those. **Archive** SHALL set the row archived, renumber the remaining active rows dense 1..N, and be `422 DEFAULT_ALREADY_ARCHIVED` for an archived row. **Restore** SHALL return the original template row to active at the next position after the highest active one (N+1 when healthy; the TOPIC-005 rule) and be `422 DEFAULT_ALREADY_ACTIVE` for an active row. **Reorder** (`PUT .../order`, body `{ order: [id, ...] }`) SHALL require exactly the active template ids; a missing or extra id SHALL be `409 REORDER_ID_MISMATCH` carrying the current active list; a malformed body, an empty list, or a duplicate id SHALL be `422 INVALID_DEFAULT_ORDER`; a list of one when exactly one default is active is a no-op `200`; a stale list with the same id set is accepted (last write wins on order, and the audit row records the overwritten order); the write is negate-then-set; a list equal to the stored order on an already dense (1..N) active set is a `200` with no audit row, whereas the same order on a gapped set renumbers it and writes an audit row. A topic id that names no template row, including one that names a real team's topic, SHALL be `404 DEFAULT_TOPIC_NOT_FOUND`.

#### Scenario: Added default is appended and active
- **WHEN** an administrator adds a valid default to a 12-default template
- **THEN** the template has 13 active defaults, the new one at position 13 with `is_default = true`

#### Scenario: Vote type cannot change
- **WHEN** an edit sends a different `voteType`
- **THEN** the response is `422 DEFAULT_VOTE_TYPE_IMMUTABLE` and the row is unchanged

#### Scenario: Rename carries the notice
- **WHEN** a default is renamed
- **THEN** the response `notice` equals `RENAME_NOTICE` and the scope statement is unchanged

#### Scenario: No-op edit
- **WHEN** an edit sends values equal to the stored values
- **THEN** the response is `200` with `unchanged: true` and no `audit_log` row is written

#### Scenario: Empty PATCH body
- **WHEN** a `PATCH` sends `{}`
- **THEN** the response is `200` with `unchanged: true` and no `audit_log` row

#### Scenario: Multi-field PATCH is atomic
- **WHEN** a `PATCH` changes a valid `name` and sends an over-length `prompt`
- **THEN** the response is `422 DEFAULT_FIELD_TOO_LONG` and the name is unchanged

#### Scenario: Partly-changed PATCH audits only what changed
- **WHEN** a `PATCH` sends a new `name` and a `prompt` equal to the stored value
- **THEN** one audit row exists with `changedFields: ["name"]`

#### Scenario: Archive closes the gap
- **GIVEN** 12 active defaults
- **WHEN** the one at position 5 is archived
- **THEN** the remaining 11 are at positions 1 to 11 in their prior relative order

#### Scenario: Restore appends
- **WHEN** an archived default is restored to a template with 11 active defaults
- **THEN** it is active at position 12, never its former number, and its old retained number never conflicted with the active positions

#### Scenario: Reorder with a missing id
- **WHEN** the submitted list omits one active id
- **THEN** the response is `409 REORDER_ID_MISMATCH` with the current list, and nothing changes

#### Scenario: Reorder of a single active default
- **GIVEN** exactly one active default
- **WHEN** a list of that one id is submitted
- **THEN** the response is `200`, `unchanged: true`, and no audit row

#### Scenario: Reorder with an empty list or a repeated id
- **WHEN** the list is empty, or has the right length with one id repeated
- **THEN** each is `422 INVALID_DEFAULT_ORDER` and nothing changes

#### Scenario: Stale reorder with the same ids
- **GIVEN** two administrators loaded the same order
- **WHEN** both submit different orderings of the same ids
- **THEN** both get `200`, the second ordering wins, and the second audit row's `before` is the first's `after`

#### Scenario: Reorder with an extra or archived id
- **WHEN** the list contains an id that is not an active template id
- **THEN** the response is `409 REORDER_ID_MISMATCH`

#### Scenario: Another team's topic id probes nothing
- **WHEN** a path names a topic id belonging to a real team
- **THEN** the response is `404 DEFAULT_TOPIC_NOT_FOUND`, indistinguishable from an unknown id
