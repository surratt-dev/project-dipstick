# Implementation Review: 208-member-admin-topic-writes (Architect)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-10-08
**Scope:** uncommitted working tree on `agent-team/208-member-admin-topic-writes` (base `main` = `dce3b35`), against `design.md` D1–D7 and `tasks.md`.
**Verdict:** **Approve.** No blocking findings. Three minor items (comment hygiene, one integration-test assertion that was relaxed), none of which changes behaviour.

---

## 1. Boundaries (standing constraints)

| Constraint | Evidence | Result |
|---|---|---|
| `standing-facilitator-access-helper.ts` has no diff | `git diff main -- …/standing-facilitator-access-helper.ts` is empty | Holds |
| `topics.ts` diff is comment-only | 4 hunks, each adds the two-line "Admits `application_admin` whatever their membership on the team (#208 decision; BRD FR-8.2)" comment to the four wrappers; no code lines touched | Holds |
| No facilitator, session, TOPIC-001 or TOPIC-007 code change | `content.ts` diff is confined to the TOPIC-002 admin arm and its helpers; the TOPIC-001 `isTopicConfigReadAdmitted` predicate and its `membership_em` reason (#187) are untouched | Holds |
| No `topic.*` write-row assertion weakened | `topics.test.ts` and `topic-add-admin-integration.test.ts` diffs are comment-only; the new write matrix adds assertions | Holds |
| No fail-closed TOPIC-002 admin test deleted without replacement | Deleted tests are deny-path only (denial insert failure, deny-path role-set failure, denial key set). Membership-read, role-set-read, access-insert fail-closed tests and the tripwire test remain | Holds |
| No coupling with `258-template-action-items-read-only` | Not touched | Holds |

The decision boundary from D1/D3 is respected: the admission decision still lives only in the shared helper; `content.ts` keeps the audit-only admin arm, and the membership read is now an audit input with no branch on it. The access-control Decision 8 note ("two small reads, not one join") is preserved verbatim.

## 2. Design conformance

- **D1 (revert admission, keep audit).** `evaluateAdminTopicConfigRead`, `AdminTopicConfigRead`, `ADMIN_IS_TEAM_MANAGER_MESSAGE`, `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE`, the whole deny branch (insert, event, floor, `403`) and `dueOperation` are gone. `assertTopic002AuthorizedRole`, `readActiveMembershipRole`, `readActorRoleSet`, `insertTopic002AdminAuditRow`, `withAdminAuditFailureSignal` and the tail order are kept. The tripwire comment keeps the S-2 reason and drops the "#208 will reopen that helper" wording. Conforms.
- **D2 (raw, no allow-list).** `adminAudit.membershipRole` widened to `string | null`; `readActiveMembershipRole`'s result is passed straight through, no cast. The membership read stays outside `withAdminAuditFailureSignal` (S-1 deferred, as designed). The `observer` test is converted (200, recorded verbatim in row and event) with a comment that explains why it must not be "fixed". Conforms.
- **D3 (handler order).** Membership read → role-set read → data reads → insert → event → floor → send. Identical steps for every membership role. Conforms.
- **D4 (parity).** `Expected` loses the `{ get: 403; post: 201 }` variant and its exception branch; the EM-member admin row is `ADMITTED_CAN_ADD`; `servedMembershipRoles` proof kept. `canAddTopics` expression unchanged; only its stale #232 comment removed. Conforms.
- **D5 (writes comments only).** Conforms (see §1).
- **D6 (audit registry and docs).** `admin.topic_config_denied` removed from `AuditEventName`; `admin.topic_config_accessed` comment describes an open set ("any future enum value as-is… nothing checks it against a list"). `docs/deployment.md`: compensating-control section replaced by a single forensic, uncadenced lookup; self-demotion query, owner/cadence line and "#238" line removed; hygiene line (including IdP overlap) added next to the existing group-overlap checklist; S-4 point-in-time wording and audit-row-content wording used verbatim. Conforms.
- **D7 (specs).** Not re-reviewed here beyond the grep in §4; Purpose edits are correctly deferred to task 7.1.

## 3. Pattern consistency

- `Fixture.member(teamId, userId, role = "participant")` with `$3::membership_role` matches the existing `membership()` helper's cast and keeps every existing caller unchanged. The local `membership()` helper is retained only for the `removed_at` case and is labelled so (A3 honoured).
- The new `topic-write-member-admin-integration.test.ts` follows the house real-DB pattern (`probeInfra` / `requireInfraOrThrow` / `describe.skipIf(!infraUp)`, per-test `Fixture`, app cleanup in `afterEach`). Audit rows are counted per request, filtered by actor, team and operation, and asserted with `toEqual([...])` so "exactly one" is real. Persisted outcome is checked in both response and DB for all four writes.
- The TOPIC-007 member-admin pin in `topic-annotation-integration.test.ts` compares the full annotation column triple before/after — the right shape.
- Frontend: comment-only change in `TopicManagementPage.tsx`; the 403 test re-anchors on a literal that matches the backend's `FACILITATOR_IS_TEAM_MEMBER` message (`content.ts:770`) without importing backend code. The new manager-admin page test is fixture-based as section 4 prescribes.

## 4. #232 revert completeness — dead code check

`grep -rn --exclude-dir=dist --exclude-dir=node_modules "no-manager rule|ADMIN_IS_TEAM_MANAGER|ADMIN_MEMBERSHIP_NOT_ADMITTED|topic_config_denied|evaluateAdminTopicConfigRead|membership_unrecognised|membership_em" requirements docs packages` returns only:

- TOPIC-001/#187 `membership_em` (`content.ts:644`, `audit-logger.ts:249`, `content.test.ts` ~L478–587) — unrelated, correct to keep.
- `role-map.ts:130`, `docs/deployment.md:149/250`, BRD L227/L709, personas — the session-participation no-manager rule / OIDC mapping, unrelated.
- Historical/retired mentions explicitly labelled (audit-logger L172, deployment.md L292/L323, REST contract L634/L704, 08b).
- Negative assertions in tests (`… admin.topic_config_denied … toHaveLength(0)`), which are intended regression pins.

No exported symbol, type, constant or message of the #232 admission rule survives in `packages/*/src` (shared and frontend `src` are clean). Test helpers previously used by deleted tests (`expectNoTopicTeamOrLockQuery`, `expectNoTopicQuery`, `buildAppWithReplySpy`, `expectAuditTailOrder`) are all still referenced by surviving tests; the `DENIED_*_KEYS` constants were removed. `packages/backend/dist/` still holds the old names; it is untracked build output and correctly excluded.

The one vestige is deliberate: `Topic002AdminOperation` is now a single-member alias, and `insertTopic002AdminAuditRow` / `withAdminAuditFailureSignal` still take an `operation` parameter that can only have one value. The design allowed "the type (or the field) narrows", and keeping the parameter keeps the diff revert-shaped. Acceptable; not dead code.

## 5. `tsc` claim verification

The engineer reported backend `tsc` (test files included) shows errors "none in lines I wrote". Verified by comparison against `main`:

- Created a detached worktree of `main` (`dce3b35`) in the scratchpad, ran `npx tsc -p tsconfig.json --noEmit` in `packages/backend` on both trees.
- **Branch: 243 errors. Main: 243 errors.** After stripping line/column numbers, the two sorted error lists are **identical** — no error added, none removed. All are pre-existing test-typing issues (`null` passed to Fastify session decorators, `possibly 'undefined'`, etc.) spread across ~45 test files.
- The new file `topic-write-member-admin-integration.test.ts` produces no errors. Errors in touched files (`content.test.ts`, `real-db.ts`, `topic-annotation-integration.test.ts`, `topic-add-flag-parity.test.ts`, `topics.test.ts`) are the same messages as on main at shifted lines.
- `tsc -p tsconfig.build.json` (production source) is clean.
- The worktree was removed (`git worktree remove --force` + `prune`; `git worktree list` shows only the main checkout).

**Claim confirmed.** Note for the record: tasks 2.19 and 1.4 say "`tsc` clean", which is true for the build config only; the test-inclusive config has 243 pre-existing errors on main. That pre-existing debt should get its own issue rather than being implied clean by this change's checklist.

Additionally ran the affected backend suites (`content.test.ts`, `topic-add-flag-parity.test.ts`, `topics.test.ts`, `topic-002-admin-audit-integration.test.ts`, `topic-write-member-admin-integration.test.ts`) against live infra: 5 files, 330 tests, all pass (integration tests executed, not skipped).

## 6. Findings

### Blocking

None.

### Minor (fix before PR; non-blocking)

- **M1. Garbled comment in `audit-logger.ts` (~L212–216).** The `admin.audit_write_failed` payload comment ends with a leftover fragment of the old text: `… #208 removed the denial row), stage: "role_set_read" | "audit_insert", errorCode }. errorCode is the pg SQLSTATE …`. The payload is now listed once in the preceding sentence, so the trailing `stage: … errorCode }.` reads as a broken object literal. Suggest: `… (the row that was due; #208 removed the denial row); stage is "role_set_read" | "audit_insert"; errorCode is the pg SQLSTATE …`.
- **M2. Over-long comment line in `content.ts` (~L780).** `// (208-member-admin-topic-writes), which reverses #232's admission bar. Every application_admin the shared` is ~115 characters, unlike the surrounding ~78-column wrap. Reflow.
- **M3. Integration EM-admin access-row assertion relaxed.** In `topic-002-admin-audit-integration.test.ts` the converted 5.1 test went from an exact `toEqual` on `metadata` to `toMatchObject`, and dropped the "row does not contain a topic id" check that the old denial test had. Text-freedom is still asserted (`expectNoTopicText(row)`) and the exact key set with an EM membership is pinned at unit level (3.3, parametrised), so coverage is not lost. But this is the only real-Postgres proof for the manager-admin row; asserting `JSON.stringify(row.metadata)` contains neither `activeId` nor `archivedId` would make the "no topic ids" claim in D6/08b true at the integration level too. One line; recommended.

### Observations (no action in this change)

- Tasks 6.3 (scenario → test table, full suites) and 6.4 (PR description) remain open, as expected at this stage.
- S-1 (`membership_read` stage on `admin.audit_write_failed`) and S-4(b) (membership fields on admin `topic.*` rows) remain correctly deferred; ensure they appear in the PR's follow-up list.

## 7. Summary

The implementation is a clean, revert-shaped change that matches D1–D6 and respects every standing boundary: helper untouched, `topics.ts` comment-only, no facilitator/session/TOPIC-001/TOPIC-007 code change. The #232 admission rule is fully removed with no dead code; what remains is the audit, deliberately. The new tests (12-case write matrix, TOPIC-007 member-admin pin, converted `observer` test) close the gaps the design reviews named. The `tsc` claim is confirmed: test-inclusive errors are identical to main (243 = 243), build config is clean. Approve, with M1–M3 as pre-PR tidy-ups.
