# admin-default-topic-maintenance

## Purpose

Defines the admin-only API family `/api/v1/admin/default-topics` (issue #216) through which an Application Administrator maintains the default topic set (the `__default_topics__` template) without a migration: list, history, add, edit, archive, restore and reorder. Covers authorization (live `application_admin` role read, own 403 code, role check before the body is parsed), validation limits and the plain-text rule, the fixed semantics of each operation, the new-teams-only scope statement, isolation from existing teams and sessions, concurrency and the post-write invariant backstop, the list and history reads, and the structural test that keeps the maintenance module the only writer of template topic rows. Audit rows, denial audit and rate limiting are specified in `audit-logging-operations` and `topic-write-rate-limiting`; copy and anomaly behavior in `default-topic-provisioning`. API only: the screen is a follow-up. Introduced by `admin-default-topic-maintenance`.

## Requirements

### Requirement: The default topic set is maintained through an admin-only endpoint family outside the team-scoped topic routes

The application SHALL expose exactly seven routes for maintaining the template (the `__default_topics__` sentinel team's topics, `team_id = 00000000-0000-0000-0000-000000000001`): `GET /api/v1/admin/default-topics`, `POST /api/v1/admin/default-topics`, `PATCH /api/v1/admin/default-topics/:topicId`, `POST /api/v1/admin/default-topics/:topicId/archive`, `POST /api/v1/admin/default-topics/:topicId/restore`, `PUT /api/v1/admin/default-topics/order` and `GET /api/v1/admin/default-topics/history`. Each body-carrying route SHALL set an explicit `bodyLimit` of 16 KiB and SHALL accept only `application/json` (any other media type is refused with `415` and changes nothing; the route layer checks this itself because the framework parses `text/plain`). The role check SHALL run before the request body is parsed, so a non-administrator receives the `403` envelope, the timing floor and the denial audit row for an oversize, malformed or wrong-media-type body too; for an administrator, an oversize, malformed or unsupported body SHALL receive an envelope error (`413`, `400` or `415`). Archive and restore take no body and SHALL accept an empty body with a JSON content type. Every mutating route in the family (add, edit, archive, restore, reorder) SHALL additionally require the request header `X-Requested-With: dipstick`, checked after the role check and before the body is parsed; a missing or different value SHALL be refused `403 MUTATION_CONTROL_HEADER_REQUIRED` in the standard envelope with the timing floor and without echoing the received value (a cross-origin simple request cannot carry a custom header without a CORS preflight, which is granted only to the allow-listed origin). A non-administrator SHALL still receive `403 DEFAULT_MAINTENANCE_ADMIN_ONLY` first. The read routes need no header; a reorder body whose array exceeds 15 elements SHALL be rejected `422 INVALID_DEFAULT_ORDER` before any per-element validation or database work. Handlers SHALL pick `name`, `prompt`, `firstSessionDescription` and `voteType` from the body and SHALL NOT spread it. No route in the family SHALL contain a `:teamId` segment, and none SHALL accept a team id or the sentinel id in its path, query or body. The family is not configurable: no flag, environment variable or setting enables, disables or widens it. It SHALL change only template topic content (`name`, `prompt`, `first_session_description`), order, and `active` / `archived` status, and nothing else. It SHALL expose no control over the first-session customization lock, team membership, join links, facilitator rules, manager participation, or session rules, and it SHALL NOT read or write any real team's `topics`, `session_topics`, or any session. The team-scoped template guard (`checkWritableTeam`, #188) and its structural test SHALL be unchanged and SHALL still pass; no handler under `/api/v1/teams/:teamId/topics` SHALL gain an administrator exemption or a sentinel allow-list entry.

Success statuses SHALL be: add `201`; edit, archive, restore and reorder `200` (including no-ops); list and history `200`. Every successful list and write response body SHALL contain `defaults`, `limits` and `orderLastChangedAt`, and every write additionally `scope`. If the refreshed list cannot be read after a write has committed, the write response SHALL still be `200`/`201` with `scope` and `listUnavailable: true` and no list, so that a client does not retry a change that already happened. A write's maintenance operations SHALL act only on rows with `is_default = true`.

#### Scenario: Success status and shape per route
- **WHEN** each of the seven routes succeeds as an administrator
- **THEN** add returns `201` and the other six return `200`, and each body has `defaults`, `limits` and `orderLastChangedAt` (and each write also `scope`)

#### Scenario: A failed post-commit list read does not look like a failed write
- **WHEN** a write commits and the refreshed list cannot be read
- **THEN** the response is the write's success status with `listUnavailable: true` and `scope`, and the change is in place

#### Scenario: The inventory is exactly the seven routes
- **WHEN** the application's registered routes whose path begins `/api/v1/admin/default-topics` are enumerated
- **THEN** they are exactly the seven routes above, and none has a path parameter named `teamId`

#### Scenario: The family is outside the #188 structural test
- **WHEN** the team-template guard structural test runs unmodified
- **THEN** it passes, `EXTRA_IN_SCOPE_ROUTES` is unchanged, and none of the seven routes is selected by it

#### Scenario: Team-scoped writes to the template are still refused
- **WHEN** an administrator calls any TOPIC-003..008 route with the sentinel id
- **THEN** the response is `404 TEAM_NOT_FOUND` exactly as before this change

#### Scenario: The sentinel id is not accepted as input
- **WHEN** a request body carries a `teamId` or `team_id` key
- **THEN** the key is ignored and the template is still the only team written

#### Scenario: Mass assignment has no effect
- **WHEN** a POST or PATCH body also carries `teamId`, `status`, `isDefault`, `displayOrder`, `archivedBy`, `archivedAt` and `id`
- **THEN** none of them has any effect on the stored row

#### Scenario: Non-JSON and oversized bodies are refused
- **WHEN** a write is sent as `text/plain` or form-encoded, or with a body over 16 KiB, or a reorder array of 16 ids
- **THEN** the template is unchanged (`415`, `413` and `422 INVALID_DEFAULT_ORDER` respectively)

---

### Requirement: Only an application administrator may use the maintenance family, with its own 403 code

Authorization SHALL read `users.global_role` live from the database on every request and admit only `application_admin` (`isApplicationAdmin`). Membership on any team SHALL NOT be consulted. Any other authenticated caller, including a facilitator, a member or non-member of any team, and an engineering manager, SHALL receive `403` with code `DEFAULT_MAINTENANCE_ADMIN_ONLY`, `category: forbidden`, in the standard error envelope. That code SHALL differ from `NOT_AN_ADMIN` and `NOT_A_FACILITATOR`. An unauthenticated caller SHALL receive `401` from the session middleware. The check order SHALL be: authentication (401), role (403), for the body-carrying routes (add, edit, reorder) a non-JSON media type (415), non-canonical `:topicId` (404 `DEFAULT_TOPIC_NOT_FOUND`, no query), the shared topic-write rate limit for write routes (429 or fail-closed 503), request validation (422), then one transaction (lock, target lookup 404, state checks 409 or 422, write, audit, commit). The timing floor SHALL be applied to every return. A denial SHALL write one fail-open `topic.default_maintenance_denied` audit row, bounded per actor through the shared denial-audit limiter, and the response SHALL be the same `403` whether or not the row was written.

#### Scenario: Facilitator is refused
- **WHEN** a facilitator calls any of the seven routes
- **THEN** the response is `403 DEFAULT_MAINTENANCE_ADMIN_ONLY` and the template is unchanged

#### Scenario: Engineering manager is refused
- **WHEN** an engineering manager calls any of the seven routes
- **THEN** the response is `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`

#### Scenario: An administrator who is also a team member is admitted
- **WHEN** an application administrator who holds an active membership on some team calls a route
- **THEN** the request is authorized

#### Scenario: Role is read live
- **WHEN** a user's `global_role` is changed from `application_admin` to `facilitator` after login
- **THEN** their next request receives the `403`

#### Scenario: Role refusal precedes validation, rate limit and lookup
- **WHEN** a non-admin sends an invalid body or a non-canonical topic id
- **THEN** the response is the `403`, no budget is spent and no template query is issued

#### Scenario: Denial audit is bounded
- **GIVEN** `DENIAL_AUDIT_LIMIT` (read from the constant; currently 10 per 60-second window per actor)
- **WHEN** one non-admin actor triggers that limit plus one denials inside the window
- **THEN** exactly `limit` `topic.default_maintenance_denied` rows exist (10 today), the next denial writes no row and emits a log-only `topic.denial_audit_suppressed` event, and all responses are `403`

#### Scenario: Timing floor
- **WHEN** any return path completes (200, 403, 404, 422, 409)
- **THEN** its duration is at least the exported `CONTENT_TIMING_FLOOR_MS` constant of the real timing module (read from the constant, not hardcoded)

---

### Requirement: Maintenance writes validate against fixed limits so that team creation can never be broken by an edit

The limits SHALL be constants in code, not configuration: active defaults minimum 1 and maximum 15; `name` 1 to 60, `prompt` 1 to 400 and `first_session_description` 1 to 800 Unicode code points after trim; the trimmed value is stored. Every field SHALL be plain text: a value containing an HTML-tag-like sequence, an HTML entity, a URL (`http://`, `https://`, `www.`), a Markdown link or image (`](`), or any character in Unicode category Cc or Cf (including `U+0000`, bidi overrides, zero-width characters and the BOM) or `U+2028`/`U+2029` or a lone surrogate (and, for `name` and `prompt`, a line break; the description allows `\n` and no other Cc/Cf character) SHALL be rejected `422 PROMPT_FORMAT_INVALID` with `field`. Length SHALL be counted in code points (not UTF-16 units), and comparisons SHALL be made in application code over rows read inside the lock. Error bodies SHALL carry the `field` (and `max`) and SHALL NOT echo the rejected value. Template text (name, prompt, description, and its audit and history copies) SHALL be stored and transported as inert data and every consumer SHALL render it as text, with no raw-HTML sink, Markdown renderer or auto-linker: this, not the format guard, is the control against stored XSS. A missing or blank required field SHALL be `422 DEFAULT_FIELD_REQUIRED`; an over-length field `422 DEFAULT_FIELD_TOO_LONG` (with `field` and `max`); a `voteType` outside `finger`, `roman`, `modified_roman` `422 DEFAULT_VOTE_TYPE_INVALID`. A name that equals, after trim and lowercase with no locale, the name of another active template row SHALL be `409 DEFAULT_NAME_DUPLICATE`; the row being edited or restored is excluded from its own comparison. The plain-text rule rejects `<` only when immediately followed by a letter, `/` or `!`, and `&` only as an entity (`&name;`, `&#digits;`, `&#xhex;`); therefore "rate < 5" and "Dev & Ops" SHALL be accepted. Validation (422) SHALL be evaluated before state checks (409): an add that is both invalid and at capacity is `422`. An add or restore that would exceed 15 active defaults SHALL be `409 TEMPLATE_AT_CAPACITY`. An archive that would leave zero active defaults SHALL be `409 LAST_ACTIVE_DEFAULT`. Every rejection SHALL leave the template unchanged and write no success audit row. All twelve defaults seeded by migration 11 SHALL satisfy these limits. Unicode normalization SHALL NOT be applied, so differently normalized spellings are different names; this is a recorded decision.

#### Scenario: Seed satisfies the limits
- **WHEN** each of the twelve seeded defaults is validated against the limits
- **THEN** all pass without any seed edit

#### Scenario: Add at capacity
- **GIVEN** 15 active defaults
- **WHEN** an administrator adds one
- **THEN** the response is `409 TEMPLATE_AT_CAPACITY` and nothing changes

#### Scenario: Restore at capacity
- **GIVEN** 15 active defaults and one archived default
- **WHEN** the archived default is restored
- **THEN** the response is `409 TEMPLATE_AT_CAPACITY`

#### Scenario: Duplicate name, case and spacing
- **GIVEN** an active default named "Pairing"
- **WHEN** an add or rename uses " pairing "
- **THEN** the response is `409 DEFAULT_NAME_DUPLICATE`

#### Scenario: Last active default cannot be archived
- **GIVEN** exactly one active default
- **WHEN** it is archived
- **THEN** the response is `409 LAST_ACTIVE_DEFAULT` and it stays active

#### Scenario: Boundary lengths
- **WHEN** a prompt of exactly 400 and a prompt of 401 code points are submitted
- **THEN** the first is accepted and the second is `422 DEFAULT_FIELD_TOO_LONG`

#### Scenario: Case-only or spacing-only rename of the row's own name
- **GIVEN** an active default "Pairing"
- **WHEN** it is renamed to "pairing"
- **THEN** the response is `200`, the name is "pairing", and one `topic.default_edited` row exists
- **WHEN** it is renamed to " Pairing "
- **THEN** the response is `200` with `unchanged: true` and no audit row (trims to the stored value)

#### Scenario: Restore name collision names the conflicting default
- **GIVEN** "Pairing" is archived and a new active default "Pairing" has been added
- **WHEN** the archived one is restored
- **THEN** the response is `409 DEFAULT_NAME_DUPLICATE` carrying the conflicting active default's id and name, and nothing changes

#### Scenario: Restore check order
- **WHEN** a restore is simultaneously for an already-active default, at capacity and name-colliding
- **THEN** the order of precedence is `422 DEFAULT_ALREADY_ACTIVE`, then `409 TEMPLATE_AT_CAPACITY`, then `409 DEFAULT_NAME_DUPLICATE`
- **AND** an archived default that is at capacity and name-colliding returns `TEMPLATE_AT_CAPACITY`

#### Scenario: Validation precedes capacity
- **GIVEN** 15 active defaults
- **WHEN** an add is both over-length and would exceed capacity
- **THEN** the response is `422 DEFAULT_FIELD_TOO_LONG`, not `409`

#### Scenario: Comparisons and lone ampersands are plain text
- **WHEN** a prompt is "Is our deploy rate < 5 a day?", or a name is "Dev & Ops", or a prompt is "R&D time"
- **THEN** each is accepted
- **AND** "x <b> y", "a </p>", "<!-- c -->", "&amp;", "&#169;" and "&#xA9;" are each `422 PROMPT_FORMAT_INVALID`

#### Scenario: Markup and URLs are refused
- **WHEN** a prompt contains `<b>`, `&amp;`, `https://example.com` or `[x](y)`
- **THEN** each is `422 PROMPT_FORMAT_INVALID` with `field: "prompt"`

#### Scenario: Cc, Cf and surrogate characters are refused
- **WHEN** a name, prompt or description contains `U+202E`, `U+200B`, `U+0000`, `U+FEFF` or a lone surrogate, or a name contains a newline
- **THEN** each is `422 PROMPT_FORMAT_INVALID` with `field` and no echo of the value
- **AND** a description containing `\n` is accepted

#### Scenario: Astral characters count as one
- **WHEN** a prompt is 399 ASCII characters plus one astral-plane character, and another is 400 ASCII plus one astral-plane character
- **THEN** the first is accepted and the second is `422 DEFAULT_FIELD_TOO_LONG`

#### Scenario: A rejected write leaves no trace
- **WHEN** any validation or state rejection occurs
- **THEN** the template rows are unchanged and no `topic.default_*` success row exists

---

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

---

### Requirement: Every write response states that it applies to new teams only

Every successful write response SHALL carry a `scope` field with the text "Applies to teams created from now on. Existing teams keep their current topics." and the refreshed full list. No endpoint text, documentation or runbook SHALL describe a topic restored on a team (single restore, bulk restore) as "canonical", and the recovery documentation SHALL state that Recover Zero-Topic Team hands out the template as of the moment of recovery. New-teams-only is the existing requirement, not new policy: use case 08 "Assign Default Topic Set to New Team", BRD section 6.4 (copy-on-create) and FR-8.2 (first-session lock). A team created before an edit and still locked before its first session SHALL keep the set it was created with; the documentation SHALL say so.

#### Scenario: Scope on every write
- **WHEN** any of the five write operations succeeds
- **THEN** the response carries the `scope` text and the full refreshed list

#### Scenario: No-op writes still carry scope
- **WHEN** an edit is a no-op
- **THEN** the `200` response carries `scope` and `unchanged: true`

---

### Requirement: A template write never reaches an existing team, an open session or a snapshot

No maintenance operation SHALL read or write any real team's `topics`, any `session_topics` row, or any session. The maintenance path SHALL take `lockTeamTopics` only on the sentinel and SHALL share no lock or state with the live-session path. Zero-topic recovery (assign-defaults) is the only existing path that reads the current template for an existing team; its behavior is unchanged.

#### Scenario: Negative isolation test
- **GIVEN** a snapshot of every existing team's `topics` rows and every `session_topics` row
- **WHEN** an administrator runs add, edit, archive, restore and reorder
- **THEN** every snapshotted row is byte-identical afterwards and no session changed

#### Scenario: A team created after an edit receives the new set
- **WHEN** a default is renamed and a team is then created
- **THEN** the new team's copy carries the new name and an older team still carries the old name

#### Scenario: Recovery hands out the current template
- **WHEN** a default is edited and a zero-topic team is then recovered
- **THEN** the recovered team receives the edited wording

---

### Requirement: Concurrent maintenance and team creation always see a complete set

Each write SHALL run as one transaction under the sentinel's topic advisory lock. Two concurrent writes SHALL serialize and never produce duplicate or non-dense active positions. A team created while a multi-row write is uncommitted SHALL receive either the complete before-set or the complete after-set. The copy of the template into a new team SHALL remain a single statement (or be moved to a stronger isolation level). A conflict SHALL give the administrator a plain-language message and the current list, never a silently lost edit. The write transaction SHALL set a `lock_timeout` and a `statement_timeout`; a timeout SHALL answer `503 DEFAULT_MAINTENANCE_BUSY` with `Retry-After` and change nothing. The post-write invariant backstop (at least one and at most 15 active defaults, active positions exactly 1..N, the touched rows valid) SHALL roll the write back and answer a generic `500` on failure, and SHALL NOT block on pre-existing damage elsewhere in the template, so that a damaged template can be repaired by ordinary maintenance. Audit-write failure, unique-violation and any unexpected error SHALL answer the generic `500` envelope (code `DEFAULT_MAINTENANCE_FAILED`) with a `correlationId` and no driver text.

#### Scenario: Two administrators reorder at once
- **WHEN** two reorder requests run concurrently
- **THEN** the active positions afterwards are exactly 1..N with no duplicates, and each request got either success or `409 REORDER_ID_MISMATCH`

#### Scenario: Team creation during an uncommitted reorder
- **GIVEN** an administrator transaction that has negated active positions but not committed
- **WHEN** a team is created
- **THEN** the new team's topics equal the committed before-set, in its order

#### Scenario: Lock timeout
- **GIVEN** another connection holds the sentinel topic lock beyond `lock_timeout`
- **WHEN** an administrator writes
- **THEN** the response is `503 DEFAULT_MAINTENANCE_BUSY` with `Retry-After` and nothing changed

#### Scenario: A gapped template is repaired by use
- **GIVEN** active positions 1, 2, 4
- **WHEN** an administrator adds a default
- **THEN** the response is `200`-class success, the active positions are 1..4, and no unique-violation `500` occurs

#### Scenario: Works with no teams
- **GIVEN** a database with no teams other than the template
- **WHEN** an administrator edits a default
- **THEN** the response is `200`

---

### Requirement: The list and history reads are non-mutating and expose what an administrator needs to recover

`GET /api/v1/admin/default-topics` SHALL return every template default including archived ones, with `id`, `name`, `prompt`, `voteType`, `firstSessionDescription`, `status`, `displayOrder` (null for archived), `lastChangedAt` and `lastChangedBy` (null when the row has never been changed through the endpoints), plus `limits` and `orderLastChangedAt`. `lastChangedAt` and `lastChangedBy` SHALL be the time and actor of the latest `audit_log` row (by its `timestamp` column) for the template whose operation is `topic.default_added`, `_edited`, `_archived` or `_restored` and whose `metadata.topicId` is the row's id; `topic.default_reordered` rows SHALL NOT count, and `orderLastChangedAt` SHALL be the time of the latest `topic.default_reordered` row. Because these are derived from audit rows, they depend on audit retention: template audit rows are assumed exempt from routine retention, and deletion of them would turn the values null (stated in the runbook). Every selection of maintenance audit rows (this derivation, the history read, the invariants gate, test cleanup) SHALL use an explicit list of the five operation names, never a `LIKE` pattern, so that the existing `topic.defaults_assigned`, `topic.defaults_assign_denied` and `topic.defaults_assign_failed` rows are never matched. Active rows SHALL come first by position, archived after. `GET .../history?limit=` SHALL return `{ history: [...] }`, the newest-first template maintenance audit rows (ordered by time descending, ties by id descending; `limit` absent is 50, an integer 1 to 200 is used as given, an integer above 200 is clamped to 200, and 0, negative, non-integer or non-numeric is `422 INVALID_HISTORY_LIMIT`) with the actor, `changedFields`, `before` and `after`, so an administrator can edit a value back. Neither read SHALL change any row or write any audit row. There is no undo operation.

#### Scenario: Assign-defaults rows are not maintenance history
- **GIVEN** a `topic.defaults_assign_denied` row whose `team_id` is the sentinel
- **WHEN** the history is read
- **THEN** that row is not returned

#### Scenario: Reading changes nothing
- **WHEN** the list and history are read repeatedly
- **THEN** no `topics` or `audit_log` row changes

#### Scenario: Archived defaults are listed
- **GIVEN** an archived default
- **WHEN** the list is read
- **THEN** it appears with `status: "archived"` and `displayOrder: null`

#### Scenario: History limit boundaries
- **WHEN** `limit` is 1, 200, 201, 0, -1 and "abc"
- **THEN** 1 returns at most 1 row, 200 at most 200, 201 is clamped and returns at most 200, and 0, -1 and "abc" are each `422 INVALID_HISTORY_LIMIT`

#### Scenario: History ties
- **WHEN** two rows share a timestamp
- **THEN** the one with the greater id is listed first

#### Scenario: Reorder does not touch lastChangedAt
- **WHEN** the list is reordered
- **THEN** no row's `lastChangedAt` changes and `orderLastChangedAt` equals the reorder audit row's time

#### Scenario: Last-changed metadata
- **WHEN** a default is edited by administrator A
- **THEN** the list shows that row's `lastChangedBy` as A and `lastChangedAt` equal to the audit row's time; an untouched seeded row shows nulls

#### Scenario: Edit it back
- **WHEN** the history shows a prompt change with a before-value
- **THEN** a PATCH with the before-value restores the text and writes a new audit row

---

### Requirement: Only the sanctioned writer may write sentinel topic rows, enforced by a structural test

All production writes to `topics` rows of the sentinel SHALL go through one module, `sessions/default-topic-maintenance.ts`. A structural test SHALL scan production source, at statement and enclosing-function granularity, for `INSERT INTO`, `UPDATE [ONLY]`, `DELETE FROM`, `TRUNCATE` and `MERGE INTO` against `topics` (including schema-qualified, quoted, aliased and CTE-wrapped forms, and not matching `session_topics`), and fail if the set of (file, function) pairs containing them differs from a checked-in, justified allowlist, if any such statement uses a dynamic table name, or if a statement outside the writer module (other than `copyCanonicalDefaults`, whose sentinel is a SELECT source) references the sentinel id, its literal or `__default_topics__`. The test SHALL prove it can fail for each of those shapes. No database trigger SHALL be added by this change; the decision and its reasons are recorded in `design.md` (E11).

#### Scenario: A new writer fails the build
- **WHEN** a production file adds `UPDATE topics ...` and is not on the allowlist
- **THEN** the structural test fails and names the file

#### Scenario: The scanner can fail
- **WHEN** the scanner is run on fixtures containing a synthetic writer in each supported shape (unlisted file, unlisted function in a listed file, `UPDATE ONLY`, `public.topics`, quoted `"topics"`, aliased, CTE-wrapped, `TRUNCATE`, `MERGE`, `ON CONFLICT`, dynamic table name, sentinel reference outside the writer)
- **THEN** it reports each as a violation
- **AND** `session_topics` and `topics_x` fixtures are not reported

#### Scenario: Mutations require the control header
- **WHEN** an administrator sends add, edit, archive, restore or reorder without `X-Requested-With: dipstick`
- **THEN** the response is `403 MUTATION_CONTROL_HEADER_REQUIRED` and nothing changes
- **AND** with the header the same requests succeed, and a non-administrator without the header still receives `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`

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
