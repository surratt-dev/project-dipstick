# Implementation Review (Security): 208-member-admin-topic-writes

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-08
**Scope:** uncommitted diff on `agent-team/208-member-admin-topic-writes` (backend `content.ts`, `topics.ts`, `audit-logger.ts`, tests, `docs/deployment.md`, 08b decision record, frontend 403 comment). Checked against `design.md` (D1–D6) and my `design-review-security.md`.
**Verdict:** **APPROVE.** No blocking findings. Two cosmetic nits (N-1, N-2), and one reminder about the deferred S-1 follow-up.

The owner's decision is not reopened here. I checked that the revert removes only #232's admission bar, and that every control around that bar is still in place.

---

## 1. Verification checklist

| # | Property | Result | Evidence |
|---|---|---|---|
| 1 | TOPIC-002 admin reads fail closed on a membership-read failure | **Holds** | `content.ts`: `readActiveMembershipRole` is awaited before any team, topic or lock query, and a throw propagates to a 500. Test `3.4: a rejected membership read is 500, runs no topic/team/lock query and emits no admin.audit_write_failed` (content.test.ts ~L1773). |
| 2 | Fails closed on a role-set read failure, including zero rows | **Holds** | `readActorRoleSet` runs inside `withAdminAuditFailureSignal` (stage `role_set_read`) and throws on zero rows. Tests ~L1784 and ~L1799: 500, text-free body, no topic query, no insert, signal emitted. |
| 3 | Fails closed on an access-insert failure | **Holds** | Insert runs inside `withAdminAuditFailureSignal` (stage `audit_insert`). Test ~L1758: 500, text-free body, `admin.audit_write_failed` with SQLSTATE only, no access event. |
| 4 | Audit row written before the timing floor and the response | **Holds** | Order is data reads, then `insertTopic002AdminAuditRow`, then `emitAuditEvent`, then `applyTimingFloor`, then `send`. The test `#208: an application_admin with %s gets 200 … insert < event < floor < reply` (content.test.ts ~L1111) covers all three membership states (none, participant, EM) through `expectAuditTailOrder`. The prefix and tail are identical for every membership role, so the response timing reveals nothing about the caller's role. |
| 5 | `assertTopic002AuthorizedRole` intact | **Holds** | The function body is unchanged and is still called before the admin branch and before any data read. The comment keeps the reason (S-2 applied): "a role admitted by the shared helper in future must not reach the data unaudited." The tripwire tests (L1910+) are unchanged. |
| 6 | Shared helper unchanged | **Holds** | `standing-facilitator-access-helper.ts` does not appear in `git diff --stat`. |
| 7 | Facilitator path unchanged | **Holds** | The facilitator arm still skips the membership and role-set reads and writes no `admin.*` row (test 3.6). The member-facilitator 403 (`FACILITATOR_IS_TEAM_MEMBER`) is unchanged. |
| 8 | Global EM, engineer and participant paths unchanged | **Holds** | The `!decision.authorized` 403 branch is untouched. Integration test: a global EM with a participant membership gets 403 and no `admin.*` row. The parity matrix's EM and engineer rows are still `REJECTED`. |
| 9 | TOPIC-007 still refuses admins | **Holds** | No code change in the annotation route. A new real-Postgres test covers admins with EM and participant memberships: PUT returns 403 and the annotation columns are byte-identical before and after. `canEditAnnotations` is still `facilitator` only, and every admin-200 test asserts it is `false`. |
| 10 | No other endpoint widened | **Holds** | The `topics.ts` diff adds comments only (+12, −0, all comment lines). TOPIC-001, sessions and the helper are untouched. The `canAddTopics` expression is unchanged; it now agrees with TOPIC-003 with no exception, and the parity test's `{get:403, post:201}` variant has been removed. |
| 11 | Raw `membership_role`, no allow-list or cast | **Holds** | `adminAudit.membershipRole: string \| null`, assigned directly from the read. The `observer` test was converted, not deleted (200, recorded verbatim in the row and the event). This is the guard against an allow-list being put back. |
| 12 | Audit rows stay text-free | **Holds** | The EM-admin 200 tests (unit and integration) use sentinel definitions and assert that neither the row nor the event contains them. The exact-key test (3.3) is parametrised over all membership states. |
| 13 | Write audit (`topic.*`) still asserted | **Holds** | New file `topic-write-member-admin-integration.test.ts`: 12 cases, each asserting exactly one row attributed to `application_admin`. The "do not weaken" comments now call these rows "the permanent audit record of admin topic writes (#208 decision)". |
| 14 | No leftover runtime references to the retired operation | **Holds** | `admin.topic_config_denied`, `ADMIN_IS_TEAM_MANAGER` and `evaluateAdminTopicConfigRead` now appear only in comments (`audit-logger.ts` history) and in negative test assertions (`toHaveLength(0)`). `AuditEventName` no longer includes the denial operation, so the compiler stops anyone emitting it again. |

