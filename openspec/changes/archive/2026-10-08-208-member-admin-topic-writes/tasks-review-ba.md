# Tasks Review (BA): 208-member-admin-topic-writes

*Reviewer: Marcus Delgado, Business Analyst. Reviewed: `tasks.md` against `proposal.md` and the eight delta specs under `specs/`. Spot-checked existing tests in `packages/backend/src/routes/__tests__/` where the tasks rely on "existing coverage".*

**Verdict: approve with changes.** The tasks cover every capability and every doc the proposal names, and the two pieces of genuinely new work (the 12-case member-admin write matrix, the manager-admin write-controls page test) are there. What is weak is the test side of the translation. Several delta-spec scenarios have no task that names a test for them, one scenario has no test anywhere in the repo today, and the proposal's promise that "the tasks pin each one [constraint] with an existing or added test" is only partly kept. There is also an ordering problem that makes "every section ends green" impossible as written.

---

## 1. Proposal capabilities → tasks

| Proposal item | Task(s) | Status |
|---|---|---|
| TOPIC-002: remove no-manager rule, both `403`s, messages, allow-list | 2.1, 2.2, 2.6 | Covered |
| Remove `admin.topic_config_denied` operation | 1.1, 2.2, 3.3, 7.8 | Covered |
| Keep access row, `membership_role` raw/widened, `actor_roles`, IdP flag | 1.2, 2.3, 2.4, 3.2, 3.3 | Covered |
| Keep `assertTopic002AuthorizedRole` tripwire | 2.5, 3.3 | Covered |
| `admin.audit_write_failed` with one `operation` | 1.3, 3.3 | Covered |
| `canAddTopics` true for every admitted caller; parity exception removed | 2.6, 3.4 | Covered |
| TOPIC-003..006: no behaviour change; helper no diff; `topics.ts` comments only | 5.1, 5.2, standing constraints | Covered |
| Write rows are the permanent record | 3.5, 4.3, 5.1, 7.1, 7.8 | Covered |
| Topic Management screen admits manager-admin | 6.1–6.5 | Covered (see F5) |
| 08b decision record (scope, open item, R-EXEC-1, audit-row content) | 7.1 | Covered |
| BRD FR-8.2, FR-8.7, Constraint 2, FR-1.3, traceability row | 7.2–7.5 | Covered |
| Use Case 08 (alternate flow, actor lines, acceptance criteria) | 7.6 | Covered |
| REST API Contract | 7.7 | Covered |
| `docs/deployment.md` (denied op, review queries, hygiene line) | 7.8 | Covered |
| Main-spec Purpose lines (`reorder-topics`, `restore-topic`) | 8.1 | Covered |
| `Fixture.member` role parameter | 4.4 | Covered |
| Release note gate, scope confirmation, issue actions | 8.4 | Covered |
| Constraints "pinned with an existing or added test" | 3.6 | **Partial** (F2) |
| BREAKING note for TOPIC-002 clients | none | Minor gap (F8) |

Nothing in the proposal is lost. The gaps are in how the spec scenarios become tests.

---

## 2. Findings

### F1 (High). TOPIC-007 for a manager-admin has no test, and no task adds one

`topic-annotation` scenario *"An administrator who manages the team still cannot change the annotation"* requires an `application_admin` **with an active `engineering_manager` membership** to get `403` from `PUT .../annotation` with the annotation unchanged. Task 3.6 lists "TOPIC-007 rejects admins" as an existing regression pin. I checked: every existing admin case in `topic-annotation.test.ts` (L238, L765, L801) uses `mockAuthQuery("application_admin", false)`, a **non-member** admin. `topic-annotation-integration.test.ts` has no manager-admin PUT either. So this is a new scenario with no test.

This one matters more than the others. Once this change lands, the manager-admin is the one person who can read the team's words *and* change its agenda. The thing that still stops them putting words in the team's mouth is TOPIC-007, and nothing pins it for that caller.

**Fix:** add a task (in section 4, real Postgres) for an admin with an `engineering_manager` membership: `PUT` annotation → `403`, the topic's `team_annotation`, `annotation_updated_by` and `annotation_updated_at` unchanged. Do it for a `participant` membership too, since it costs nothing.

### F2 (Medium). Task 3.6 does not pin every constraint the proposal says it pins

The proposal says: "None of these changes, and the tasks pin each one with an existing or added test." Task 3.6 lists five pins. These proposal constraints are missing from it:

