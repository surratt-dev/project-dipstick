# Scenario → test table: 208-member-admin-topic-writes (#208)

Task 6.3 (BA F7). Prepared by Marcus Delgado (BA), 2026-10-08.

Every scenario in the eight delta specs under `specs/` has one row. Each row cites the test(s) that assert it. I grepped every cited test and read its assertions; a name alone was not accepted. Status:

- **existing**: the test was already on `main` and passes unmodified (comment-only edits count as existing).
- **converted**: an existing test whose expectation this change flipped or parametrised (for example 403 → 200, or one case → three).
- **new**: a test added by this change.

Suites at the gate (orchestrator-verified): shared 30; backend 1773 passed / 3 skipped; frontend 718; lint 0 errors; build ok.

Path prefixes: `B/` = `packages/backend/src/routes/__tests__/`, `F/` = `packages/frontend/src/pages/__tests__/`. Line numbers are as of this branch.

**Result: 87 scenarios, 86 covered, 1 uncovered** (`team-content-access` "Application Admin who adds themselves to a team is detectable from audit log"; see the end of this file). Task 6.3 stays unchecked.

## add-custom-topic (8)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 1 | A valid request creates a custom topic | existing | `B/topics.test.ts` L439 "creates a topic and returns 201 with the expected response shape" |
| 2 | An application administrator who is not a team member creates a custom topic | existing + new | `B/topics.test.ts` L819 "an application_admin (%s) on an unlocked team gets 201, appended last, …" (non-member case); `B/topic-add-admin-integration.test.ts` L73 "non-member admin (2.1): 201, appended last, …"; `B/topic-write-member-admin-integration.test.ts` L90 "add by an admin with membership none: …" (asserts `displayOrder` n + 1 in response and DB) |
| 3 | An application administrator who is a team member creates a custom topic | existing + new | `B/topic-add-admin-integration.test.ts` L73 "member admin (2.2): 201, appended last, exactly one topic.custom_added row attributed to application_admin"; `B/topics.test.ts` L819 (member case, asserts the row is on the insert's transaction client); `B/topic-write-member-admin-integration.test.ts` L90 "add … membership participant" |
| 4 | A new topic is appended to the end of the display order | existing | `B/topics.test.ts` L491 "assigns displayOrder = n + 1 when appending to a non-empty topic list" |
| 5 | An optional firstSessionDescription is stored when provided | existing | `B/topics.test.ts` L459 "persists an optional firstSessionDescription when provided" |
| 6 | A valid request omitting firstSessionDescription succeeds | existing | `B/topics.test.ts` L477 "succeeds with firstSessionDescription set to null when omitted" |
| 7 | An administrator's add does not change a session whose room is already open | existing | `B/topic-add-admin-integration.test.ts` L127 "2.7: an admin add while a room is open leaves the open session's session_topics unchanged and reaches the active configuration" |
| 8 | An application administrator who is the team's engineering manager can add a custom topic to that team | new | `B/topic-write-member-admin-integration.test.ts` L90 "add by an admin with membership engineering_manager: admitted, persisted, exactly one add audit row" (201, `displayOrder` n + 1 in response and DB, exactly one `topic.custom_added` row for this actor + team with `actor_global_role = application_admin`) |

## remove-topic (5)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 9 | A valid request archives an active topic | existing | `B/topics.test.ts` L1113 "a standing facilitator who is not a team member succeeds"; `B/remove-topic-integration.test.ts` L61 "archives a topic with no open action items, sets provenance, …" (DB status); `B/session-topic-edit-isolation-integration.test.ts` L151 "… it is absent from the next snapshot" |
| 10 | An application administrator can archive a topic for any team | existing + new | `B/topics.test.ts` L1123 "an application_admin succeeds for any team, including one they are an active member of"; `B/topic-write-member-admin-integration.test.ts` L90 "archive by an admin with membership none / participant / engineering_manager" (all three memberships, 200, `status: archived` in response and DB) |
| 11 | Historical vote data is preserved after archiving | existing | `B/session-topic-edit-isolation-integration.test.ts` L151 "an archived topic's past rows stay in history and trends, and it is absent from the next snapshot" |
| 12 | An in-progress session is unaffected by a concurrent archive | existing | `B/session-topic-edit-isolation-integration.test.ts` L87 "edits after room open leave the open session's rows unchanged and reach the next session" (archives Two after room open; Two stays at position 2 in the session) |
| 13 | An application administrator who is the team's engineering manager can archive one of that team's topics | new + existing | `B/topic-write-member-admin-integration.test.ts` L90 "archive by an admin with membership engineering_manager: …" (exactly one `topic.archived` row, actor + team + `application_admin`); `B/topic-002-admin-audit-integration.test.ts` L286 "TOPIC-004: an admin with a engineering_manager membership still archives a topic on an unlocked team (200 + topic.archived row)" |

## restore-topic (7)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 14 | A valid request restores an archived topic | existing | `B/topics.test.ts` L1685 "a standing facilitator who is not a team member succeeds"; `B/restore-topic-integration.test.ts` L61 "restores an archived topic, appending it at max(active display_order) + 1, …" |
| 15 | An application administrator can restore a topic for any team | existing + new | `B/topics.test.ts` L1695 "an application_admin succeeds for any team, including one they are an active member of"; `B/topic-write-member-admin-integration.test.ts` L90 "restore by an admin with membership none / participant / engineering_manager" |
| 16 | A restored topic is appended, not returned to its prior position | existing | `B/topics.test.ts` L1824 "appends the restored topic at max(active display_order) + 1"; `B/session-topic-edit-isolation-integration.test.ts` L187 "archiving then restoring a topic during the draft puts it in the snapshot at its appended position" (first topic restored lands last, not first). Note: no test uses the spec's literal 1,3,4 → 5 fixture; the rule (max + 1, not prior slot) is asserted. |
| 17 | A restored topic's historical vote data remains accessible | existing | `B/restore-topic-integration.test.ts` L216 "restoring a topic leaves its existing votes and session_topics records unchanged" |
| 18 | A restored topic is included in the next room-open snapshot | existing | `B/session-topic-edit-isolation-integration.test.ts` L187 (restored topic in the snapshot); L87 (Three archived and restored is in the next session's snapshot) |
| 19 | A topic archived and restored during the draft lands at its appended position | existing | `B/session-topic-edit-isolation-integration.test.ts` L187 "archiving then restoring a topic during the draft puts it in the snapshot at its appended position" |
| 20 | An application administrator who is the team's engineering manager can restore one of that team's topics | new | `B/topic-write-member-admin-integration.test.ts` L90 "restore by an admin with membership engineering_manager: …" (200, `status: active` in response and DB, exactly one `topic.restored` row) |

## reorder-topics (6)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 21 | A valid full ordering is persisted densely and 1-based | existing | `B/topics-integration.test.ts` L530 "5.1: persists a dense 1..N order in the submitted order, and both GET endpoints return it"; `B/topics.test.ts` L2423 "renumbers in two phases, … returns dense 1-based order" |
| 22 | The read endpoints reflect the saved order | existing | `B/topics-integration.test.ts` L530 (same test; asserts TOPIC-001 and TOPIC-002 order) |
| 23 | Reorder closes gaps left by earlier archives | existing | `B/topics-integration.test.ts` L552 "5.1: closes gaps 1,2,4,7 to 1..4" |
| 24 | An application administrator can reorder any team's topics | existing + new | `B/topics-integration.test.ts` L562 "5.1: an application_admin succeeds, including one who is a member of the team"; `B/topic-write-member-admin-integration.test.ts` L90 "reorder by an admin with membership none / participant / engineering_manager" |
| 25 | Archived topics' display_order is untouched by reorder | existing | `B/topics-integration.test.ts` L575 "5.1: archived rows are not modified by a reorder" |
| 26 | An application administrator who is the team's engineering manager can reorder that team's topics | new | `B/topic-write-member-admin-integration.test.ts` L90 "reorder by an admin with membership engineering_manager: …" (200, submitted order in response and DB, exactly one `topic.reordered` row) |

## topic-annotation (4)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 27 | TOPIC-001 carries no annotation fields | existing | `B/topic-annotation-integration.test.ts` L510 "TOPIC-001 topic entries carry no annotation fields (security R7)"; `B/content.test.ts` L1936 "does not select team_annotation or its provenance" |
| 28 | An engineering manager never sees the annotation through TOPIC-001 | existing | `B/topic-annotation-integration.test.ts` L571 "TOPIC-001 called by an engineering manager is 403 and leaks no annotation (security S1)" |
| 29 | An administrator who manages the team reads the annotation through TOPIC-002, read-only and audited | converted | `B/content.test.ts` L1131 "#208: an application_admin with an engineering_manager membership gets 200 with topic data and exactly one access row recording engineering_manager" (X/Y in response, `annotated_count` 2, neither text in row metadata or event payload); `B/topic-002-admin-audit-integration.test.ts` L122 "admin with an engineering_manager membership (#208): 200 with both definitions, …" (real Postgres) |
| 30 | An administrator who manages the team still cannot change the annotation | new | `B/topic-annotation-integration.test.ts` L390 "an application_admin with membership role engineering_manager / participant: PUT annotation -> 403 and the annotation columns are unchanged" |

## team-content-access (10)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 31 | Application Admin can access team membership list | existing | `B/teams.test.ts` L205 "3.7: Application Admin gets 200 on membership list and audit log is written" |
| 32 | Application Admin is denied trend data | existing | `B/content.test.ts` L309 "returns 403 and writes audit log for Application Admin (Task 5.12)"; `B/e2e-content-auth.test.ts` L878 "admin request to trends endpoint: 403 AND audit log written". Note: the "does not confirm whether Team A has trend data" clause is held by the denial running before any trend read (the audit insert is the only query after the grant); no test compares bodies for a team with and without trends. |
| 33 | Application Admin who adds themselves to a team is detectable from audit log | **UNCOVERED** | None. See "Uncovered" below. |
| 34 | Application Admin reads topic configuration through TOPIC-002, not TOPIC-001 | existing + new | `B/content.test.ts` L658 "admin with no membership → 403 with exactly one admin.session_content_denied audit row" (asserts `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`); `B/content.test.ts` L1106 "#208: an application_admin with no membership gets 200 and one access row …"; `B/topic-002-admin-audit-integration.test.ts` L160 |
| 35 | A non-member admin's TOPIC-002 read is audited | existing + new | `B/topic-002-admin-audit-integration.test.ts` L160 "admin non-member, roles {application_admin}: 200 and one access row with exact counts and actor_roles" (`membership_role: null`); `B/content.test.ts` L1106 (no-membership case) |
| 36 | An admin with a participant membership reads TOPIC-002 and is audited | existing + new | `B/topic-002-admin-audit-integration.test.ts` L208 "admin with a participant membership: 200 and the access row records membership_role participant"; `B/content.test.ts` L1106 (participant case) |
| 37 | An admin who is the team's engineering manager reads TOPIC-002 and is audited | converted | `B/topic-002-admin-audit-integration.test.ts` L122 (200, definitions present, `canEditAnnotations: false`, one text-free access row with `membership_role: engineering_manager`, zero `admin.topic_config_denied` rows); `B/content.test.ts` L1131 |
| 38 | A global engineering manager with a participant membership is denied TOPIC-002 | existing | `B/topic-002-admin-audit-integration.test.ts` L222 "global engineering manager with a participant membership: 403 and no admin.* row"; `B/content.test.ts` L1890 "3.7: a global engineering_manager with a participant membership gets 403 NOT_A_FACILITATOR and no admin.* insert" |
| 39 | A failed admin-read audit write returns no data | existing | `B/content.test.ts` L1758 "3.4: a rejected access insert is 500 with no topic data and one admin.audit_write_failed" |
| 40 | Application audit-log reads for non-admin callers filter by exact operation | existing | `B/content.test.ts` L240 "includes SEC-26 connectionRecoveries for a facilitator, filtered explicitly to session.connection_recovered (task 5.2)" (asserts `operation = '…'`, no `LIKE`, no prefix). Grep check this gate: `content.ts` (~L1115) is the only non-test `SELECT … FROM audit_log` in `packages/backend/src`, so this test pins every such query today. An automated source scan is a follow-up (security D-5, alongside #264). |

## topic-management-screen (13)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 41 | An eligible facilitator sees the active topic list with full configuration per row | existing | `F/TopicManagementPage.test.tsx` L108 "renders each active topic's prompt, vote type, and description, with a Remove action" |
| 42 | An ineligible caller sees an access-denied state, not the topic list | existing | `F/TopicManagementPage.test.tsx` L139 "shows an access-denied state, not the topic list, for a 403 response"; the caller classes are pinned by the backend: `B/content.test.ts` L1207, L1218, L1890 |
| 43 | The access-denied state shows the server's reason when one is given | converted | `F/TopicManagementPage.test.tsx` L177 "#232: a 403 with an envelope message renders that exact message" (re-anchored on the `FACILITATOR_IS_TEAM_MEMBER` message, task 4.2; asserts no topic, definition, button or textbox) |
| 44 | The access-denied state falls back to the generic message | existing | `F/TopicManagementPage.test.tsx` L190 "#232: a 403 with a JSON body that is not an envelope with a message renders the fallback" |
| 45 | A 403 with a non-JSON body is not shown as a network error | existing | `F/TopicManagementPage.test.tsx` L198 "#232: a 403 with an HTML body / an empty body (not JSON) renders the fallback, not the network error" |
| 46 | A locked team's screen shows topics read-only, without a Remove action | existing | `F/TopicManagementPage.test.tsx` L124 "does not show the Remove action when the team's customization lock is active" |
| 47 | An administrator who manages the team sees the screen | new + converted | `F/TopicManagementPage.annotation.test.tsx` L886 "an administrator who manages the team has the topic write controls but no definition controls" (admin-shaped 200 renders active rows and the archived list); backend half: `B/topic-002-admin-audit-integration.test.ts` L122 (EM-member admin gets 200 with active and archived lists) |
| 48 | An administrator who manages the team has the topic write controls | new | `F/TopicManagementPage.annotation.test.tsx` L886 (Remove and move controls per row, reorder groups, "Add custom topic", Restore in the archived list, no definition add/edit control); backend half: `B/topic-add-flag-parity.test.ts` L186 row "application_admin with an engineering_manager membership" (`canAddTopics: true`) |
| 49 | A facilitator can navigate to Topic Management from the team page | existing | `F/TeamPage.test.tsx` L150 "renders a discoverable Topics nav link to /team/:teamId/topics" |
| 50 | An administrator who manages the team sees the link and the screen | existing + new | Link: `F/TeamPage.test.tsx` L150 (link is unconditional, not hidden by role or membership; comment reworded, task 4.3). Screen: `F/TopicManagementPage.annotation.test.tsx` L886 and `B/topic-002-admin-audit-integration.test.ts` L122 (mapping per tasks.md section 4, BA F5) |
| 51 | A locked team shows no definition controls | existing | `F/TopicManagementPage.annotation.test.tsx` L854 "a locked team shows no definition controls and the exact full lock notice" |
| 52 | An administrator sees definitions read-only | existing | `F/TopicManagementPage.annotation.test.tsx` L872 "an administrator (canEditAnnotations false) sees definitions read-only"; `B/content.test.ts` L1455 "an application admin still receives teamAnnotation and annotationUpdatedBy, read-only (security R4)" |
| 53 | An administrator who manages the team sees definitions read-only | existing + converted | `F/TopicManagementPage.annotation.test.tsx` L872 (fixture comment extended, task 4.4: membership is irrelevant to the page); backend half: `B/topic-002-admin-audit-integration.test.ts` L122 (definitions returned, `canEditAnnotations: false`) |

## topic-customization-lock (34)

### The all-topics endpoint uses the standing, org-wide facilitator authorization model (17)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 54 | A standing facilitator with no session history for the team can list its topics | existing | `B/content.test.ts` L1084 "a standing facilitator with no session history for the team can list its topics" |
| 55 | An application admin with no membership on the team can list its topics | existing + new | `B/topic-002-admin-audit-integration.test.ts` L160 (200, one active + one archived); `B/content.test.ts` L1106 (no-membership case) |
| 56 | An application admin with a participant membership can list the team's topics | existing + new | `B/topic-002-admin-audit-integration.test.ts` L208; `B/content.test.ts` L1106 (participant case) |
| 57 | An application admin who is the team's engineering manager can list the team's topics | converted | `B/topic-002-admin-audit-integration.test.ts` L122 (200, active + archived, `canEditAnnotations: false`, `canAddTopics: true`, one access row with `membership_role: engineering_manager`, no denial row); `B/content.test.ts` L1131 |
| 58 | An application admin whose membership was removed is recorded as having none | existing | `B/topic-002-admin-audit-integration.test.ts` L248 "admin whose engineering_manager membership was removed: 200 and one access row with membership_role null" (rationale comment reworded, task 2.6) |
| 59 | An application admin's request for a team id that names no team is audited like any other read | existing | `B/topic-002-admin-audit-integration.test.ts` L262 "admin, canonical UUID that names no team: 200 unchanged, one access row with the requested team_id, zero counts and team_found false"; `B/content.test.ts` L1720 "3.3: team_found is false when the team lookup returns no row" |
| 60 | An unexpected authorized role fails closed (unit test only) | existing | `B/content.test.ts` L1916 "throws on unexpected authorized role %j, and the message names no role" (engineering_manager, engineer, Application_Admin, "application_admin ", ""), with L1911. Note: the tripwire is called at `content.ts` L812, before the membership read; the unit test asserts the throw and the role-free message, as the scenario's "unit test only" allows. |
| 61 | A non-canonical team id is still 404 | existing | `B/content.test.ts` L1972 "a %s teamId is 404 TEAM_NOT_FOUND before any query, with no-store" |
| 62 | A failed membership read fails the request with no data | existing | `B/content.test.ts` L1773 "3.4: a rejected membership read is 500, runs no topic/team/lock query and emits no admin.audit_write_failed" |
| 63 | A failed role-set read fails the request with no data | existing | `B/content.test.ts` L1784 "3.4: a rejected role-set read on an admitted request is 500 with no topic data and no topic query"; L1799 "3.4: a role-set read returning zero rows is 500, not 200 with a defaulted false" |
| 64 | On the administrator arm the audit write precedes the timing floor | new | `B/content.test.ts` L1106 "#208: an application_admin with %s gets 200 and one access row recording it; insert < event < floor < reply" (no membership and engineering_manager cases both run `expectAuditTailOrder`) |
| 65 | The read and the topic-write endpoints agree for an administrator who manages the team | converted | `B/topic-add-flag-parity.test.ts` L186 row "application_admin with an engineering_manager membership" (now `ADMITTED_CAN_ADD`: GET 200 with `canAddTopics: true`, POST 201; the `{ get: 403; post: 201 }` exception was deleted, task 2.4) |
| 66 | A facilitator's request performs no membership-role read | existing | `B/content.test.ts` L1847 "3.6: a non-member facilitator gets 200, canEditAnnotations true, no admin.* insert, and only the helper's team_memberships query" |
| 67 | A global engineering manager is rejected whatever their membership | existing | `B/content.test.ts` L1890 "3.7: a global engineering_manager with no membership / a participant membership / an engineering_manager membership gets 403 NOT_A_FACILITATOR and no admin.* insert" (asserts the exact message) |
| 68 | A caller who is neither a standing facilitator nor an admin is rejected | existing | `B/content.test.ts` L1207 "a caller who is neither a standing facilitator nor an admin is rejected 403" |
| 69 | A facilitator who is an active member of the team is rejected | existing | `B/content.test.ts` L1864 "3.6: a member facilitator gets 403 with the existing message" (exact message); L1875 "3.6: a global facilitator with an engineering_manager membership gets 403 as a member-facilitator"; L1218 |
| 70 | A 403 rejection is not detectably faster than a 200 success | existing | `B/content.test.ts` L1260 "applies the timing floor on the 403 branch"; L1267 "applies the timing floor on the 200 success branch" |

### The all-topics endpoint tells the screen whether the caller can add a custom topic (4)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 71 | A standing facilitator can add topics | existing | `B/content.test.ts` L1413 "canAddTopics is true for a standing facilitator" |
| 72 | An administrator can add topics but cannot edit annotations | existing | `B/content.test.ts` L1419 "canAddTopics is true for an application admin, canEditAnnotations stays false, and the full lists are returned" |
| 73 | The flag agrees with the add endpoint's authorization for every caller class | converted | `B/topic-add-flag-parity.test.ts` L186 "$label" over all ten caller classes (the spec's eight plus two global-EM membership variants), with L182 "the table includes a class that can add"; no exception branch remains |
| 74 | The flag does not depend on the lock | existing | `B/content.test.ts` L1443 "canAddTopics does not depend on the lock: a locked team still reports true for a facilitator" |

### The all-topics endpoint audits every administrator read (13)

| # | Scenario | Status | Test file → test name |
|---|---|---|---|
| 75 | An admin read writes one access row with text-free counts | existing | `B/topic-002-admin-audit-integration.test.ts` L160 (exact metadata, `annotated_count: 2`, counts match the response, `expectNoTopicText`); `B/content.test.ts` L1646 |
| 76 | The access row records the reader's membership role | new + existing + converted | `B/content.test.ts` L1106 (three cases: `null`, `"participant"`, `"engineering_manager"`, each 200 with exactly one row); real Postgres: `B/topic-002-admin-audit-integration.test.ts` L160, L208, L122 |
| 77 | A membership role outside today's set is recorded verbatim (unit test only) | converted | `B/content.test.ts` L1628 "3.2: an unrecognised membership role (observer) gets 200 and is recorded verbatim in the access row and event" (was 403, task 2.3) |
| 78 | An admin read of a team with no definitions is still audited | existing | `B/content.test.ts` L1825 "3.5: a team with topics but no definitions still writes one access row with annotated_count 0" |
| 79 | An admin read of the template team is audited | existing | `B/content.test.ts` L1814 "3.5: an admin read of the template team writes exactly one access row" |
| 80 | The role set is recorded but does not decide admission | existing | `B/topic-002-admin-audit-integration.test.ts` L193 "admin non-member, roles {application_admin,engineering_manager}: 200, actor_roles decodes to the array and the flag is true"; `B/content.test.ts` L1709 "3.3: roles %j record actor_idp_roles_include_em = %s, …" |
| 81 | A backfilled role set records what was known | existing | `B/topic-002-admin-audit-integration.test.ts` L160 (`actor_roles: ["application_admin"]`, `actor_idp_roles_include_em: false`); `B/content.test.ts` L1709 (`["application_admin"]` → false) |
| 82 | The row and event carry exactly the specified keys | converted | `B/content.test.ts` L1646 "3.3: with no membership / an engineering_manager membership, the access row and event carry exactly the specified keys and values, text-free, with actor_roles" (parametrised to add the EM case, task 2.2) |
| 83 | A failed audit write is signalled without data | existing | `B/content.test.ts` L1758 (500, `expectAuditWriteFailed("admin.topic_config_accessed", "audit_insert", "53100")`, the helper checks no DB message is carried) |
| 84 | A failed access-row write fails the request with no data | existing | `B/content.test.ts` L1758 (500, `expectTextFree(res.body)` after the topic and team reads ran) |
| 85 | No admin request writes a denial row | new + converted | `B/content.test.ts` L1106 (none, participant, engineering_manager: zero `admin.topic_config_denied` inserts and events); `B/topic-002-admin-audit-integration.test.ts` L122 (no denial row in the database) |
| 86 | Each admin request is audited separately | existing | `B/content.test.ts` L1834 "3.5a: two admin requests for the same team write two access rows (no deduplication)" |
| 87 | A facilitator read writes no admin row | existing | `B/content.test.ts` L1847; `B/topic-002-admin-audit-integration.test.ts` L234 "non-member facilitator: 200 and no admin.* row" |

(Row count check: 8 + 5 + 7 + 6 + 4 + 10 + 13 + 34 = 87 rows. Row 33 is the uncovered one, so 86 rows cite tests.)

## Uncovered

1. **`team-content-access`, "Application Admin who adds themselves to a team is detectable from audit log".** The scenario names `POST /api/v1/teams/:id/members`. That endpoint does not exist: `packages/backend/src/routes/teams.ts` registers only `GET …/members`, `GET` (team detail), `PATCH …/members/:userId/role` and `POST …/managers`. No backend or frontend test mentions an admin adding themselves. The nearest test, `B/join-links.test.ts` L482 "D11: an application_admin redeeming a valid join link still gets a team membership row", asserts the membership insert and the `join.link_redeemed` event. It does not assert an `audit_log` row whose `actor_user_id` is the admin, and it does not assert that the row precedes later session-content access.

   This scenario predates #208. This change carried it word for word inside the MODIFIED requirement. #208 did not cause the gap, but the rule in tasks.md 6.3 is that any row with no test blocks the PR, so I have not ticked 6.3. A human should choose one of:
   - (a) amend the scenario so it names the real path an admin uses to join a team (join-link redemption, `join.link_redeemed`), and add or extend a test that asserts the audit row's `actor_user_id` and its ordering; or
   - (b) record an explicit, owner-approved exemption for this pre-existing scenario in the PR, with a follow-up issue.

## Weak spots worth knowing (covered, but thinner than the scenario text)

- Row 16: no test uses the literal "prior slot 2, active 1/3/4 → 5" fixture. The append rule is asserted, by mock (L1824) and in real Postgres (edit-isolation L187).
- Row 32: the "does not confirm trend data" clause is held by order of operations (deny before any trend read), not by a body comparison.
- Row 40: one test pins the only non-admin `audit_log` reader that exists today. A second reader would not be caught automatically (security D-5 follow-up).
- Row 60: the tripwire is unit-tested. The "500 before any read" half rests on its call site (`content.ts` L812), which no handler-level test exercises; the spec scenario explicitly scopes this to a unit test.