Tests run locally, with real Postgres available: `content.test.ts`, `topic-add-flag-parity.test.ts`, `topics.test.ts`, `topic-002-admin-audit-integration.test.ts`, `topic-write-member-admin-integration.test.ts` and `topic-annotation-integration.test.ts`. All 349 tests in those 6 files pass.

## 2. My design-review asks

| Ask | Applied? | Where |
|---|---|---|
| S-2: the tripwire comment keeps its reason | Yes | `content.ts` JSDoc and inline comment, plus the test describe comment. |
| S-3: the hygiene line covers IdP group overlap | Yes | `docs/deployment.md` checklist. The wording matches D6 verbatim: guidance, not a control; review at each access review; `actor_roles` / `actor_idp_roles_include_em` show the manager case. |
| S-4: "join" wording on point-in-time membership | Yes | The 08b record (L86) and `docs/deployment.md` both say membership "is reconstructed from `team.role_changed` / manager-association audit history up to the write's timestamp, not from the current `team_memberships` row. This holds only for membership changes made through the application." Neither file uses stronger wording. |
| D-1: forensic, not detective | Yes | `docs/deployment.md` labels the section "forensic, not monitored" and states there is no cadence and no owner. The old "monthly, Security" proposal and the self-demotion query are gone. 08b L87 says the same. |
| D-2: relaxing other admin restrictions goes back through security review | Yes | 08b L56 names session content as a different data class not covered by R-EXEC-1. |
| §8: must-stay-green fail-closed tests | Yes | Every fail-closed test is either still there or converted. The tests that were removed covered only the deny branch (denial insert, deny-path role-set read, denial row shape). Their admitted-path equivalents remain. |
| Historical denial rows untouched | Yes | No migration. Docs state that historical rows are left as they are. |

## 3. Findings

None blocking.

- **N-1 (cosmetic):** the `admin.audit_write_failed` comment block in `audit-logger.ts` now reads `… stage: "role_set_read" | "audit_insert", errorCode }. errorCode is …`. The payload list was spliced into the prose and a closing fragment was left behind. The fix is to tidy the sentence. It has no behavioural effect.
- **N-2 (cosmetic):** one comment line in the TOPIC-002 admin-arm header in `content.ts` ("(208-member-admin-topic-writes), which reverses #232's admission bar. Every application_admin the shared") runs well past the file's wrap width. Reflow it if the linter or formatter does not.
- **Reminder (not a finding):** the S-1 deferral is accepted. A failed membership read still emits no `admin.audit_write_failed`, and it still fails closed. Make sure the PR description lists it as a candidate follow-up, next to S-4 option (b): membership fields on admin `topic.*` write rows.

## 4. Residual risk (accepted by the owner, restated for the record)

A manager-admin can now read their own team's definitions and reshape the team's agenda. Every such read leaves a durable `admin.topic_config_accessed` row naming the membership role. Every write leaves an in-transaction `topic.*` row attributed to `application_admin`. Nobody monitors these rows. They are forensic evidence only, and the docs now say so honestly. Admins still cannot take part in sessions, TOPIC-001 and TOPIC-007 still refuse them, and the shared helper is unchanged. I have no objection to merging.
