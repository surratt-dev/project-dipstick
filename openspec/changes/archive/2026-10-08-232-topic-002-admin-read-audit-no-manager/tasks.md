# Tasks: 232-topic-002-admin-read-audit-no-manager (#232)

Tasks are listed in implementation order. Every task must leave the full backend (unit **and** real-Postgres integration) and frontend suites green, except inside the one atomic unit in section 2, which must itself end green (task 2.5).

**Standing constraint for every task:** `packages/backend/src/auth/standing-facilitator-access-helper.ts` and the TOPIC-003..006 authorization wrappers in `packages/backend/src/routes/topics.ts` have **no diff** in this change (design.md D2, D6).

**Section 6 (frontend) has no backend dependency.** It may be done at any point after section 1.

## 1. Audit operation registration (`packages/backend/src/auth/audit-logger.ts`)

- [x] 1.1 Add `"admin.topic_config_accessed"` and `"admin.topic_config_denied"` to the `AuditEventName` union. Give each a comment block with these points:
  - the change (#232)
  - that it is a durable `audit_log` row plus an event, and why it is not log-only (TOPIC-002 is not a hot path; the spec requires `audit_log`)
  - the row columns, including `actor_roles` (these are the first writers after the two sign-in rows; migration 22's column comment is not edited)
  - the exact metadata keys and the exact event payload keys (design.md D5)
  - the rule that neither metadata nor the event payload ever holds annotation text, topic names or topic ids
  - the visibility guard (never exposed to team members or EMs)
  - the backfill limit: users not signed in since #245 record `actor_roles = {application_admin}` and `actor_idp_roles_include_em: false`
  - for `admin.topic_config_denied`, that it is distinct from TOPIC-001's spec-protected `admin.session_content_denied`, and that the two are told apart by `metadata.endpoint`
- [x] 1.2 Add `"admin.audit_write_failed"` to `AuditEventName` with a comment block (design.md D5b): log-only by design (no row about a failed row); fired on the TOPIC-002 admin arm when the role-set read or an audit insert fails, before the `500`; payload `{ actorUserId, teamId, endpoint, operation, stage: "role_set_read" | "audit_insert", errorCode }`; `errorCode` is the SQLSTATE or `null`, never `err.message`/`err.detail`; distinct from `auth.audit_write_failed` (different contract, fail-open auth trail); `admin.*`-generic so `teams.ts` could adopt it later (not in this change).

## 2. Test fixture, then the TOPIC-002 handler (`packages/backend/src/routes/content.ts`)

- [x] 2.0 **Green checkpoint before the handler changes.** In `packages/backend/src/routes/__tests__/content.test.ts`, add a fixture helper for admin TOPIC-002 requests that routes by SQL text (`mockDbQuery.mockImplementation(sql => …)`), not by a positional `mockResolvedValueOnce` queue: an exhausted queue returns `undefined`, the handler throws a TypeError, and a miscounted fixture then looks like a passing fail-closed test.
  - Routes: the shared helper's row, the team-name row, the active, archived, defaults and lock-state rows, **and** (unused until 2.2) the membership-role row (default `null`), the role-set row (`roles::text[]`, default `{application_admin}`) and `INSERT INTO audit_log` (default OK).
  - Injected failures are explicit ("reject when SQL matches …"). The router fails the test on any unrouted SQL.
  - Migrate every existing admin TOPIC-002 test in the `describe("GET …/topics/all")` block and the annotation block (~L1010+, including security R4 ~L1170) onto it. Move the shared `mockAllTopics(globalRole, …)` helper's `"application_admin"` uses and the ~L915 admin test onto it. Confirm that tests indexing `mock.calls[2]`/`[3]` are facilitator-only. Facilitator tests keep their queues and queue no extra row.
  - This is a pure refactor: the full backend suite is green against **today's** handler at the end of this task.

**Atomic unit: 2.1 + 2.2 + 2.3 + 2.4 + 2.4a + 2.5.** The new role-set read throws on zero rows. The parity fake in `topic-add-flag-parity.test.ts` answers unrouted SQL with `{ rows: [] }` (~L52), so its existing admin rows go `500` the moment the handler changes; 2.4a restores them inside the unit. The admin tests migrated in 2.0 stay green across the unit because the router already answers the new queries.

- [x] 2.1 Add a pure, non-exported `evaluateAdminTopicConfigRead(liveRole: string | null)` beside `isTopicConfigReadAdmitted`. It returns admitted for `null` and `"participant"`, `membership_em` for `"engineering_manager"`, and `membership_unrecognised` for anything else (design.md D2). Its comment says: allow-list; unconditional (no flag, env or override); TOPIC-002 only; TOPIC-003..006 are #208's; the `membership_unrecognised` branch is unreachable against today's enum and exists for a future value, so adding a value to `membership_role` must revisit this predicate. (Do not edit the applied migration 1 to add a comment.) Define the two D3 messages as **exported** module-level constants in `content.ts`, so the tests import the exact string (design.md D3). If a reviewer objects to exporting from a route module, that is a code-review conversation, not an implementation choice.
- [x] 2.2 In the TOPIC-002 handler, after the existing `!decision.authorized` branch and **only when** `decision.actorGlobalRole === "application_admin"` (design.md D2):
  - call `readActiveMembershipRole(session.userId, teamId)` and the predicate
  - then, on **both** outcomes, read the role set once: `SELECT roles::text[] AS roles FROM users WHERE id = $1`. If `rows.length !== 1`, throw (never default). Validate with `parseRoleArray`. Derive `actorIdpRolesIncludeEm = roles.includes("engineering_manager")` from the same array.
  - the handler's authorization comment cites #232 and the #208 boundary (TOPIC-003..006 unchanged until #208 is decided), and says why this is two reads and not one `users`/`team_memberships` join (`content.ts` runs no SQL against `team_memberships`; access-control Decision 8)

  On a denial, in this order:
  - await an `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata, actor_roles)` of `admin.topic_config_denied`, with `actor_roles` as `$n::text[]` last (the `insertSignInAuditRow` pattern) and the D5 metadata
  - `emitAuditEvent` with the D5 denied-event payload
  - `await applyTimingFloor(startTime)`
  - send `noStore(reply).code(403)` with the standard forbidden envelope and the D3 message constant for the reason

  The branch runs no team-name, topic, archived, `defaultTopicsNotActive` or lock-state query. Leave the facilitator path untouched: it must not reach the membership or role-set read.
- [x] 2.3 On the admin `200` path, in this order (design.md D2 step 5):
  - the existing data reads, unchanged
  - compute `active_count`, `archived_count`, `annotated_count` (active **and** archived entries with non-null `teamAnnotation`) and `team_found` (whether the existing `SELECT name FROM teams` returned a row)
  - await the `admin.topic_config_accessed` insert with `actor_roles` (same column list as 2.2; plain awaited insert, not a transaction). `metadata.membership_role` comes from the admitted `AdminTopicConfigRead` value, not from `liveRole`.
  - `emitAuditEvent` with the D5 accessed-event payload
  - `await applyTimingFloor(startTime)`, then `noStore(reply).send(...)`. The insert must not move between the floor and the send.

  A thrown read or insert propagates, so the request is `500` with no data. Non-admin callers write nothing. The comment on the `canAddTopics` computation notes that an admin with an EM membership never reaches it (the deny branch returns first).
- [x] 2.4 Wrap the role-set read and both inserts so that a throw emits `admin.audit_write_failed` (1.2) with the due `operation`, the `stage`, and `errorCode = err.code ?? null`, then **rethrows**. The membership read is not wrapped. Nothing in the payload comes from `err.message` or `err.detail`.
- [x] 2.4a Parity fake (`packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts`): extend the SQL-routing fake so it answers `readActiveMembershipRole` with a configurable membership role, and answers the role-set read (one row) and the `audit_log` insert. The fake **records** the membership role it served per request, and every `application_admin` row asserts that the recorded value equals the row's configured role, so a mis-routed query can't pass as a `null` membership (design.md D6). Match the membership query before any broader `team_memberships` route, and keep the role-set route (`FROM users WHERE id`) from colliding with the helper's `FROM users u`. Pin the existing "application_admin member" row to a `participant` membership. All existing rows keep their current expectations. (New rows are 4.2, after the unit.)
- [x] 2.5 **Close the atomic unit:** run the full backend unit suite **and** the real-Postgres integration suites (not deferred to 8.2), plus the frontend suite. All green. In particular, the existing suites that call `GET …/topics/all` as an admin must pass unmodified at this point (see 5.3's list).

## 3. Backend unit tests (`packages/backend/src/routes/__tests__/content.test.ts`)

All new admin tests use the 2.0 fixture and import the D3 message constants from `content.ts`.

- [x] 3.1 Split "an application_admin can list any team's topics, including one they are an active member of" (~L915) into three tests:
  - admin non-member: `200`, one `admin.topic_config_accessed` insert, `membership_role: null`, and call order insert < `emitAuditEvent` < `mockApplyTimingFloor` < reply (`mock.invocationCallOrder`)
  - admin with a `participant` membership: `200`, one insert, `membership_role: "participant"`
  - admin with an `engineering_manager` membership: `403`, the exact D3 message, `Cache-Control: no-store`, `mockApplyTimingFloor` called once with `startTime` before the reply (spied the same way as the existing `NOT_A_FACILITATOR` test), call order denial insert < `emitAuditEvent` < floor < reply, exactly one `admin.topic_config_denied` insert with `reason: "membership_em"`, and no `admin.topic_config_accessed` insert

  The structured event precedes the floor on **both** outcomes (spec: "the audit insert and its structured event SHALL complete before `applyTimingFloor`"). The EM test proves that no topic, lock or team-name query ran by asserting that no call's SQL matches `FROM topics`, `FROM teams` or the lock query. Never use mock position for this. Its comment cites #232 and says that a reorder putting reads before the admin check must fail here.
- [x] 3.2 Unrecognised membership value (for example `"observer"`): `403`, the neutral D3 message, `reason: "membership_unrecognised"`, and the same no-query assertion.
- [x] 3.3 Rows and events (design.md D5):
  - access-row metadata has exactly `{ endpoint, http_status, membership_role, actor_idp_roles_include_em, team_found, active_count, archived_count, annotated_count }`; denial-row metadata has exactly `{ endpoint, http_status, reason, actor_idp_roles_include_em }`. Adding a key fails a test.
  - values: `http_status` is `200` on the access row and `403` on the denial row; `endpoint` is `"GET /api/v1/teams/:teamId/topics/all"` on both (the D1 rule that tells these rows apart from TOPIC-001's `admin.session_content_denied` by `metadata.endpoint`)
  - `active_count` and `archived_count` equal the lengths of the response's `active` and `archived` lists
  - both inserts pass `actor_roles` as the role-set array (`$n::text[]`), equal to what the role-set route served
  - the `admin.topic_config_accessed` event payload has exactly `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, membershipRole, actorRoles, actorIdpRolesIncludeEm, teamFound, activeCount, archivedCount, annotatedCount }`; the `admin.topic_config_denied` payload has exactly `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, reason, actorRoles, actorIdpRolesIncludeEm }`
  - with one annotated active topic and one annotated archived topic, `annotated_count = 2`
  - no metadata value and no event value contains the annotation text or any topic name or id
  - `actor_idp_roles_include_em` is covered both `true` (roles `{application_admin,engineering_manager}`) and `false` (`{application_admin}`), and equals `actor_roles.includes("engineering_manager")`
  - `team_found` is `true` when the team lookup returns a row and `false` when it returns none
- [x] 3.4 Fail-closed checks (spec "Failure handling on the administrator arm"):
  - the access insert rejects: `500`, and the body contains no topic name or definition
  - `readActiveMembershipRole` rejects: `500`, and no topic, team-name or lock query ran (SQL match)
  - the role-set read rejects on an admitted request: `500`, the body contains no topic name or definition, and no topic query ran (the read now precedes the data reads)
  - the role-set read rejects on the deny path: `500`, not `403` or `200`, and no topic query ran
  - the role-set read returns zero rows: `500`, not `200` with a defaulted `false`
  - the `admin.topic_config_denied` insert rejects: `500`, not `200`, and no topic query ran
  - for each role-set or insert failure above, exactly one `admin.audit_write_failed` event with the due `operation`, the right `stage`, and `errorCode` from the injected error's `code`; its payload contains no part of the injected error's message. A `readActiveMembershipRole` failure emits none.
- [x] 3.5 Audited on every read, whatever comes back:
  - template team (`DEFAULT_TOPICS_TEAM_ID`): an admin read writes exactly one access row
  - an existing team with topics but **no** definitions: exactly one access row with `annotated_count = 0`, `team_found = true` and `active_count > 0` (this separates it from the nonexistent-team case, and protects the Q2 decision to audit every read, not only reads that return annotations)
- [x] 3.5a No deduplication: two admin TOPIC-002 requests for the same team write two `admin.topic_config_accessed` inserts (API level; no frontend involved).
- [x] 3.6 Facilitator regression:
  - non-member facilitator: `200`, `canEditAnnotations: true`, no `admin.*` insert, and the count of calls whose SQL matches `FROM team_memberships` equals the shared helper's count (by SQL text, not mock position)
  - member-facilitator: `403` with the exact message "A facilitator cannot view topic management for a team they are a member of."
  - global facilitator with an EM membership: `403` as a member-facilitator
- [x] 3.7 Global EM regression: `global_role = "engineering_manager"` with no membership, a `participant` membership and an `engineering_manager` membership each get `403` with the `NOT_A_FACILITATOR` message and no `admin.*` insert.

## 4. Parity test (`packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts`)

(The fake's extension was 2.4a, inside the atomic unit.)

- [x] 4.2 Add `{ get: 403; post: 201 }` to the `Expected` union. Add the row "application_admin with an engineering_manager membership" with that expectation. Its comment says: deliberate split; TOPIC-002 applies the no-manager rule (#232); TOPIC-003..006 are unchanged until #208 is decided; do not "fix" this row here. Add rows for a global EM with a `participant` membership and with an `engineering_manager` membership, both `REJECTED`.

## 5. Real-Postgres integration tests

- [x] 5.1 New file `packages/backend/src/routes/__tests__/topic-002-admin-audit-integration.test.ts` (a new file, not a `describe` in `topic-annotation-integration.test.ts`, so the HARD-rule evidence is findable by name and a later edit to the annotation suite can't weaken it). Use a team with exactly one active and one archived topic, each carrying a distinct definition. Any new user helper writes `users.roles` explicitly (do not rely on migration 21's legacy-fill trigger, which follow-up F1 drops). Copy the existing `cleanup` by `actor_user_id` so the nonexistent-team row is removed. Cover these callers:
  - **admin with an EM membership:** `403` with the exact `ADMIN_IS_TEAM_MANAGER` message (imported constant). The body and the denial row contain neither definition text nor any topic name. Exactly one `admin.topic_config_denied` row exists for the request, with `actor_roles` populated, and no access row. The row's `actor_user_id` is the caller, `actor_global_role = 'application_admin'`, and `team_id` is the requested team.
  - **admin non-member, `users.roles = {application_admin}`:** `200`. Exactly one `admin.topic_config_accessed` row, with `active_count = 1`, `archived_count = 1`, `annotated_count = 2`, `team_found = true`, `actor_roles = {application_admin}`, `actor_idp_roles_include_em = false`, and metadata containing no definition text. The row's `actor_user_id` is the caller, `actor_global_role = 'application_admin'`, and `team_id` is the requested team.
  - **admin non-member, `users.roles = {application_admin,engineering_manager}`** (that order satisfies `users_roles_well_formed`): `200`, one access row with `actor_roles = {application_admin,engineering_manager}` and `actor_idp_roles_include_em = true`. This is the only proof that the `roles::text[]` read decodes to an array in real Postgres.
  - **admin with a participant membership:** `200` with one access row whose `metadata.membership_role = "participant"` (the real-Postgres proof that `readActiveMembershipRole` returns the right value).
  - **global EM with a participant membership:** `403`, no `admin.*` row.
  - **non-member facilitator:** `200`, no `admin.*` row.
  - **admin whose `engineering_manager` membership was removed** (`removed_at` set): `200`, one access row with `membership_role = null`.
  - **admin, canonical UUID that names no team:** `200` with `teamName: ""` and empty lists (unchanged behaviour), one access row whose `team_id` is the requested id, whose counts are all `0`, and whose `team_found` is `false`.
- [x] 5.2 In the same file, run the TOPIC-004 regression: an admin with a `participant` membership and an admin with an `engineering_manager` membership each archive a topic on an unlocked team and still get `200` with the existing write audit row. The #208 N4 assertions are not weakened.
- [x] 5.3 Update the existing admin read in `topic-annotation-integration.test.ts` (~L316, ~L415) to also assert one `admin.topic_config_accessed` row. Confirm these suites, which all call `GET …/topics/all`, pass unmodified (already run at 2.5; this records the evidence): `restore-topic-integration`, `topics-integration`, `remove-topic-integration`, `topic-add-admin-integration`, `template-team-topic-writes-integration`, `template-team-read-surfaces-integration`, `template-team-topic-lock-integration`, `topic-write-rate-limit-thresholds-integration` and `session-topic-snapshot-integration`. These are the TOPIC-005/006 regression evidence (design.md D6).

## 6. Frontend (`packages/frontend/src/pages/TopicManagementPage.tsx`)

- [x] 6.1 In `loadTopics` (~L659), on `403`, parse the body with a guard: `const body = await res.json().catch(() => null)`, so a non-JSON `403` never reaches the existing `catch` and its "Network error loading topics." message. When `hasEnvelopeMessage(body)` holds, show `body.error.message` in the existing access-denied state. Otherwise show the current fallback string. Leave the quiet refetch's failure handling unchanged. Do not change `TeamPage`'s "Topics" link. In `packages/frontend/src/pages/__tests__/TeamPage.test.tsx`, add a comment to the existing "renders a discoverable Topics nav link" test citing #232: the link must not be hidden by role or membership; the server is the only gate.
- [x] 6.2 Tests in `packages/frontend/src/pages/__tests__/TopicManagementPage.screen.test.tsx`, or the file that owns the access-denied test:
  - a `403` with an envelope message renders that exact message
  - a `403` with a JSON body that is not an envelope with a message renders "You do not have access to this team's topic management."
  - a `403` whose body is not JSON (HTML, or empty) renders the same fallback string, and **not** "Network error loading topics."
  - in all three cases there is no topic list, no "Our team's definition" block and no write control

## 7. Contract and requirements docs

- [x] 7.1 Update `requirements/design/REST API Contract.md`, TOPIC-002 section:
  - **Authorization:** add the admin no-manager allow-list, with a "Corrected (#232)" note and the TOPIC-003..006 / #208 boundary
  - **Error Responses:** add `403` rows for `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED`, with their messages
  - **"Annotation fields" note:** it now says annotations go to administrators *with no membership or a `participant` membership on the team*
  - **New audit note:** `admin.topic_config_accessed` on every admin `200`; `admin.topic_config_denied` on the new `403`; both write `actor_roles`; text-free metadata; fail closed (`500`, no data, when the membership read, the role-set read or either insert fails; a failed denial insert never becomes `200`)
- [x] 7.2 Same file, TOPIC-001 "Corrected (#187)" note (~L566): replace "whose admin-read auditing is tracked separately; this note makes no claim that TOPIC-002 is audited" with a pointer to TOPIC-002's audit and no-manager rule (#232).
- [x] 7.3 Same file, Appendix B TOPIC-002 row (~L3063): change the App Admin cell to "Yes, unless they hold an EM (non-participant) membership on the team (403, #232); every read audited". Add to Notes: "TOPIC-003..006 unchanged pending #208".
- [x] 7.4 In `requirements/BRD.md`, FR-8.7 rationale (L341): change "Administrators may still read team definitions on the topic management screen." to "Administrators may still read team definitions on the topic management screen, except an administrator who holds an engineering manager membership on that team (no-manager rule; #232)."
- [x] 7.5 `requirements/use cases/08 - Topic Management - Use Cases.md`, Use Case: View Active Topic Configuration:
  - add "Application Administrator (read-only definitions; FR-8.7)" as a secondary actor
  - add the alternate flow "Administrator who holds an engineering manager membership on the team: the Application shows 'Topic configuration for this team isn't available to its engineering manager.' No topic data is shown (no-manager rule, #232)."
  - add the acceptance criterion "Every administrator view is recorded in the audit log, without topic names or definition text."
  - leave the existing "Access rules … should be defined" note alone except to point at the `topic-customization-lock` spec for the admin arm
- [x] 7.6 In `requirements/BRD.md`, Constraint 2, after the existing #243 sentence, add: "An administrator who holds an engineering manager membership on a team cannot read that team's topic configuration (#232)."
- [x] 7.8 `docs/deployment.md`, "Logging" section:
  - correct the durable-row paragraph (~L291): it lists "admin reads" among events written "in the same transaction as the state change", which is false for admin reads (design.md D8). Say instead that admin reads write their row after the read and before the response is sent, not in a transaction, and fail closed (`500`, no data) if the write fails.
  - correct the `actor_roles` sentence in the same paragraph: it is now also written on `admin.topic_config_accessed` and `admin.topic_config_denied` (#232); NULL still means "not captured"
  - add `admin.audit_write_failed` to the log-only list (as its own `admin.*` bullet), with a one-line reason (D5b: no row about a failed row). **Re-derive both counts from the list as it stands when you edit it**, do not hard-code: the "N further events are also log-only … M unrelated to the auth/join trail" sub-count and the "In total, N events" total both change. (At the time of writing, the list holds 13 events and the sentence says "Seven further … five unrelated"; adding one gives "Eight … six" and 14. If another change has landed first, the numbers differ.)
  - add a short "Review queries" note with the two compensating-control queries: (1) `operation = 'admin.topic_config_accessed' AND 'engineering_manager' = ANY(actor_roles)`; (2) a `team.role_changed` or membership-removal row with `actor_user_id = target_user_id`, followed by `admin.topic_config_accessed` by the same user for the same team. Write the owner line exactly as **"Proposed: Security (Tomás Ferreira), monthly, no alerting. Pending owner confirmation."** Never write the owner as confirmed (design.md Open Questions; confirmation is a human step in 8.4).

## 8. Verification and hand-off

- [x] 8.1 `git diff --stat main -- packages/backend/src/auth/standing-facilitator-access-helper.ts packages/backend/src/routes/topics.ts` is empty.
- [x] 8.2 Run the full backend unit and integration suites and the frontend suite. Run `openspec validate 232-topic-002-admin-read-audit-no-manager --strict` if the CLI is available. Also confirm the claim the modified `team-content-access` wording now makes about code outside this change: both `teams.ts` admin reads (`admin.membership_list_accessed` ~L441, `admin.team_detail_accessed` ~L600) await an uncaught `INSERT INTO audit_log` before the send. Record the line numbers for the PR description (8.4). A test is optional.
  - *Implementation note:* suites run green against real Postgres/Redis (`REQUIRE_DB=1`); `teams.ts` evidence recorded in `handoff-drafts.md` (inserts L433–445 / L592–607). **`openspec validate … --strict` was NOT run: the `openspec` CLI is not installed in this environment.** Run it before merge.
- [x] 8.3 Audit visibility guard check (design.md D5): run `grep -rniE "audit_log" packages/backend/src --include='*.ts' | grep -v -e __tests__ -e /migrations/`. This is a sweep, not a `FROM audit_log` match, because that misses lowercase SQL, a table name on the next line, `JOIN`, CTEs, subqueries and schema-qualified names. Classify **every** hit in a table: INSERT; read serving an admin; read serving a non-admin (quote its `operation` filter); or comment/identifier only. Every non-admin read must filter `operation` by equality on one named operation (no `LIKE`, prefix, pattern or `IN` list); one that doesn't blocks the PR. The table goes in the drafted PR description (8.4).
- [x] 8.4 Write **one file**, `openspec/changes/232-topic-002-admin-read-audit-no-manager/handoff-drafts.md`, holding drafts for a human or the orchestrator. **Do not run `gh issue comment`, `gh issue create` or `gh pr create`.** Posting, filing and opening the PR are the human's (or the orchestrator's) step; the orchestrator opens the PR. The file contains:
  - **#208 comment (draft):** records the `GET 403 / POST 201` split, links this change, and asks for #208 to be scheduled in the current milestone (a temporary state, not a resting one), and for the decision to go to the executive sponsor if it touches who can shape a team's topics. It presents scheduling as a request, not as decided. It also notes (a) that POST add's `201` returns `displayOrder`, revealing the active-topic count to an EM-admin, and (b) that an EM-admin's topic writes are already audited in-transaction (`topic.custom_added`, `topic.archived`, …), the stop-gap #208 relies on. It does not recommend an answer.
  - **#238 comment (draft):** revisit admission once reporting chains exist; until then `actor_roles` on the TOPIC-002 rows plus the 7.8 review queries are the compensating control.
  - **Follow-up issue bodies to file (drafts):** (3) bar an admin from changing their own membership role on a team, or require a second admin (Security §8; **file**, not optional); (8) a root error handler that returns the standard envelope with a correlation id and logs error detail server-side (Security §3a); (9) generalise the audit-visibility guard in `audit-logging-operations`, with a structural test (Security §5).
  - **Optional follow-ups, not drafted:** proposal follow-ups 4 (machine-readable `code` on forbidden envelopes), 5 (audit TOPIC-002's pre-existing non-admin `403`s under SEC-13) and 6 (`404` for a canonical UUID that names no team), listed one line each so the human decides rather than forgets.
  - **PR description (draft):** the sentence "AC1 is met by a recorded deviation: Q1 decided independently of #208 (owner decision, proposal §Decision recorded)"; the 8.1 empty-diff evidence; the 8.2 `teams.ts` line-number evidence; the 8.3 guard classification table; the review-query owner as "proposed, pending Brian"; the optional follow-ups 4–6 as "optional, not drafted"; and the release-note gate: #187 Follow-up 5's line stays blocked until this merges. Approved wording: "Engineering managers, including administrators who manage the team, cannot read the team's definitions." It must not claim managers cannot change topics.
  - **Human steps (open decisions, not agent work):** (a) Brian confirms the review-query owner and cadence (proposal follow-up 10; proposed: Security (Tomás Ferreira), monthly, no alerting); the PR may merge with "proposed" but not with the line missing; (b) Brian either accepts the AC1 deviation sentence or amends AC1 on #232 (follow-up 7); (c) after merge, unblock #187 Follow-up 5's release note using the approved wording (the agent edits no release notes in this change); (d) decide whether to schedule #208 in the current milestone; (e) post the #208 and #238 comments and file issues 3, 8 and 9.

## Task review disposition

Responding to `tasks-review-architect.md` (Ingrid Sollenberger) and `tasks-review-ba.md` (Marcus Delgado). Task numbers 3.0, 4.1 and 7.7 are retired; their content moved as shown. All accepted; none changes the authorization design.

| Finding | Disposition | Where |
|---|---|---|
| Arch B1: parity fake goes red inside the unit | Accepted. Old 4.1 moved into the atomic unit as 2.4a; 4.2 stays after it. | 2.4a, 4.2 |
| Arch B2: name the suites the unit leaves green | Accepted. Unit closes with 2.5 (full unit + integration + frontend). 5.3's list gains `template-team-topic-writes-integration` and `template-team-read-surfaces-integration`, plus three more suites found calling `/topics/all` (`template-team-topic-lock`, `topic-write-rate-limit-thresholds`, `session-topic-snapshot`). | 2.5, 5.3 |
| Arch S1: fixture first, own green step | Accepted. Old 3.0 is now 2.0, a refactor green against today's handler; its router pre-answers the new queries. | 2.0 |
| Arch S2: fold 7.7 comments into the code tasks | Accepted. Authorization comment in 2.2, `canAddTopics` comment in 2.3; 7.7 deleted. | 2.2, 2.3 |
| Arch S3: decide the export | Accepted: export the D3 message constants. | 2.1; design.md D3 |
| Arch S4: decide the integration file | Accepted: new `topic-002-admin-audit-integration.test.ts`. | 5.1, 5.2 |
| Arch S5: deployment.md counts and "same transaction" | Accepted. Re-derive sub-count and total from the list; correct the admin-reads clause at ~L291. | 7.8 |
| Arch S6: "both" → "all three" | Accepted. | 6.2 |
| Arch hand-off table | Accepted. Single `handoff-drafts.md`; no `gh` posting; orchestrator opens the PR; owner "proposed, pending Brian"; AC1 amendment and release-note unblock as human steps; follow-ups 4–6 "optional, not drafted"; guard table into the PR draft. | 7.8, 8.3, 8.4 |
| BA G1: counts match the response | Accepted. | 3.3, 5.1 |
| BA G2: team with no definitions still audited | Accepted. | 3.5 |
| BA G3: `http_status` and `endpoint` values | Accepted. | 3.3 |
| BA G4: event precedes the floor | Accepted, on both outcomes. | 3.1 |
| BA G5: actor columns on the rows | Accepted. | 5.1 |
| BA G6: link stays visible | Accepted as a #232 comment on the existing `TeamPage` link test. | 6.1 |
| BA G7: `teams.ts` compliance evidence | Accepted as a recorded check with line numbers. | 8.2, 8.4 |
| BA G8: owner decision and optional follow-ups in the hand-off | Accepted. | 8.4 |
| BA 5.1 notes: exact message; `membership_role = "participant"` | Accepted. | 5.1 |
