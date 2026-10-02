## Why

BRD FR-8.2 [HARD] says that after a team's first session, "the facilitator **or Application Administrator** shall be able to add, remove, or reorder topics for that team." Today an application admin can archive, restore and reorder a team's topics, but `POST /api/v1/teams/:teamId/topics` (TOPIC-003) still rejects them with `403 NOT_A_FACILITATOR`. That is issue #176. The repair kit is only half there. An admin who lands on a team whose topic list has been stripped down or inherited without a handoff can take topics away but can't put a new one in. The screen tells them "Topics can't be added from this account yet."

From where I sit (Devon), the admin branch exists so a team's topic list stays repairable without first finding a cross-team facilitator. That is part of the ritual outliving any one person. The previous change (`topic-add-form-and-empty-state`) already wrote the #176 fix into the living specs as an obligation: flip `canAddTopics`, remove the temporary empty-state rows, and keep the parity test honest. This change pays that debt. It brings the code up to a HARD requirement and doesn't weaken any protective rule.

## What Changes

- TOPIC-003 admits `global_role = 'application_admin'` on any team, regardless of membership, through the existing decision-only `checkStandingFacilitatorOrAdminAuthorization`. This is the same arm TOPIC-004/005/006 already use. Non-member facilitators are admitted as before. A member-facilitator still gets `403 FACILITATOR_IS_TEAM_MEMBER`. Engineers, engineering managers and callers with no `users` row still get `403 NOT_A_FACILITATOR`.
- The customization lock applies to admins exactly as it does to facilitators. An admin on a team that hasn't completed its first session gets `409 TOPIC_CUSTOMIZATION_LOCKED`, and the existing `topic.write_denied_locked` audit row records `actor_global_role = 'application_admin'`. The check order stays 403 → 404 → 409 → 422, with the timing floor on every early return.
- A successful admin add writes the existing `topic.custom_added` audit row with `actor_global_role = 'application_admin'` in the same transaction as the insert. No new audit operation.
- The `NOT_A_FACILITATOR` 403 copy on TOPIC-003 changes from "Only a facilitator can add a custom topic." to "Only a facilitator or an application admin can add a custom topic." Reason codes don't change. The `FACILITATOR_IS_TEAM_MEMBER` copy is unchanged.
- TOPIC-002 `canAddTopics` becomes `true` for `application_admin`, in the same change, as the living spec requires. `canEditAnnotations` stays `false` for admins.
- Topic Management screen: admins now see the heading "Add custom topic" trigger and the empty-state add action on an unlocked team. The two `canAddTopics: false` empty-state variants are removed: "unlocked, `canAddTopics: false`, with archived topics" and "unlocked, `canAddTopics: false`, nothing archived" (the one reading "Topics can't be added from this account yet."). Three variants remain: locked; unlocked with archived topics; unlocked without archived topics.
- The add form's description help text changes "…what this topic means for your team." to "…what this topic means for this team." That is the only string that assumed the reader is the team's own facilitator.
- Contract and requirements prose aligned: the REST API Contract (TOPIC-002 `canAddTopics`, TOPIC-003 Authorization and 403 row, TOPIC-004 cross-reference), the "Use Case: Add Custom Topic" (Actor, Preconditions, Acceptance Criteria), the Validation Report's FR-8.2 row, and the stale header comment in `standing-facilitator-access-helper.ts`.
- **Explicitly unchanged:** TOPIC-007 (team definition / annotation) stays facilitator-only under FR-8.7. Its shared helper `checkStandingFacilitatorAuthorization` stays in place for it.

No **BREAKING** changes. Access only widens, for one role that is already trusted. There's no data migration and no new reason code.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `add-custom-topic`: the authorization requirements change from "standing facilitator" to "standing facilitator or application administrator". Two requirement titles are renamed, the "non-facilitator" scenarios are restated as "neither facilitator nor admin", and admin success, admin-as-member, admin-on-locked-team and admin check-order scenarios are added. The audit requirement gains an admin actor-role scenario.
- `topic-customization-lock`: the TOPIC-002 authorization-model note no longer lists TOPIC-003 among the endpoints that reject admins. The `canAddTopics` requirement drops its "temporary" admin `false` and becomes `true` for every caller TOPIC-002 admits.
- `topic-management-screen`: the add-control requirement drops the admin no-control clause and scenario. The empty-state table drops its two `canAddTopics: false` variants (unlocked with archived topics; unlocked with nothing archived) and their administrator scenarios. The new locked-team administrator scenario asserts structure only and leaves admin copy to #200. The add form's description help text changes one word.

## Impact

- **Backend:** `packages/backend/src/routes/topics.ts` (new `checkAddCustomTopicAuthorization` wrapper, the TOPIC-003 call site, the 403 message constant), `packages/backend/src/routes/content.ts` (`canAddTopics`), `packages/backend/src/auth/standing-facilitator-access-helper.ts` (header comment only).
- **Shared:** `packages/shared/src/types/topic.ts` (`canAddTopics` doc comment).
- **Frontend:** `packages/frontend/src/pages/addCustomTopic.ts` (`activeEmptyStateVariant`, `ActiveEmptyStateVariant`), `packages/frontend/src/components/ActiveTopicsEmptyState.tsx`, `packages/frontend/src/components/AddCustomTopicForm.tsx` (help text), and their tests.
- **Tests:** TOPIC-003 unit and integration suites, `topic-add-flag-parity.test.ts` (admin rows flip, `ADMITTED_CANNOT_ADD` deleted), `TopicManagementPage.empty.test.tsx` and `TopicManagementPage.add.test.tsx`. TOPIC-007's admin-rejection tests must pass **unmodified**.
- **Docs:** `requirements/design/REST API Contract.md`, `requirements/use cases/08 - Topic Management - Use Cases.md`, `requirements/design/REST API Contract - Validation Report.md`.
- **Rollout:** low risk. No migration, and the API contract changes only in prose. The only client is our own screen.