- **FR-2.1 / FR-2.2:** a facilitator cannot create a session for a team they belong to. This is the constraint the owner's "except facilitating their own team" protects, and it is not in the list.
- **Admin participation exclusion** (FR-1.3, FR-2.4, #243 D11): no registration, votes or live events. `admin-session-exclusion-integration.test.ts` exists; name it.
- **Global EM `403 NOT_A_FACILITATOR` on TOPIC-003..006** (3.6 says TOPIC-002 only; the proposal says TOPIC-002..006). `topics.test.ts` ~L966 covers it; name it.
- **Timing floor on TOPIC-002 `403` exits.**
- **Audit visibility guard** (the `team-content-access` scenario about exact-operation filters; `content.test.ts` ~L266).

**Fix:** extend 3.6 to name each of these with its test file, so the PR can show one line per constraint and its pin.

### F3 (Medium). Task 4.1 asserts less than the scenarios it implements

The manager-admin TOPIC-002 read appears in three specs with different "THEN"s:

- `topic-customization-lock`: `canEditAnnotations: false` **and `canAddTopics: true`**, active **and archived** lists.
- `team-content-access`: `canEditAnnotations: false`, definitions present, row has no definition text.
- `topic-annotation`: active topic annotated `"X"` **and archived topic annotated `"Y"`**, `metadata.annotated_count = 2`, and neither the row **nor the structured event** contains `"X"` or `"Y"`.

Task 4.1 asserts: `200`, topic data and annotation text present, one access row with `membership_role`, `actor_roles`, annotation text absent from the row, no denial row. It does not mention `canEditAnnotations`, `canAddTopics`, the archived annotation, `annotated_count = 2`, or the event. Task 3.1 (unit) doesn't name them either.

**Fix:** extend 4.1 with the archived `"Y"` topic, `annotated_count = 2`, `canEditAnnotations: false`, `canAddTopics: true`. Add the event-payload "no X / no Y" check to 3.1, since events are asserted at unit level.

### F4 (Medium). Task 4.5 checks the audit row but not the outcome of the write

The write-spec scenarios assert both the audit row and what happened to the data:

- add: "appended at the end of the team's display order" (`displayOrder = n + 1` in the non-member scenario)
- archive: `status: 'archived'` (response and database)
- restore: `status: 'active'`
- reorder: "the submitted order is persisted"

Task 4.5 says each case "asserts success and exactly one in-transaction row...". "Success" could be read as a status code only. If the role ever changes what the write *does* rather than whether it is allowed, a status-only assertion won't catch it.

**Fix:** have 4.5 assert, per endpoint, the response status, the persisted state the scenario names, and the row (`operation`, `actor_global_role`, `actor_user_id`, `team_id`). Also state that "exactly one row" is counted per request, filtered by actor, team and operation, so a shared fixture cannot produce a false pass.

### F5 (Low). Frontend scenarios are about membership the page cannot see

`topic-management-screen` has three manager-admin scenarios: *sees the screen*, *has the write controls*, *sees definitions read-only*. `TopicManagementPage` never knows the caller's membership. It renders whatever TOPIC-002 returns. So these tests are really "an admin-shaped `200` renders correctly", and the membership half is proven by the backend (4.1, 3.4). That is the right design, but the tasks should say it, or a later reader will think the frontend has a membership-aware test. 6.4 hints at this ("membership is irrelevant"). 6.5 doesn't.

**Fix:** one sentence in section 6 saying the frontend tests are fixture-based, the membership half is pinned by 4.1/3.4, and each frontend test name should cite its scenario. The *"sees the link and the screen"* scenario (nav requirement) maps to 6.3 (link) plus 6.4 (screen). Say that too.

### F6 (Medium). The task order breaks the "every section ends green" rule

The tasks say every section must end with the backend and frontend suites green. As ordered, that can't happen:

- **Section 1** removes `"admin.topic_config_denied"` from the `AuditEventName` union while `content.ts` still uses it until section 2. Typecheck fails at the end of section 1.
- **Section 2** deletes the exported message constants that `content.test.ts` imports until 3.3. The suite fails at the end of section 2.
- **Task 4.1** depends on `Fixture.member(..., role)`, but the fixture isn't extended until 4.4.

**Fix:** merge sections 1–3 into one green checkpoint, or reorder them (2 before 1, test edits alongside), and move 4.4 to the top of section 4. This is a sequencing issue, not a scope issue. But if the green-per-section rule stays as worded, the implementer has to break it.

### F7 (Low). No scenario-to-test traceability for the re-stated scenarios

The delta specs restate many scenarios that #232 or earlier changes already test: the template-team read, the no-team UUID, two requests → two rows, failed role-set read, failed membership read, the TOPIC-001-vs-TOPIC-002 admin scenario in `team-content-access`, the backfilled role set, the non-canonical `404`. Tasks 3.3 and 4.6 say "keep" or "confirm green" in general terms but don't map these scenarios to tests. Several existing tests carry #232 wording or setups (`topic-002-admin-audit-integration.test.ts` L118 is the denial test being converted), so a scenario can silently lose its only test during the conversion.

**Fix:** have 8.3 (or a new 8.3a) produce a short scenario → test table in the PR for every scenario in the eight delta specs, marked "existing / converted / new". Most rows will say "existing". The value is in the rows that turn out empty, which is how F1 would have been caught.

### F8 (Low). BREAKING note is not carried to the PR

The proposal marks the TOPIC-002 change BREAKING (permissive direction) for clients that branch on the two removed `403` messages. Task 7.7 updates the contract, but 8.4 doesn't ask the PR to call out the removed outcomes. Add one line to 8.4: "API: TOPIC-002 no longer returns `ADMIN_IS_TEAM_MANAGER` / `ADMIN_MEMBERSHIP_NOT_ADMITTED`; the only in-repo client handles `403` generically."

---

## 3. Delta-spec scenario coverage (summary)

| Spec | New or changed scenarios | Covered by | Gap |
|---|---|---|---|
| `add-custom-topic` | member admin creates; EM-admin creates | 4.5 | F4 (append order not asserted) |
| `remove-topic` | admin any team ×3 memberships; EM-admin archives | 4.5 | F4 |
| `restore-topic` | admin any team ×3; EM-admin restores | 4.5 | F4 |
| `reorder-topics` | admin any team ×3; EM-admin reorders | 4.5 | F4 |
| `topic-customization-lock` (authz) | participant / EM admin list; removed membership; tail order ×2; read/write agree | 3.1, 3.2, 3.4, 4.1, 4.2 | F3 (`canAddTopics` in 4.1) |
| `topic-customization-lock` (canAddTopics) | parity across 8 caller classes | 3.4 | None |
| `topic-customization-lock` (audit) | membership role ×3; no denial row; failed write signal; key set with EM membership | 3.2, 3.3 | Key-set test with an EM membership: 3.3 deletes the "denial key-set" test, so confirm the access-row key-set test runs with an EM membership |
| `team-content-access` | EM-admin read audited; non-member and participant reads; failed write; visibility guard | 3.2, 4.1 | F2 (guard not named), F3 |
| `topic-annotation` | EM-admin reads X/Y audited; **EM-admin cannot PUT** | 4.1 (partial) | **F1**, F3 |
| `topic-management-screen` | EM-admin sees screen; write controls; read-only definitions; link; server-reason re-anchored | 6.2–6.5 | F5 |

---

## 4. Requirements fidelity notes (no change needed)

- Task 7.1 keeps the owner's words verbatim and limits them to TOPIC-002..006, which is what I asked for in propose-review F1. The open-item wording is right: it records the broader reading without acting on it.
- Task 7.2's FR-8.2 sentence ("in any role") matches the specs' "any value of `team_memberships.role`". Good. The spec also says "today `participant` or `engineering_manager`". Make sure 7.7's REST wording doesn't turn that into a closed list.
- Task 3.3's conversion of the `observer` test is the right way to pin "recorded without an allow-list". Keep it.
- Task 8.4's release-note gate holds up: the old line becomes false the moment this merges.

---

## 5. Requested changes (checklist)

1. **F1:** add a real-Postgres test task: a manager-admin (and a participant-admin) gets `403` on TOPIC-007, annotation unchanged.
2. **F2:** extend 3.6 to name a test per proposal constraint (FR-2.1/2.2 session creation, admin participation exclusion, global EM on TOPIC-003..006, TOPIC-002 `403` timing floor, visibility guard).
3. **F3:** extend 4.1 (archived `"Y"`, `annotated_count = 2`, `canEditAnnotations`, `canAddTopics`) and 3.1 (event has no `"X"`/`"Y"`).
4. **F4:** have 4.5 assert the persisted outcome per endpoint, not only success and the row.
5. **F6:** fix the task order so each section can end green (or reword the rule).
6. F5, F7, F8: low; fold them in if cheap.
