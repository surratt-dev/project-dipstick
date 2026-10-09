# Design: 208-member-admin-topic-writes (#208)

## Context

Topic configuration is served and changed by six endpoints. Five of them authorize through `checkStandingFacilitatorOrAdminAuthorization` (`packages/backend/src/auth/standing-facilitator-access-helper.ts`), which admits:

- `facilitator` AND not an active member of the team, or
- `application_admin`, before it looks at membership.

| Endpoint | Admin arm today (after #232) |
|---|---|
| TOPIC-002 `GET /topics/all` | Admitted only if live membership role is absent or `participant`; EM → `403 ADMIN_IS_TEAM_MANAGER` + `admin.topic_config_denied` row. Every `200` → `admin.topic_config_accessed` row. |
| TOPIC-003 add, -004 archive, -005 restore, -006 reorder | Admitted whatever the membership. In-transaction `topic.*` row with `actor_global_role = 'application_admin'`. |
| TOPIC-001 `GET /topics` | Admins denied, `admin.session_content_denied` (#187). Not touched. |
| TOPIC-007 annotation `PUT` | Admins denied (FR-8.7). Not touched. |

The product owner decided #208, in their words: "No, admins are a trusted role and should not be constrained from any features except facilitating their own team." This change applies that decision to topic configuration (TOPIC-002..006) only; the other administrator restrictions are out of scope and listed in 08b as an open item for the owner. Writes stay as they are; #232's read bar is reverted. The audit on every admin read and write stays.

Fixed role precedence (`role-map.ts`: `application_admin > engineering_manager > facilitator`) means a person in both the facilitator and admin IdP groups resolves to `application_admin` and can change their own team's topics. Under this decision that is intended.

## Goals / Non-Goals

**Goals:**

- TOPIC-002 admits every `application_admin`, whatever their membership role, and audits every one of those reads exactly as today.
- TOPIC-003..006 behaviour is byte-for-byte unchanged and is now stated as a decided rule.
- TOPIC-002 and TOPIC-003 agree for every caller class (parity test has no exception).
- Facilitator, session and annotation-write paths are untouched.

**Non-Goals:**

- Any change to the shared helper, write wrappers' decisions, TOPIC-001, TOPIC-007, sessions.
- Wrapper-collapse refactor; new fields on `topic.*` rows; a migration.

## Decisions

### D1. Revert the admission rule, keep the audit

Remove from `content.ts`:

- `evaluateAdminTopicConfigRead` and the `AdminTopicConfigRead` type
- `ADMIN_IS_TEAM_MANAGER_MESSAGE`, `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE`
- the deny branch (denial insert, event, floor, `403`)
- the `admin.topic_config_denied` member of `Topic002AdminOperation`, so the type (or the field) narrows to `"admin.topic_config_accessed"`

Keep, unchanged in behaviour:

- `assertTopic002AuthorizedRole` (only `facilitator` and `application_admin` reach the data; anything else `500` with no row). Its comment loses the no-manager and "#208 will reopen that helper" wording but keeps, restated, the reason it exists: a role admitted by the shared helper in future must not reach the data unaudited (security S-2).
- `readActiveMembershipRole(session.userId, teamId)` on the admin arm, now audit input only. Its result widens `adminAudit.membershipRole` to `string | null`; it is not cast to the known enum values, because a cast is a hidden allow-list (engineer E4)
- `readActorRoleSet` and the `actor_roles` column, `actor_idp_roles_include_em`
- `insertTopic002AdminAuditRow`, `withAdminAuditFailureSignal`, the `admin.audit_write_failed` signal
- the order on the admin `200`: data reads → access insert → event → `applyTimingFloor` → send

**Why keep the membership read instead of using the helper's `isMember` boolean?** Once the guard is gone, `metadata.membership_role` is the only durable evidence that the reader manages the team, and it is the first thing a reviewer would ask. The cost is one small query, on the admin arm only, on a screen-mount endpoint. Facilitators gain nothing.

**Alternative rejected:** drop the membership read and record `is_member: boolean`. Saves one query, loses the one fact that now matters.

### D2. Record the membership role raw, with no allow-list

`metadata.membership_role` is the live active role value (`null`, `"participant"`, `"engineering_manager"`, or any future enum value) as read. Nothing decides on it, so an allow-list would only manufacture a failure mode. A failed membership read stays fail closed (`500`, no data), same as a failed role-set read or insert: a read is never served unaudited.

Removed memberships (`removed_at` set) are no membership, so they record `null`. That scenario stays as a regression pin.

"Recorded verbatim" needs its own test, because the obvious "defensive" edit is to put an allow-list back. The existing `membership_unrecognised` unit test (`membershipRole: "observer"`) is converted, not deleted: `observer` → `200`, one access row with `metadata.membership_role: "observer"`, event `membershipRole: "observer"` (engineer E1). It is the only test that can pin this, since the DB enum has no third value.

A failed membership read stays outside `withAdminAuditFailureSignal`: `500`, no data, and no `admin.audit_write_failed` event, exactly as today. Security S-1 suggested adding a `membership_read` stage. It is deferred, not adopted here (see disposition); the existing "rejected membership read … emits no `admin.audit_write_failed`" test stays unchanged so the behaviour remains deliberate.

### D3. Handler order after the change

1. Canonical-UUID check (`404` before any query), unchanged.
2. `checkStandingFacilitatorOrAdminAuthorization`; on `!authorized`, the existing `403` branch with timing floor, unchanged.
3. `assertTopic002AuthorizedRole(decision.actorGlobalRole)`.
4. Facilitator: existing reads → floor → send. No new query.
5. Admin: `readActiveMembershipRole` → role-set read → existing data reads → `admin.topic_config_accessed` insert → event → floor → send.

Doing the membership and role-set reads before the data reads (as today) keeps the "fail closed before any data is read" property for those two reads, and keeps the diff minimal. Steps for the admin arm are identical for every membership role, so there is no timing signal by role.

### D4. `canAddTopics` and parity

The expression stays `facilitator || application_admin`. It is now `true` for every caller TOPIC-002 admits with no exception. In `topic-add-flag-parity.test.ts`, delete the `{ get: 403; post: 201 }` variant of `Expected` and its branch; the "admin with EM membership" row becomes `ADMITTED_CAN_ADD`. Keep the `servedMembershipRoles` proof so the parity fake still demonstrates that the membership read ran with the configured role on every admin GET.

### D5. Writes: comments, not code

`topics.ts` wrappers (`checkAddCustomTopicAuthorization`, `checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization`, `checkReorderTopicsAuthorization`) keep their decisions. Comments that say "pending #208" or call the audit row an "interim compensating control" are reworded to "admits `application_admin` whatever their membership (#208 decision)" and "the permanent audit record of admin topic writes (#208 decision) — do not weaken these assertions". Reviewers can confirm with `git diff main -- packages/backend/src/auth/standing-facilitator-access-helper.ts` (empty) and a comment-only diff in `topics.ts`.

### D6. Audit operations and docs

- `audit-logger.ts`: remove `admin.topic_config_denied` from `AuditEventName` and its comment block. Edit `admin.topic_config_accessed` (`membership_role` values, no admission role) and `admin.audit_write_failed` (one operation on this endpoint).
- `audit_log.operation` is free text; historical denial rows are left alone. No migration.
- `docs/deployment.md`: remove the "Review queries (#232 compensating control)" section as a control. Keep one on-demand lookup, no cadence, no owner, labelled **forensic** (used after an incident or on request), not **detective**: nobody monitors these rows, and the docs must not imply that anyone does (security D-1):

  ```sql
  SELECT * FROM audit_log
   WHERE operation = 'admin.topic_config_accessed'
     AND (metadata->>'membership_role' = 'engineering_manager'
          OR 'engineering_manager' = ANY(actor_roles));
  ```

  The self-demotion correlation query goes: demoting yourself no longer unlocks anything.

- Audit-row content, stated once and used verbatim in 08b and `docs/deployment.md` (BA F2): the `admin.topic_config_accessed` row carries no topic names, ids or definition text. The `topic.*` write rows carry topic ids but no topic names or definition text: `topic.custom_added` and `topic.restored` carry `{ topic_id }`, `topic.archived` carries `{ topic_id, openActionItemCount }`, and `topic.reordered` carries `{ previous_order, new_order }` (arrays of topic ids). Verified against `packages/backend/src/routes/topics.ts`. A write row is the record of which topic changed, so its ids are correct and SHALL NOT be stripped to match the read row.
- **Point-in-time membership on write rows (security S-4).** The `topic.*` write rows carry no membership field (non-goal). Joining `actor_user_id` + `team_id` to `team_memberships` gives the membership role **now**, not at the time of the write, because TEAM-005 updates `team_memberships.role` in place. 08b and `docs/deployment.md` use this wording and nothing stronger: "The actor's membership role at the time of a write is reconstructed from `team.role_changed` / manager-association audit history up to the write's timestamp, not from the current `team_memberships` row. This holds only for membership changes made through the application." Adding `membership_role` and `actor_roles` to admin `topic.*` rows is a candidate follow-up for Security, listed in the PR for a human; it is not in this change.
- `docs/deployment.md` hygiene line, with its reason (Exec ask 1) and IdP group overlap (security S-3): "Keep Application Administrator team memberships rare. An administrator who is a team's engineering manager can read that team's definitions and change its agenda (archive, restore, reorder, add). Review `team_memberships` rows held by `application_admin` users at each access review; each should have a stated reason. The same applies to IdP group overlap: an administrator who is also in the manager or facilitator IdP group bypasses those groups' restrictions on topic configuration (role precedence resolves them to `application_admin`); the access row's `actor_roles` / `actor_idp_roles_include_em` show the manager case." This is guidance, not a control.

### D7. Spec delta strategy

Main specs must not keep the old scenarios, or they will win the next argument. Deltas MODIFY or REMOVE every #232 statement listed in `exploration-notes.md` §6, not just add new ones. The TOPIC-002 audit requirement is RENAMED ("…every administrator read and every administrator denial" → "…every administrator read") and then MODIFIED under the new name. Purpose paragraphs of `reorder-topics` and `restore-topic` are not requirement blocks, so sync cannot change them; task 7.1 edits them directly at sync time.

The four write specs get a MODIFIED first requirement whose text and admin scenario say "whatever their membership on the team, in any role, including `engineering_manager` (#208)". The behaviour they assert is what the code does today.

## Risks / Trade-offs

- **[A manager-admin can read the team's definitions and shape its agenda]** → Accepted by the owner (decision record 08b, champion risk note). Mitigations in place: every read and write is durably audited with actor, team and (for reads) membership role; admins still cannot take part in any session; sessions are still run only by a facilitator from outside the team. Suggested, not in scope: give #201 (facilitator-visible provenance) more weight.
- **[Someone later "harmonises" admin writes with the facilitator member bar]** → The BRD, specs and decision record now state the admin grant positively, and the facilitator bar gets its own BRD source (FR-8.2 qualifier).
- **[#232's tests are deleted instead of converted, losing fail-closed coverage]** → Tasks convert tests: EM-member admin → `200` + one access row; fail-closed tests for membership read, role-set read and access insert stay; the tripwire test stays.
- **[Docs overstate what the audit rows prove]** → Rows are labelled forensic, not monitored (D-1), and the write rows' membership role is described as reconstructable from audit history, not from a join (S-4).
- **[Scope creep under the owner's sentence]** → 08b's open item states that relaxing any other admin restriction (session content, TOPIC-001, TOPIC-007, participation) goes back through security review, because session content is a different data class from topic configuration and R-EXEC-1's acceptance does not cover it (security D-2).
- **[Stale release note]** → The #187 Follow-up 5 line becomes false; replacement wording is proposed for owner approval and called out in the PR description.

## Migration Plan

No data migration. Deploy is a single backend + frontend release. Rollback is a revert; historical rows of both operations remain valid either way.

## Open Questions

For a human, not blocking implementation (from `exploration-notes.md` §10):

1. **Owner:** approve the revised #187 release-note line; confirm the optional FR-8.2 facilitator qualifier and the FR-1.3 sentence (this design includes both).
2. ~~**Security:** confirm keeping `membership_role`, `actor_roles`, `actor_idp_roles_include_em` on the access row, and that historical `admin.topic_config_denied` rows stay.~~ **Answered** in `design-review-security.md` §2: keep all three fields (they are now the evidence that a reader manages the team or sits in the IdP manager group); drop the compensating-control framing; historical denial rows are never deleted or rewritten.
3. **Triage:** issue actions in `exploration-notes.md` §7 (#260 moot, #263/#264 body edits, #201 priority, #208 comment), with security's notes: close #260 as **superseded by #208** (not "won't fix"), recording that its no-self-approval proposal returns if an admin's membership role ever matters again; keep #264 open and do not close it as "related to #208". Plus one candidate new issue: membership fields on admin `topic.*` write rows (S-4 option b, owned by Security).

## Design review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran, approve with changes) and `design-review-security.md` (Tomás Ferreira, approve with changes). Neither reopens the owner's decision, and none of the findings changes a decision above. Most are task edits; they are applied to `tasks.md` and `proposal.md` as noted.

| ID | Disposition | Where / rationale |
|---|---|---|
| E1 (convert the `observer` test) | **Accepted.** | D2 now requires the test; task 2.3 converts it. It is the only guard against an allow-list being put back. |
| E2 (old task 4.4 is new work; fixture cannot seed EM) | **Accepted.** | Tasks 1.1 (fixture) and 1.2 (matrix, now "Add", not "confirm existing"): one new file, `topic-write-member-admin-integration.test.ts`, holding the 12-case matrix. `Fixture.member` in `helpers/real-db.ts` gains a `role` parameter (default `participant`). Proposal Impact lists both. |
| E3 (grep in old 8.2 trips on `dist`, misses names, flags OIDC) | **Accepted.** | Tasks 6.2 and 7.2 exclude `dist` and `node_modules`, widen the pattern, and allow-list `auth/role-map.ts` and `openspec/specs/oidc-role-mapping` (an unrelated OIDC manager-mapping rule). |
| E4 (`membershipRole` type must widen) | **Accepted.** | D1 and task 2.9: `string | null`, no cast. |
| E5 (stale comments; Decision 8 note; #238 wording) | **Accepted.** | Tasks 2.15 and 2.12 name the comments to reword, keep the Decision 8 "two small reads" note, and point at the actual "no-manager rule" text. |
| E6, E7, E8 (ordering, frontend, no coupling with 258) | **Noted.** | Agree; no action. The "~" line references in tasks survive line shifts if 258 lands first. |
| Engineer extras (integration header L13, parity fake `INSERT` comment, `TeamPage.test.tsx` / `topic-annotation-integration.test.ts` missing from Impact) | **Accepted.** | Tasks 2.5, 2.4; proposal Impact. |
| S-1 (wrap the membership read in `withAdminAuditFailureSignal`) | **Deferred (not in this change).** | It is reasonable, and the reviewer marks it optional. It adds a new behaviour and a new `stage` value to what is otherwise a pure revert with comment edits, and the current no-signal behaviour is pre-existing and fails closed. Keeping the diff revert-shaped makes it easier to review. The existing test stays unchanged, as the reviewer asked. It is listed in the PR as a candidate follow-up. |
| S-2 (tripwire comment keeps its reason) | **Accepted.** | D1, task 2.14. |
| S-3 (hygiene line covers IdP group overlap) | **Accepted.** | D6, task 5.8. |
| S-4 ("join" overstates point-in-time membership) | **Accepted, option (a).** | D6 wording, used in 08b (task 5.1) and `docs/deployment.md` (task 5.8). The proposal's non-goal is corrected. Option (b) becomes a PR-listed follow-up for Security. The write diff stays comment-only. |
| D-1 (forensic, not detective) | **Accepted.** | D6; 08b and `docs/deployment.md` (tasks 5.1, 5.8). |
| D-2 (relaxing other admin restrictions needs security review) | **Accepted.** | Added to the 08b open item (task 5.1). |
| D-3..D-6 | **Noted.** | D-3 is S-4. D-4 stays a non-goal (#264). D-5 (the visibility guard is enforced only by review) is pre-existing; an automated source scan is suggested for #264. D-6 is S-1. |
| §8 must-stay-green tests | **Accepted.** | Already in section 2 (gate 2.18); the standing constraint in `tasks.md` forbids deleting a fail-closed test without a replacement. |
| #260 / #264 closing notes | **Accepted, for a human.** | Open Question 3 and task 6.4. No issue is edited by this change. |

Nothing was rejected outright; S-1 is deferred with rationale.
