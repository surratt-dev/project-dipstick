# Proposal: 208-member-admin-topic-writes (#208)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised 2026-10-08 after the product owner's decision). The two explore reviews in this folder reviewed the superseded recommendation (option A) and are kept as history. They are not the live position.*

## Why

#208 asked a question we had left open on purpose: may an Application Administrator who is also a member of a team change that team's topics? And #232 (PR #259) answered a narrower version of it on the read side by refusing TOPIC-002 to an admin who manages the team. That left us with a `GET 403 / POST 201` split for the same person on the same team, recorded in the parity test as temporary.

The product owner has now decided, and the decision is final. In the product owner's words, answering #208:

> "No, admins are a trusted role and should not be constrained from any features except facilitating their own team."

Chosen outcome, as selected by the product owner: **"No bar, and undo #232."** No bar on member-admin topic writes, and undo #232's read bar.

**Scope of this change.** It applies the decision to topic configuration only: TOPIC-002 (read) and TOPIC-003..006 (add, archive, restore, reorder). The owner's sentence is broader than that, and read literally it would reach other administrator restrictions that this change keeps (listed under "Constraints"). Those are not changed here. They are recorded in 08b as an open item for the owner. The specs cite the decision for topic configuration only and do not restate the owner's sentence as a general rule.

I recommended the opposite during exploration. My reasons are on record once, in `exploration-notes.md` §9, and I am not reopening them here. What matters now is that the decision gets implemented cleanly, and that the things the ritual actually depends on stay intact. That second half is why I care about this change.

Three reasons it matters:

1. **The split is incoherent and it is in front of users.** An admin who manages a team can change its agenda through the API but gets an explained denial on the screen that shows it. That is the worst of both: no protection (the writes go through) and a broken experience (the screen says no). Closing the split in the direction the owner chose makes the product say one thing.
2. **Silence in the spec invites "fixes".** FR-8.2 says "facilitator or Application Administrator" and nothing about membership. The code already admits member-admins on writes. Unless we write the rule down, the next person who notices it will "harmonise" it with the facilitator member bar and reopen this whole argument. The decision needs a source.
3. **The audit trail is now the only record, so it has to be described as permanent.** The in-transaction `topic.*` rows on admin writes were called an "interim compensating control" pending #208. They are now the permanent record of admin topic writes. The `admin.topic_config_accessed` row on every admin read stays and keeps naming the reader's membership role, which matters more now that a manager-admin is admitted.

## What Changes

