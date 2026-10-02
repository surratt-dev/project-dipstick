# Implementation Review: Security, topic-003-admin-authorization (#176)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** uncommitted working tree on `agent-team/176-topic-003-admin-authorization`, compared against `design.md` and my `design-review-security.md`
**Code reviewed:** `packages/backend/src/routes/topics.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/shared/src/types/topic.ts`, `packages/frontend/src/components/ActiveTopicsEmptyState.tsx`, `packages/frontend/src/pages/addCustomTopic.ts`, `packages/frontend/src/pages/TopicManagementPage.tsx`
**Tests reviewed and run:** `topics.test.ts`, `topic-add-flag-parity.test.ts`, `content.test.ts`, `topic-annotation.test.ts`, `topic-add-admin-integration.test.ts` (backend: 5 files, 302 tests passed; the real-DB integration file ran against Postgres and was not skipped). `TopicManagementPage.empty.test.tsx`, `addCustomTopic.test.ts`, `TopicManagementPage.annotation.test.tsx` (frontend: 3 files, 95 tests passed).

**Verdict:** Approved. **No blocking findings.** Three non-blocking notes (N1 to N3) below. The two human merge gates from the design review (tasks 6.4 and 6.5) are still open, as expected.

---

## 1. The new wrapper: `checkAddCustomTopicAuthorization`

| Property | Result | Evidence |
|---|---|---|
| Decides through `checkStandingFacilitatorOrAdminAuthorization`, not the facilitator-only function | Yes | `topics.ts`, the wrapper body. Same shape as `checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization` and `checkReorderTopicsAuthorization`. |
| Timing floor on **every** reject branch | Yes | There is one reject block. `applyTimingFloor(startTime)` runs before `reply.code(403)` for both `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER`. The shared helper has three `authorized: false` returns (no `users` row, non-facilitator role, member-facilitator). All three reach this block. |
| Reason codes unchanged | Yes | The wrapper sends `decision.reason` as the code. Only the `NOT_A_FACILITATOR` message text changed. It now reads "Only a facilitator or an application admin can add a custom topic.", which matches D2. |
| Fails closed on an unexpected reason | Yes | Any reason other than `FACILITATOR_IS_TEAM_MEMBER` gets the generic `NOT_A_FACILITATOR` message. The code is still the helper's own value, and its type allows only those two values. |
| Check order 403 → 404 → 409 → 422 | Yes, unchanged | Handler: `rejectNonCanonicalTeamId` (shape-only 404, reviewed earlier as M1), then the wrapper, `checkTeamExists`, `checkCustomizationLockGate`, `validateAddCustomTopicBody`. |
| Dead constant removed | Yes | `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` is gone, and `grep "Only a facilitator can add a custom topic" packages/` finds only `packages/backend/coverage/…html`, which is git-ignored build output. |
| `checkStandingFacilitatorAuthorization` has TOPIC-007 as its only caller | Yes | The function is defined at about L88, and its only call is the TOPIC-007 handler (about L1508). The behavior and signature are unchanged; only comments were edited. |

## 2. Rejections that must not regress

- **TOPIC-007 still rejects admins.** The TOPIC-007 call site still uses the facilitator-only check, and the "Do not 'fix' this" comment keeps its substance. The annotation test files (`topic-annotation.test.ts`, `topic-annotation-integration.test.ts`, `TopicManagementPage.annotation.test.tsx`) are **unmodified** (`git diff --quiet` is clean), and their admin → 403 cases pass. `content.test.ts` now also asserts that `canEditAnnotations` stays `false` for an admin.
- **Engineering Managers, engineers and unknown users** get 403 `NOT_A_FACILITATOR`. Tests 2.5 and 2.6 cover each class separately, including the no-`users`-row case (`grant === null`, which is its own return in the helper).
- **Member-facilitator** gets 403 `FACILITATOR_IS_TEAM_MEMBER` with the copy unchanged.
- **Parity test.** The admin rows were flipped to `ADMITTED_CAN_ADD`, and `ADMITTED_CANNOT_ADD` was removed. The EM, engineer, member-facilitator and no-row classes remain `REJECTED`. The test runs both real routers against a SQL-routing fake, so it exercises the real authorization code on both sides.

## 3. Information leakage (403 / 404 / 409)