## Non-goals / Follow-ups (not #176)

Ready-to-file drafts for F1–F4 are in `follow-up-issues.md`. F1 and F2 must be filed, and their numbers recorded in `tasks.md` 6.4, before this change merges.

- **F1:** should a member-admin be barred like a member-facilitator? This would apply across TOPIC-003/004/005/006 together. For #176, member-admins are admitted per FR-8.2 (see design). Needs an owner and a decision date. Issue: #____
- **F2:** facilitator awareness of admin-authored topics ("added by / added on" on the management row). Targeted at the milestone after this one. Issue: #____
- **F3:** a "takes effect from the next room" notice for edits made while a room is open (all roles, all write endpoints).
- **F4:** a comment on #200 noting that the locked empty-state copy must also read correctly for an admin viewer, and that a locked team with zero active topics can't be repaired by anyone today, which conflicts with FR-8.6 [HARD].
- **F5–F7** (added from design review, not merge-gating): per-provider control over who may assert `application_admin` via the OIDC role claim (F5); role-revocation latency across providers (F6); detection on bursts of admin topic writes (F7). Drafts in `follow-up-issues.md`.
- Not absorbed: merging or un-parameterizing `checkStandingFacilitatorAuthorization`; #184, #198/#199, #200; audit or rate-limit changes; any change to TOPIC-007.

## Review response

Reviews: `propose-review-ba.md` (Marcus Delgado, BA) and `propose-review-exec.md` (Rachel Okonkwo, VP Engineering). Both approved with conditions. Responses below are mine (Devon).

### Accepted

| Item | Change made | Rationale |
|---|---|---|
| BA B1, admin locked-variant scenario asserted wrong copy | `topic-management-screen`: scenario now asserts structure only (locked variant, no "Show archived topics", no add action) and says admin copy is owned by #200. Task 4.5(c) matches. | Writing "ask the people who run this application" into an acceptance condition for those same people would make #200 fight a passing test. I kept the scenario instead of dropping it (the BA's alternative) because it pins that an admin on a locked team gets the locked variant, which is the lock-applies-to-admins rule seen from the screen. |
| BA B2, living-spec Purpose and implementation notes go stale | New task 6.7 [AT ARCHIVE] with the BA's grep check. | Deltas can't carry that prose. Stale "facilitator only" text in a living spec is how a future reader "restores" the old rule. |
| BA B3, member-admin success lacks audit obligation | `add-custom-topic`: member-admin scenario now requires exactly one `topic.custom_added` row with `actor_global_role = 'application_admin'` in the insert's transaction. | The member-admin is the actor F1 is about. Until F1 is decided, the audit row is the only record, so it has to be a spec obligation. |
| BA M1, no test proves an admin add reaches the list | Task 4.5(d). | This is the user-visible outcome of #176. |
| BA M2, EM exclusion traceability | design.md D2 records that EMs are excluded from topic writes and why. Task 5.2 adds the same line to the use case's Notes. | The no-management-steering boundary is load-bearing for the ritual. It should be written down, not inferred from a reason code. |
| BA M3, "application admin" vs "Application Administrator" | design.md D2 records that the short form is deliberate and matches TOPIC-004/005/006. | Stops a one-endpoint "fix". |
| BA M4, "rows 3 and 5" won't mean anything after archive | Proposal names the removed variants by content. | Archived proposals have to read on their own. |
| BA M5, use-case flows read as facilitator-exclusive | Task 5.2 adds one Summary sentence. | Cheap, and the Goal stays facilitator-voiced. |
| BA §3, FR-8.6 gap on locked empty teams | Recorded as a design risk and added to F4's text for #200. Not fixed here. | Correct observation, but closing it means deciding who may write through the lock. That decision belongs to #200, not #176. |
| Exec C1, F1/F2 must be real issues before merge | `follow-up-issues.md` holds ready-to-file drafts for F1–F4. Task 6.4 now requires F1 and F2 to be filed before merge, with numbers recorded in `tasks.md` and the Follow-ups list. F2 targets the next milestone; F1 asks for an owner and decision date. | Agreed that trust issues can't evaporate in a bullet list. Filing is left to a human, so the gate is a merge-blocking task rather than issue numbers I can't produce yet. |
| Exec C2, admin population assumption | design.md risks now state that the low-risk argument depends on `application_admin` staying small and outside the management line, with Rachel as policy owner. | This is my biggest concern with the change, put more bluntly: a protective rule that rests on policy is one role grant away from being configurable. Recording it is the minimum. |

### Rejected or limited

| Item | Decision | Rationale |
|---|---|---|
| Structural guard against EMs holding `application_admin` (implied by Exec C2) | Not added here. Recorded as a risk with a named policy owner. | I'd prefer a structural guard eventually, but it changes role assignment, not topic authorization, and goes beyond #176. If the admin population ever widens, it should be raised as its own issue then. |
| BA B1 alternative, drop the admin locked scenario | Not taken. Reworded instead (see above). | Dropping it loses the screen-level evidence that the lock applies to admins. |
| Absorbing F1–F4 into this change | Not done. They stay as follow-ups with drafts. | Both reviewers explicitly asked to hold scope. Barring member-admins on TOPIC-003 alone would split the rule across endpoints, which is worse than a consistent rule decided once. |
| Issue numbers in this proposal before review closes | Placeholders (`#____`) until a human files the drafts. | I'm not filing issues from this workflow. The merge gate in task 6.4 enforces the condition instead. |
