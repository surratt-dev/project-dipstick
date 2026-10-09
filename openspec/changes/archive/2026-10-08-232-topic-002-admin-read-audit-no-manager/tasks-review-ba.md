# Tasks Review: Business Analyst (Marcus Delgado)

**Change:** 232-topic-002-admin-read-audit-no-manager (#232)
**Reviewed:** `tasks.md` against `proposal.md`, the four delta specs, and the acceptance criteria in issue #232.
**Question asked:** Taken together, do the tasks cover every capability in the proposal and every spec scenario? Is anything lost between the requirements and the tasks?

## Verdict

**Approve, with minor additions.** Nothing blocks. Every issue acceptance criterion and every new or modified behaviour in the proposal has a task, and almost every scenario has a test task that names its assertion. The gaps below are assertions the spec states but no task asks a test to check. Each one is a single line in an existing task. I recommend making the additions before apply, because the spec makes these claims about audit rows and nothing would stop them drifting.

Things the tasks get right and should keep:
- The tasks keep the whole-response deny and the allow-list. No task reduces it to field-stripping.
- 3.0 routes fixture SQL by text, not by position. Without that, the fail-closed tests could pass for the wrong reason, and the task says why.
- The #208 boundary is in the tasks three ways: the standing constraint, the 8.1 empty diff, and the 4.2 parity row with its comment.
- The release-note gate and the AC1 deviation sentence are in the PR description (8.4), so they stay visible.

## 1. Issue #232 acceptance criteria → tasks

| AC | Covered by | Status |
|---|---|---|
| AC1: recorded decision with rationale for Q1 and Q2, consistent with #208 | Proposal §Decision recorded (Q1). Design D5 and the ADDED audit requirement (Q2: durable row, operation names, every admin read). 8.4 states the deviation in the PR description and in the #208 comment. | Met by a declared deviation. Brian needs to accept the sentence or amend the AC. Already tracked as proposal follow-up 7. |
| AC2: admin with an EM membership never gets `team_annotation`; integration tests | 2.1, 2.2 (deny), 3.1, 3.2 (unit), 5.1 first bullet (real Postgres; body and row contain no definition text) | Covered |
| AC3: every admin read that returns topic config writes the agreed record; a test asserts it | 2.3, 3.1, 3.3, 3.5, 3.5a, 5.1, 5.3 | Covered |
| AC4a: non-member admins and standing non-member facilitators still get 200 | 3.1, 3.6, 5.1 | Covered |
| AC4b: member-facilitators still get `403 FACILITATOR_IS_TEAM_MEMBER` | 3.6 (exact message) | Covered (unit only; acceptable, since the code path doesn't change) |
| AC4c: TOPIC-004 through the shared helper unchanged until #208 | Standing constraint, 4.1 (existing rows keep expectations), 4.2, 5.2, 5.3, 8.1 | Covered, with good evidence |
| AC5: specs and the contract row updated | Delta specs (in this change), 7.1 to 7.3 (contract, including Appendix B), 7.4 and 7.6 (BRD), 7.5 (UC 08), 7.8 (deployment.md), 8.2 (`openspec validate`) | Covered |

## 2. Proposal "What Changes" → tasks

| Proposal item | Tasks | Status |
|---|---|---|
| Deny an admin who manages the team: allow-list, two reasons, whole response, no data queries, unconditional | 2.1, 2.2, 3.1, 3.2 | Covered |
| Every admin read audited: row plus event, `actor_roles`, counts-only metadata, fail closed, `admin.audit_write_failed`, empty, template and nonexistent teams | 1.1, 1.2, 2.3, 2.4, 3.3 to 3.5a, 5.1 | Covered, except the gaps in §4 |
| New denial audited | 2.2, 3.1, 3.3, 5.1 | Covered |
| Audit visibility guard | 1.1 (comment), 8.3 (sweep and classification) | Covered as a PR-time check, as the proposal disposition (F3) accepted |
| Screen explains the rule; link stays visible | 6.1, 6.2 | Covered (see §4, G6, on the link) |
| Spec wording for admin-read audits corrected; `teams.ts` already complies | Delta spec only | No task checks the compliance claim. See G7. |
| Regression pins for global EM | 3.7, 4.2, 5.1 | Covered |
| Docs: four delta specs, contract (TOPIC-002, TOPIC-001 caveat, Appendix B), BRD FR-8.7 and Constraint 2, UC 08 | 7.1 to 7.6 | Covered |
| Impact: `docs/deployment.md` Logging section | 7.8 | Covered |
| Follow-ups 1, 2, 3, 7, 8, 9 | 8.4 | Covered |
| Follow-up 10 (owner decision on who reviews the compensating-control queries) | Only mentioned in 7.8 ("Brian confirms the owner") | Not in the 8.4 hand-off list. See G8. |
| Follow-ups 4, 5, 6 (optional issues) | none | Acceptable: they are optional. Listing them in the PR description would keep them from being lost. |

## 3. Spec scenarios → tasks

Pre-existing scenarios that this change carries over unchanged are marked "existing". Their tests stay green under 8.2. 3.0 migrates the admin ones onto the new fixture.

### team-content-access

| Scenario | Task(s) |
|---|---|
| Admin can access membership list / denied trend data / adds themselves | existing |
| Admin reads topic config through TOPIC-002, not TOPIC-001 | 3.1 and 5.1 (TOPIC-002 half); the TOPIC-001 half is existing. No single test runs both halves for one caller. Acceptable. |
| Non-member admin's read is audited (`membership_role = null`) | 3.1, 5.1 |
| Admin with participant membership is audited (`"participant"`) | 3.1 (value), 5.1 (row exists only) |
| Admin who is the team's EM is denied (message, no data, denial row, no access row) | 3.1, 5.1 |
| Global EM with participant membership denied, no `admin.*` row | 3.7, 5.1 |
| Failed admin-read audit write returns no data | 3.4 |
| Failed admin-denial audit write does not become a success | 3.4 |
| Non-admin audit-log reads filter by exact operation | 8.3 |

### topic-annotation

| Scenario | Task(s) |
|---|---|
| TOPIC-001 carries no annotation fields / EM never sees it through TOPIC-001 | existing |
| Admin who manages the team never sees the annotation through TOPIC-002 (active `"X"`, archived `"Y"`) | 5.1 (team with distinct active and archived definitions; body contains neither) |

### topic-customization-lock: all-topics authorization

| Scenario | Task(s) |
|---|---|
| Standing facilitator with no session history | existing |
| Admin with no membership / with participant membership | 3.1 |
| Admin who is the team's EM denied (message, no-store, no data, no query, floor once with start time) | 3.1 |
| Unrecognised membership role (unit only) | 3.2 |
| Removed EM membership is admitted, `membership_role = null` | 5.1 |
| Nonexistent team id audited (`team_found = false`, counts 0, `team_id` = requested id) | 5.1; 3.3 (`team_found` false) |
| Failed membership read | 3.4 |
| Failed denial-row insert | 3.4 |
| Failed role-set read (error or no row) | 3.4 (both paths, and zero rows) |
| Audit write precedes the timing floor (both outcomes) | 3.1 (call order on both). See G4 for the event. |
| No-manager rule does not change topic writes (GET 403 / POST 201) | 4.2; 5.2 (TOPIC-004 in real Postgres) |
| Facilitator performs no membership-role read | 3.6 |
| Global EM rejected whatever their membership | 3.7, 4.2 |
| Neither facilitator nor admin / member-facilitator / 403 not faster | existing; 3.6 (member-facilitator message) |

### topic-customization-lock: `canAddTopics`

| Scenario | Task(s) |
|---|---|
| Standing facilitator can add / flag does not depend on the lock | existing |
| Admin can add but cannot edit annotations | existing, migrated by 3.0 |
| Flag agrees with add authorization for every caller class, including the EM-admin exception | 4.1, 4.2 |

### topic-customization-lock: ADDED audit requirement

| Scenario | Task(s) |
|---|---|
| Admin read writes one access row with text-free counts (`annotated_count = 2`; **`active_count` and `archived_count` match the response**) | 3.3, 5.1 cover `annotated_count` and text-free values. **Matching active and archived counts is not asserted.** See G1. |
| Admin read of a team with no definitions (`annotated_count = 0`) | **No task.** 5.1's nonexistent team gives 0 for a different reason (no team at all). See G2. |
| Template team audited | 3.5 |
| Role set recorded but does not decide admission | 3.3, 5.1 |
| Backfilled role set records what was known | 3.3, 5.1 |
| Rows and events carry exactly the specified keys | 3.3 |
| Failed audit write is signalled without data | 3.4 |
| Failed access-row write | 3.4 |
| No-manager denial writes one denial row (`reason`, **`http_status = 403`**) | 3.1 (reason), 3.3 (key set). **The `http_status` value is not asserted.** See G3. |
| Each admin request is audited separately | 3.5a |
| Facilitator read writes no admin row | 3.6, 5.1 |

### topic-management-screen

| Scenario | Task(s) |
|---|---|
| Eligible facilitator sees list / ineligible caller sees denial / locked team read-only | existing |
| Denied state shows the server's reason | 6.2 |
| Falls back to the generic message | 6.2 |
| Non-JSON 403 is not a network error | 6.2 |
| Facilitator can navigate from the team page | existing (`TeamPage` test, "renders a discoverable Topics nav link") |
| Admin who manages the team sees the link and an explained denial | 6.1 ("do not change the link") plus the existing link test. See G6. |
| Locked team shows no definition controls / admin sees definitions read-only | existing |
| Admin who manages the team sees no definitions | 6.2 |

## 4. Gaps: lost between the requirements and the tasks

None of these blocks. Each one is an assertion the spec makes that no task asks for.

**G1. `active_count` and `archived_count` are never checked against the response.** The ADDED scenario says they "match the response". 3.3 checks the key set and `annotated_count = 2`. 5.1 checks `annotated_count = 2`. Nothing checks the other two values, so an implementation that wrote `active_count: 0` would pass every task. **Add to 3.3:** `active_count` and `archived_count` equal the lengths of the response's `active` and `archived` lists. **Add to 5.1** (admin non-member): `active_count = 1`, `archived_count = 1` for the seeded team.

**G2. No task covers "a team with no definitions is still audited".** This is the reason the audit fires on every read, not only when annotations come back (issue Q2). A test for it protects the decision. **Add to 3.5 or 3.3:** an existing team with topics but no definitions writes one row, with `annotated_count = 0`, `team_found = true` and `active_count > 0`. That separates it from the nonexistent-team case.

**G3. `http_status` values are not asserted.** 3.3 pins the key sets but not the values. The spec fixes `http_status: 200` on the access row and `403` on the denial row. **Add to 3.3:** assert both values. Also assert `endpoint` equals `"GET /api/v1/teams/:teamId/topics/all"`, so the D1 rule that tells this endpoint's rows apart from TOPIC-001's `admin.session_content_denied` by `metadata.endpoint` is tested.

**G4. The structured event's place in the order is not asserted.** The spec says "the audit insert **and its structured event** SHALL complete before `applyTimingFloor`". 3.1 checks insert < floor < reply. **Add to 3.1:** `emitAuditEvent` < floor, on both outcomes.

**G5. The non-metadata row columns are not asserted.** The ADDED requirement fixes `actor_global_role = 'application_admin'`, `actor_ip`, `actor_user_id` and `team_id` on both rows. Only `team_id` is checked, and only for the nonexistent team (5.1). **Add to 5.1:** on the EM-denial row and one access row, assert `actor_user_id` = the caller, `actor_global_role = 'application_admin'`, and `team_id` = the requested team.

**G6. The "link stays visible" scenario has no task that tests it.** I checked `TeamPage.tsx`: the "Topics" link renders whenever `teamId` is set, with no role check, and the existing test covers it. Today the scenario holds without a new test. But the proposal makes "the server is the only gate" a requirement, and the existing test doesn't say that. **Recommend for 6.1:** add a comment to the existing link test citing #232, saying the link must not be hidden by role or membership. Optionally, also render it for a session whose membership role is `engineering_manager`.

**G7. Nothing checks the claim that `teams.ts` already meets the new admin-read wording.** The modified `team-content-access` text now *requires* that every admin read of administrative data be written after the read and before the send, and fail closed. The proposal says `admin.membership_list_accessed` and `admin.team_detail_accessed` already comply. I read `teams.ts` around L428–454: the insert is awaited and not caught, so a failure throws and the request is `500` before any send. The claim holds. But the spec's guarantee now covers code outside this change's tests. **Recommend adding to 8.2 or 8.3:** confirm both `teams.ts` admin reads await an uncaught insert before the send, and cite the line numbers in the PR description. A test is optional. The evidence should still be written down, since the spec text now promises it.

**G8. Follow-up 10 (owner decision) is not in the hand-off list.** 7.8 writes the owner as "proposed", but 8.4 doesn't ask Brian to confirm it. Without that, the compensating control (the two review queries) has no confirmed reviewer, and the dual-hat-without-membership and self-demotion cases rely on it. **Add to 8.4:** "Ask Brian to confirm the review-query owner and cadence (proposal follow-up 10)." Also list the optional follow-ups 4 to 6 in the PR description, so they aren't lost.

## 5. Smaller notes (no action required)

- **5.1, EM-denial bullet:** it asserts `403` but not the exact message. 3.1 covers the message at unit level. Adding the message check to the integration test costs nothing and matches AC2's "integration tests cover this".
- **5.1, participant-membership bullet:** it asserts the row exists. Adding `membership_role = "participant"` makes it the real-Postgres proof that `readActiveMembershipRole` returns the right value, which matters more than the mock in 3.1.
- **UC 08 (7.5):** the alternate flow quotes the message exactly. That is right; it keeps the use case, the spec and the frontend test (6.2) on the same string.
- **Ordering:** 2.4 depends on 1.2, and the atomic unit (2.1 to 2.4 plus 3.0) is clearly fenced. Implementation order is sound.

## Summary for the team

The tasks are faithful to the proposal and the specs. The candour argument, the whole-response deny, the #208 boundary and the fail-closed audit all come through intact. What's missing is a handful of value assertions on the audit row: the counts, `http_status`, `endpoint`, the actor columns, and the event-before-floor order. The spec promises them and no test would catch them drifting. Add G1 to G5 to tasks 3.1, 3.3 and 5.1, and G7 and G8 to section 8, and this is ready to apply.
