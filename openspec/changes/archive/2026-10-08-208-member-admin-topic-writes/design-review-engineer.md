# Design Review: 208-member-admin-topic-writes — Engineering

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2026-10-08
**Inputs:** `design.md`, `proposal.md`, `tasks.md`, spec deltas, `git show dce3b35` (PR #259), current `packages/`.

## Verdict

**Approve with changes.** It is implementable as written. The boundary is right: the shared helper stays untouched, the change lives in TOPIC-002's admin arm, and writes change in comments only. Nothing new is introduced. Most of the work is deletion plus test conversion, and the risk is small.

I diffed every file #259 touched against the tasks. The revert is **nearly complete**. There is one real gap in test coverage (E1), one task that is much bigger than it looks (E2), and some smaller items listed below. None of them needs a design change. They are task edits.

## Revert completeness: #259 file by file

| File #259 touched | Covered by | Status |
|---|---|---|
| `routes/content.ts`: predicate, `AdminTopicConfigRead`, 2 message consts, deny branch, `Topic002AdminOperation` union, `canAddTopics` comment | 2.1, 2.2, 2.6 | OK. See E4 for the type that has to widen, and E5 for comments. |
| `routes/content.ts`: `assertTopic002AuthorizedRole`, `readActorRoleSet`, `insertTopic002AdminAuditRow`, `withAdminAuditFailureSignal`, access-row tail | 2.3–2.5 (kept) | OK |
| `auth/audit-logger.ts`: `admin.topic_config_denied` union member and comment; accessed and failed comments | 1.1–1.3 | OK |
| `__tests__/content.test.ts`: imports of the message consts, 403 EM test (~L1148), observer test (~L1597), denial key-set test (~L1678), deny-path role-set and denial-insert failure tests (~L1813, ~L1841) | 3.1–3.3 | **Partial.** See E1. |
| `__tests__/topic-002-admin-audit-integration.test.ts` | 4.1, 4.2 | OK. Also update the file header comment (L13 still says "gets 403 and no topic data"). |
| `__tests__/topic-add-flag-parity.test.ts`: `Expected` variant, exception branch, EM-membership row, fake's `INSERT` comment ("_denied") | 3.4 | OK. Also reword the fake's `INSERT INTO audit_log` comment. |
| `__tests__/topic-annotation-integration.test.ts`: access-row assertion | 4.5 (kept) | OK. This is a #259 addition that correctly stays. |
| `frontend/.../TopicManagementPage.tsx`: 403 comment | 6.1 | OK |
| `frontend/.../TopicManagementPage.test.tsx`: envelope-message fixture | 6.2 | OK |
| `frontend/.../TeamPage.test.tsx`: link-not-hidden comment | 6.3 | OK. **Not listed** in the proposal's Impact > Tests line. Add it there. |
| `docs/deployment.md`, BRD, Use Case 08, REST contract | 7.2–7.8 | OK |
| `openspec/specs/*` (6 specs, Purpose lines of reorder and restore) | deltas + 8.1 | OK |
| Migrations | none | Correct. `audit_log.operation` is free text and #259 added no migration. |

I found no structural or source-scanning test that pins the deny path. The only "structural" assertions are `expectNoTopicTeamOrLockQuery` and `expectAuditTailOrder`, which are runtime helpers. Both keep callers after the change (the membership-read failure test and the access-row tail test), so neither becomes dead code.

## Findings

### E1 (should fix): the "unrecognised membership role" test should be converted, not deleted

Task 3.3 deletes the `membership_unrecognised` test (`content.test.ts` ~L1597, `membershipRole: "observer"`). But D2 and the spec delta now **require** the opposite behaviour: "A membership role added later SHALL be recorded verbatim." That is the only test that can pin it, because the DB enum has no third value. Convert it to: `observer` → `200`, one access row with `metadata.membership_role: "observer"`, and event `membershipRole: "observer"`. Without it, someone could put an allow-list back (the obvious "defensive" edit) and every test would still pass.

### E2 (should fix): task 4.4 is new work, and the fixture cannot seed an EM membership

Existing real-Postgres coverage of member admins on writes uses **participant** memberships only: `topic-add-admin-integration.test.ts` (`fx.member`), `remove-topic-integration` L347, `restore-topic-integration` L456, and `topics-integration` L562. `Fixture.member()` in `helpers/real-db.ts` (L236) inserts with no `role`, so it always seeds `participant`. The `engineering_manager` cell of the matrix (4 endpoints × EM) therefore does not exist anywhere yet, and the shared fixture cannot express it.

- Add a role parameter: `Fixture.member(teamId, userId, role = "participant")` with a `$3::membership_role` cast. Then delete the local `membership()` helper in `topic-002-admin-audit-integration.test.ts` (L82), or keep it only for the `removed_at` case.
- Put the 12-case matrix in **one** new file (for example `topic-write-member-admin-integration.test.ts`), not spread across four files. That makes it easy to name in the PR and hard to lose.
- Reword task 4.4 from "Add (or confirm existing…)" to "Add". The "confirm existing" path will be read as permission to skip.

### E3 (minor): the task 8.2 grep will fail on untracked build output

`packages/backend/dist/` is untracked but present locally, and it still contains `ADMIN_IS_TEAM_MANAGER_MESSAGE` and `topic_config_denied` (`dist/routes/content.d.ts`, `dist/auth/audit-logger.d.ts`). Add `--exclude-dir=dist --exclude-dir=node_modules`. Also add `evaluateAdminTopicConfigRead|membership_unrecognised` to the pattern. Expect `auth/role-map.ts:130` and `openspec/specs/oidc-role-mapping` to match "no-manager rule" for an unrelated reason (the OIDC manager-mapping rule, not #187). Add them to the allowed list so the implementer doesn't "fix" them.

### E4 (minor): the `adminAudit` type must widen

`adminAudit.membershipRole` is typed `null | "participant"` (content.ts, the #259 diff). `readActiveMembershipRole` returns `string | null`. Task 2.3 implies the change but doesn't state it. Say it explicitly: `membershipRole: string | null`. Do not cast it to the two known enum values; casting would be a hidden allow-list.

### E5 (minor): comments that tasks 2.5 and 2.6 must catch

These are in `content.ts` and need rewording so the next reader isn't misled:

- L836–839: "either insert … The deny branch below returns before any team-name/topic/lock read …". The deny branch is gone.
- L841–846: "#208 will reopen that helper … silently skipping the no-manager check and audit". This is the in-handler copy, separate from the JSDoc on `assertTopic002AuthorizedRole`.
- **Keep** L825 onward: "Two small reads, not one users/team_memberships join: content.ts runs no SQL against team_memberships (access-control Decision 8)". That rule still holds, and with the guard gone a cleanup pass will be more tempting to fold the reads into one. Task 2.6 says "rewrite the block". Make it say "rewrite, preserving the Decision 8 note".
- Task 1.2 says "#238 compensating control". The audit-logger comment says "no-manager rule". The #238 wording is in `docs/deployment.md` ("Until #238 revisits admission"). Fix the task text so the implementer greps for the right string.

### E6 (note, no action): ordering and timing are sound

With the deny branch gone, the admin arm runs the same queries and tail for every membership role, so it gives no timing signal by role (D3). The membership read stays outside `withAdminAuditFailureSignal`. That matches the spec: a failed membership read is a `500` with no `admin.audit_write_failed` event. The existing "rejected membership read … emits no admin.audit_write_failed" test keeps pinning this. The facilitator arm still issues no extra query. The parity test's `servedMembershipRoles` check (`[]` for non-admins) pins that.

### E7 (note): the frontend needs no code change

`TopicManagementPage` already renders from `canAddTopics` and `canEditAnnotations`. An admin always gets `canEditAnnotations: false`, so a manager-admin sees the read-only screen with no client change. The generic 403 envelope handling stays and stays useful. Task 6.5 is the right new test. Build it on the existing admin fixture so it doesn't duplicate setup.

### E8 (note): no coupling with the parallel change

`openspec/changes/258-template-action-items-read-only/` is exploration only. It references `content.ts:466` (the action-items GET), far from the TOPIC-002 handler. There is no merge risk at the moment. Line numbers in content.ts will shift if 258 lands first. The tasks cite line numbers as "~" so they will still be followed.

## Technology and pattern fit

No new dependency, migration, flag or config. The change keeps the house patterns: the plain awaited insert (teams.ts style), SQLSTATE-only failure signal, timing floor last before send, `describe.skipIf(!infraUp)` integration tests, and `unroutedSql` strict routing in the unit fixture. Rollback is `git revert`. Historical `admin.topic_config_denied` rows stay valid either way.

## Requested task edits (summary)

1. 3.3: convert the `observer` test to "recorded verbatim, 200" (E1).
2. 4.4: "Add", in one new file. Extend `Fixture.member` with a role parameter (E2).
3. 8.2: exclude `dist` and `node_modules`, widen the pattern, and allow-list the OIDC matches (E3).
4. 2.3: state the `string | null` widening (E4).
5. 2.6 and 1.2: name the stale comments in E5. Preserve the Decision 8 note.
6. Proposal Impact: add `TeamPage.test.tsx` and `topic-annotation-integration.test.ts` (kept), and `helpers/real-db.ts`.