- **TOPIC-003, -004, -005, -006 (add, archive, restore, reorder): no behaviour change.** An `application_admin` keeps every topic write on every team, whatever their membership on it (none, `participant`, `engineering_manager`). The specs and BRD FR-8.2 say so explicitly. `standing-facilitator-access-helper.ts` has no diff; `topics.ts` changes comments only.
- **TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`): revert #232's no-manager rule on the admin arm.** An admin with any active membership role on the team is admitted, the same as any other admin. **BREAKING (in the permissive direction) for clients that branch on the TOPIC-002 admin `403` messages; in-repo, the only such client is `TopicManagementPage`, whose handling is generic:** the `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` `403`s are removed, along with their messages, the `evaluateAdminTopicConfigRead` allow-list, and the `admin.topic_config_denied` audit operation.
- **Kept from #232:** the durable, text-free, fail-closed `admin.topic_config_accessed` row and event on every admin `200`, including the `membership_role` metadata (now `null | "participant" | "engineering_manager"`, recorded raw), `actor_roles`, and `actor_idp_roles_include_em`. The live membership-role read stays on the admin arm as audit input only. The `assertTopic002AuthorizedRole` tripwire stays. The log-only `admin.audit_write_failed` signal stays, with one possible `operation`.
- **`canAddTopics`** is `true` for every caller TOPIC-002 admits, with no exception. The parity test's `{ get: 403, post: 201 }` shape is deleted.
- **Topic Management screen:** an admin who manages the team sees the screen (definitions read-only, `canEditAnnotations: false`). The generic "show the envelope message on 403" handling stays; only its fixtures and comments change.
- **Decision record:** new `requirements/use cases/08b - Member Admin Topic Writes - Decision.md`, following the `01c` precedent.
- **Docs in the same change:** BRD FR-8.2 (explicit admin grant, add "restore", non-member qualifier for the facilitator), FR-8.7 rationale and Constraint 2 (remove the #232 sentences), FR-1.3 (positive grant sentence next to the session exclusion), traceability row for FR-8.2; Use Case 08 (remove the EM-member admin alternate flow); REST API Contract (TOPIC-001 note, TOPIC-002 authorization, 403 table and notes, TOPIC-006 authorization, Appendix B); `docs/deployment.md` (drop the denied operation, retire the "#232 compensating control" review section, keep one uncadenced lookup query, add the "keep admin team membership rare" hygiene line).

## Constraints this change must preserve

None of these changes, and the tasks pin each one with an existing or added test (task 2.18 names the pin per constraint). Some of them are protected by the owner's "except facilitating their own team". Others (admin participation, session-content denial, TOPIC-001, FR-8.7 annotation authoring) are not facilitating, so the owner's sentence does not cover them. They remain in force because this change is scoped to topic configuration, not because the decision protects them. 08b records them as an open item for the owner.

- **A session is always run by a facilitator from another team.** FR-2.1 / FR-2.2 [HARD]: only facilitators create sessions, and a facilitator cannot create one for a team they belong to as a Participant or EM. Unchanged.
- **The facilitator member bar on topic writes and on TOPIC-002.** A `facilitator` with any active membership on the team still gets `403 FACILITATOR_IS_TEAM_MEMBER` from TOPIC-002..006. This change touches only the admin arm. Facilitator paths gain no query, no row and no latency.
- **Admins do not facilitate or participate, even for their own team.** FR-1.3, FR-2.4, Constraint 2 (#243 D11): no registration, no votes, no live session events for an `application_admin`. TOPIC-001 still denies admins with `admin.session_content_denied`. TOPIC-007 (annotation writes) still refuses admins. Untouched.
- **Every admin read and every admin write is audited.** Each admin `200` from TOPIC-002 writes exactly one durable `admin.topic_config_accessed` row before the timing floor and the send, and fails closed (`500`, no data) if the membership read, role-set read or insert fails. Each admin topic write writes its `topic.*` row in the same transaction with `actor_global_role = 'application_admin'`. The access row carries no topic names, ids or definition text. The `topic.*` write rows carry topic ids (`topic_id`, or `previous_order` / `new_order` id arrays for reorder) and endpoint-specific counts, but no topic names or definition text. The audit visibility guard (no non-admin query can select these rows by wildcard) stays.
- **Global engineering managers stay out.** A caller with `global_role = 'engineering_manager'` still gets `403 NOT_A_FACILITATOR` from TOPIC-002..006 whatever their membership. TOPIC-001's #187 manager denial is unchanged.
- **Timing floor** on every TOPIC-002 exit, with the admin audit insert before the floor, unchanged.

## Non-goals

- No change to the shared helper, any `topics.ts` authorization decision, TOPIC-001, TOPIC-007, or any session, live-room, trend or action-item endpoint.
- No wrapper-collapse refactor of the four write wrappers (engineer review N1). The point of this change is "nothing changes on writes"; a refactor would hide that from reviewers.
- No new field on the `topic.*` write rows (for example the actor's membership role). A join of `actor_user_id` + `team_id` to `team_memberships` gives the role **now**, not at the time of the write (TEAM-005 updates it in place); the role at the time is reconstructed from `team.role_changed` / manager-association audit history (security review S-4). Adding the field is a candidate follow-up for Security, listed in the PR.
- No migration. Historical `admin.topic_config_denied` rows stay in `audit_log` untouched; they record what the rule did while it existed.
- No auditing of TOPIC-002's non-admin `403`s (still #264 / #225 territory).
- No GitHub issue edits from this change. Suggested issue actions are listed in `exploration-notes.md` §7 for a human.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `topic-customization-lock`: TOPIC-002 authorization drops the no-manager rule on the admin arm; `canAddTopics` parity has no exception; the admin-read audit requirement covers reads only (renamed), with `membership_role` widened and the denial row removed.
- `team-content-access`: "Application Admin access is limited to administrative data" no longer says an EM-member admin cannot read topic configuration; the visibility guard names one TOPIC-002 operation; denial scenarios become admitted-and-audited.
- `topic-annotation`: "The active-topics endpoint does not return the team annotation" states that an admin, including one who manages the team, reads definitions read-only through TOPIC-002, audited without the text. "Engineering managers never see the team's definition" now holds for engineering managers by global role and through TOPIC-001.
- `topic-management-screen`: the screen admits every admin TOPIC-002 admits; the manager-admin denial scenarios become "sees the screen read-only"; the server-reason scenario is re-anchored on a non-admin `403`.
- `add-custom-topic`, `remove-topic`, `restore-topic`, `reorder-topics`: the admin grant states "whatever their membership on the team, in any role, including `engineering_manager`" as a decided rule (#208), and names the in-transaction `topic.*` row as the permanent audit record.

## Impact

- **Backend:** `packages/backend/src/routes/content.ts` (remove the predicate, messages, deny branch, denied-operation selection; keep the access row, membership read as audit input, tripwire). `packages/backend/src/auth/audit-logger.ts` (remove `admin.topic_config_denied`; edit two comment blocks). `packages/backend/src/routes/topics.ts`: comments only.
- **Frontend:** `TopicManagementPage.tsx` comment only; test fixtures re-anchored.
- **Tests:** `content.test.ts`, `topic-002-admin-audit-integration.test.ts`, `topic-add-flag-parity.test.ts`, `topic-add-admin-integration.test.ts` and `topics.test.ts` (comment reframing, assertions unchanged), `TopicManagementPage.test.tsx`, `TeamPage.test.tsx` (comment only). New: `topic-write-member-admin-integration.test.ts` (member-admin write matrix). Test helper: `routes/__tests__/helpers/real-db.ts` (`Fixture.member` gains a `role` parameter). Kept and confirmed green: `topic-annotation-integration.test.ts` (#259's access-row assertion stays).
- **API:** TOPIC-002 loses two `403` outcomes for one caller class. No response shape changes for any admitted caller.
- **Docs:** BRD, Use Case 08, new decision record 08b, REST API Contract, `docs/deployment.md`, main-spec Purpose lines for `reorder-topics` and `restore-topic`.
- **Release note (#187 Follow-up 5):** the approved line "Engineering managers, including administrators who manage the team, cannot read the team's definitions" becomes false. Proposed replacement for the owner to approve: "Engineering managers cannot read the team's definitions. Application administrators can, including one who manages the team; every administrator read is audited."

## What I'd ask for in return (suggestions, not conditions)

1. Keep admin membership in a team rare, and say so in the deployment hygiene checklist next to "facilitators should not also be in the manager or admin groups", with the reason (a manager-admin can read the team's definitions and change its agenda) and what to check (`team_memberships` rows held by `application_admin` users, each with a stated reason, at each access review). This is guidance, not a control. (In this change, task 5.8.)
2. Give #201 (facilitator-visible topic provenance) more weight. Audit rows are read by auditors; the team and its facilitator see nothing when an insider admin changes the agenda.
3. Correct the #187 release note before it ships. This is now a gate in task 6.4: owner re-approval is required before release.

## Disclosed risk (recorded, not reopening the decision)

**R-EXEC-1 (from the Executive review): holding the admin role gives a manager a way around the "managers don't see the team's own words" boundary.** After this change, an engineering manager who is also an Application Administrator can read the team's definitions through TOPIC-002 and can add, archive, restore or reorder topics on their own team before a session. #187 kept definitions from managers because they can reflect what the team said without the manager in the room. The harm is perception, and it does not depend on frequency: one engineer learning this can cool a team's candour (success criterion 4).

- **Accepted by:** the product owner, on the premise that admins are a small, deliberately chosen, trusted group and that the control belongs in who holds the role.
- **Mitigations in this change:** a durable `admin.topic_config_accessed` row on every admin read, naming the membership role; an in-transaction `topic.*` row on every admin write; the deployment hygiene line with its reason (task 5.8); an honest release note (task 6.4).
- **Residual risk:** the team and its facilitator see none of this, and the remaining lookup query has no cadence or owner, so in practice nobody may run it. The control that addresses perception is #201 (facilitator-visible provenance); revisit it if the manager-admin overlap is ever more than a handful of people. This risk is recorded in 08b.

## Review disposition

Reviews: `propose-review-ba.md` (Marcus Delgado, approve with changes) and `propose-review-exec.md` (Rachel Okonkwo, approve).

| ID | Disposition | Where / rationale |
|---|---|---|
| BA F1 (scope of the owner's rule) | **Accepted.** | The owner's words are quoted verbatim and attributed in this proposal, design.md and 08b. They are not restated as a general rule. The four write specs and `topic-customization-lock` now say the decision "covers TOPIC-002..006 only; it does not change any other administrator restriction". 08b gains a Scope section listing the admin restrictions that remain in force, with the broader reading flagged as an open item for the owner (task 5.1). The PR asks the owner to confirm the scope (task 6.4). |
| BA F2 (write rows do carry topic ids) | **Accepted.** | Checked against `topics.ts`: `topic.custom_added` / `topic.restored` carry `{ topic_id }`, `topic.archived` carries `{ topic_id, openActionItemCount }`, and `topic.reordered` carries `{ previous_order, new_order }` id arrays. The Constraints bullet is corrected. The same wording is used in design D6, 08b and `docs/deployment.md` (tasks 5.1, 5.8). |
| BA F3 (contradictory "or an active member" clause) | **Accepted.** | The scenario now covers only callers whose global role is neither `facilitator` nor `application_admin`. Member facilitators are covered by the existing scenario. |
| BA F4 (screen denial keyed to "standing facilitator model") | **Accepted.** | Re-anchored on "a caller whom TOPIC-002 rejects". |
| BA F5 (no manager-admin write-controls scenario) | **Accepted.** | Scenario added to `topic-management-screen`; test added to task 4.5. |
| BA F6 (name the write operation) | **Accepted.** | Each member-admin write scenario names `topic.custom_added`, `topic.archived`, `topic.restored` or `topic.reordered`. |
| BA F7 (compound "regardless of membership") | **Accepted.** | The scenarios list the matrix (none, `participant`, `engineering_manager`). "Any other role" becomes "any value of `team_memberships.role`". Task 1.2 covers the matrix (renumbered after design and task reviews). |
| BA F8 (Use Case 08 actor lines) | **Accepted.** | Task 5.6 is extended. |
| BA F9 (release-note gate) | **Accepted.** | Task 6.4 makes owner re-approval a release gate. |
| BA vague language (hygiene line, "today", BREAKING) | **Accepted.** | Hygiene line made concrete and labelled guidance. The `membership_role` "today" is stated as an open set. BREAKING names the affected client. |
| Exec R-EXEC-1 | **Accepted as a disclosed risk.** | See "Disclosed risk" above; recorded in 08b. The decision is not reopened. |
| Exec ask 1 (reason next to the hygiene line) | **Accepted.** | Design D6, task 5.8. |
| Exec ask 2 (release note to the owner) | **Accepted.** | Task 6.4 gate. |
| Exec caution (keep #201 out of this change) | **Accepted.** | #201 stays a suggestion and backlog item; no scope added. |

Nothing was rejected.