- Rejected callers against a **locked** team, and against a **nonexistent team with an invalid body**, both get the same 403 with no `error.field`. Test 2.6 asserts `mockDbQuery` was called exactly once (only the auth query), which proves the existence, lock and validation steps never run. That is a strong guard: it shows the team and lock checks were never reached, not just that the status code was right.
- Admins can tell 404, 409 and 201 apart for any team ID. As in the design review, this is no new oracle, because admins can already read existence and lock state through TOPIC-002.
- The admin 201 body contains topic fields only. The exact key set is asserted, `openSessionCreatedAt` is absent in both the unit and real-DB tests, and the handler never calls `readOpenSessionCreatedAt`. The "admins see no session content" boundary holds.
- `FACILITATOR_IS_TEAM_MEMBER` tells a facilitator about their own membership, which they already know. This is pre-existing and unchanged.

## 4. Audit logging

- **Success:** the `topic.custom_added` row is written on the transaction client between `INSERT INTO topics` and `COMMIT`, with `actor_global_role = 'application_admin'` and `metadata = { topic_id }`. The unit test asserts the ordering (insert < audit < commit) and that the row is *not* written through the pool. The real-DB test reads the row back for both the non-member and the **member** admin. This is F1's interim compensating control, and it is now pinned by both test layers.
- **Lock denial:** one `topic.write_denied_locked` row with `actor_global_role = 'application_admin'` and `attempted_operation = 'topic.custom_added'`, and no success row. This is asserted in the unit and real-DB tests.
- **Failures write nothing:** on 403, only the auth query runs, so no audit insert is possible. On admin 404 and 422, the tests assert no `topic.custom_added` row and that `db.connect` is never called (no transaction is opened). The real-DB 422 test confirms the topic list is unchanged.

## 5. Frontend `canAddTopics`: fails closed

- `canAddTopics = data.canAddTopics === true`. A missing, `null` or `false` value is treated as not allowed.
- `addAllowed = !isCustomizationLocked && canAddTopics` now gates **both** the heading trigger and the empty-state action, through the new **required** `addAllowed` prop. The variant no longer carries any permission, so the engineer-review B1 gap (the empty-state button shown from the variant alone) is closed.
- `ActiveTopicsEmptyState` also refuses on its own side: `addAction = addAllowed && variant !== "locked"`. A locked team gets no add action even if `addAllowed={true}` is passed. This is tested.
- Test (e) is parameterized over `canAddTopics` **absent** and **explicitly `false`** (the backend-rollback case). It asserts no "Add custom topic" button anywhere on the page. The component test covers `addAllowed={false}` on both unlocked variants.
- The frontend gate is presentation only. TOPIC-003 enforces on the server, so a drift between the two can hide a control but cannot grant a write.

## 6. Findings

### N1 (non-blocking): the 403 tests prove the floor runs, not that it runs before the send
Test 2.5 asserts `applyTimingFloor` was called once on each 403 branch. It doesn't assert the order of the floor and `reply.send`. The code has the right order, and the TOPIC-004/005/006 suites have the same gap, so I'm not asking for a change here. If the wrapper factory (engineer N1 / F1) is built, put one order assertion there, so it covers all four endpoints at once.

### N2 (non-blocking): no assertion that 403 paths emit no structured audit event
The `mockDbQuery` count proves no `audit_log` row is written on 403. Nothing asserts that `emitAuditEvent` is not called on those paths. The code doesn't emit one there today, so this is test hardening only.

### N3 (non-blocking, pre-existing): rejected TOPIC-003 attempts are not audited
An Engineering Manager probing TOPIC-003 leaves no audit trace, only the request log. This was accepted in the design review (§4), and no admin can reach the 403 path. I'm noting it again because #176 makes TOPIC-003 a higher-value target, which makes EM probing more interesting to detect. It is a candidate for the F7 detection work, not for this change.

### Documentation nit
`design.md` (Open Questions, and the S1 row of the security response table) still points to "task 6.3" for the F1/F2 and IdP-owner merge gates. After the task renumbering, those gates are tasks **6.4** and **6.5**. Fix this when convenient; it doesn't affect security.

## 7. Status of the design-review conditions

| Condition | Status |
|---|---|
| 1. S1: the IdP is the control, each provider is a grant path, the owner is named | The Risks text is done. **Naming the owner per provider is open** (task 6.5 [HUMAN], merge gate). |
| 2. S2: revocation-latency line | Done (Risks, F6). |
| 3. N4: F1 names the audit row as the interim compensating control | Done (`follow-up-issues.md` F1). The row is asserted for both non-member and member admins in the unit and real-DB tests. |
| §5: the admin 201 body has no session fields | Done (unit and real-DB tests). |

The code can merge as soon as tasks 6.4 and 6.5 (the human merge gates) are closed. No security changes to the code are required.
