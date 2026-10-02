## Context

TOPIC-003 (`POST /api/v1/teams/:teamId/topics`) authorizes through `checkStandingFacilitatorAuthorization(reply, userId, teamId, startTime, messages)` in `packages/backend/src/routes/topics.ts`. That function writes the reply itself and admits facilitators only. It has two callers: TOPIC-003 (with `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`) and TOPIC-007 annotation (with `ANNOTATION_AUTH_MESSAGES`). TOPIC-004/005/006 instead wrap the decision-only `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` from `packages/backend/src/auth/standing-facilitator-access-helper.ts`. That function returns `{authorized, actorGlobalRole}` or `{authorized:false, reason}` and doesn't apply the timing floor. Each per-endpoint wrapper (`checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization`, `checkReorderTopicsAuthorization`) writes its own 403 copy and calls `applyTimingFloor`.

TOPIC-002 computes `canAddTopics` as `decision.actorGlobalRole === "facilitator"` in `packages/backend/src/routes/content.ts`, and the living spec says it must flip for admins in the same change that fixes #176. `topic-add-flag-parity.test.ts` deliberately fails if only one side flips. The screen's empty state has five variants. Two of them (rows 3 and 5) exist only for the admin `canAddTopics: false` case.

Constraints carried in from exploration (all preserved unchanged):
- First-session canonical topic set: the customization lock applies to admins.
- A member-facilitator is still barred (`FACILITATOR_IS_TEAM_MEMBER`).
- Managers stay out: `engineering_manager` → `403 NOT_A_FACILITATOR`.
- FR-8.7: team definitions (TOPIC-007) remain facilitator-only.
- Snapshot at room open (#175/#205): writes between sessions never reach an open room.

## Goals / Non-Goals

**Goals:**
- TOPIC-003 admits `application_admin` per FR-8.2 [HARD], with the same check order, lock, timing floor and audit as for facilitators.
- TOPIC-002 `canAddTopics` and the screen move together with the endpoint, and the parity test keeps proving they agree.
- Spec, contract, use case and code comments stop describing #176 as open.

**Non-Goals:**
- Changing TOPIC-007, or merging, deleting or un-parameterizing `checkStandingFacilitatorAuthorization`.
- Barring member-admins (F1). Topic-author display (F2). The "next room" notice (F3). Admin-specific locked empty-state copy (F4, owned by #200).
- #184, #198/#199, #200; audit or rate-limit changes.

## Decisions

### D1. New per-endpoint wrapper; switch the call site, not the shared function
Add `checkAddCustomTopicAuthorization(reply, userId, teamId, startTime)` next to the TOPIC-004/005/006 wrappers. It calls `checkStandingFacilitatorOrAdminAuthorization`. On rejection it calls `applyTimingFloor(startTime)` and then sends 403 with the same reason code (`NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`). On success it returns `{ rejected: false, actorGlobalRole }`. Its 403 copy is written inline in the wrapper, as the archive/restore/reorder wrappers do, and `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` is **deleted**, not edited: after the swap it has no callers, and leaving it would keep the old "Only a facilitator can add a custom topic." string alive as dead code. TOPIC-003's handler swaps to it. The lock-denial and success audits already read `authResult.actorGlobalRole`, so they record `application_admin` without new plumbing.

*Alternative rejected:* widening `checkStandingFacilitatorAuthorization`. That would silently admit admins to TOPIC-007 and break FR-8.7. That function stays, with TOPIC-007 as its only caller. Its `messages` parameter stays as it is; collapsing it is a cleanup question, not part of #176.

### D2. 403 copy
| Reason code | Copy | Receives it |
|---|---|---|
| `NOT_A_FACILITATOR` | "Only a facilitator or an application admin can add a custom topic." (new; matches TOPIC-004) | engineer, engineering manager, no `users` row |
| `FACILITATOR_IS_TEAM_MEMBER` | "A facilitator cannot add a custom topic to a team they are a member of." (unchanged) | facilitator with an active membership on the team |

The old copy would misstate who is allowed. Reason codes don't change, so clients branching on `code` are unaffected.

"application admin" (lower case, short form) rather than the BRD's "Application Administrator" is deliberate: it matches the copy TOPIC-004/005/006 already ship. Do not "fix" the wording on one endpoint alone; any change to the term is a cross-endpoint copy change.

Engineering Managers are excluded from topic writes. FR-8.2 names only the facilitator and the Application Administrator; an EM's FR-1.6 authority over their own team's membership does not extend to the team's topics. This is the anti-steering boundary the ritual depends on, so it is recorded here to keep the exclusion traceable rather than implied.

### D3. No shared `canAddCustomTopic(globalRole)` predicate (security-review S2, C1)
**Skipped** to keep the diff small and mirror the existing TOPIC-004/005/006 pattern. The parity test (`topic-add-flag-parity.test.ts`) is the sole drift guard between TOPIC-002's flag and TOPIC-003's authorization. It runs both routes' real authorization helpers across all seven caller classes, which is a stronger guarantee than a shared predicate that the endpoint could still bypass. `canAddTopics` becomes the explicit `decision.actorGlobalRole === "facilitator" || decision.actorGlobalRole === "application_admin"`, which is every caller TOPIC-002 admits. Naming both roles keeps the intent readable, where a bare `true` would hide it. It stays computed separately from `canEditAnnotations`, and its "TEMPORARY" comment is replaced.

### D4. Frontend rule for `canAddTopics: false` (revised after engineer review B1)
The add trigger (heading and empty-state action) renders only when `canAddTopics === true && isCustomizationLocked === false`. The empty state has exactly three *message/structure* variants: locked; unlocked with archived topics; unlocked without archived topics. `ActiveEmptyStateVariant` shrinks from `1|2|3|4|5` to three members, and `activeEmptyStateVariant` drops its `canAddTopics` argument. The variant-5 copy "Topics can't be added from this account yet." is deleted.

The variant no longer decides whether the add action renders. Today `ActiveTopicsEmptyState` derives `addAction` from the variant alone (`variant === 2 || variant === 4`), so dropping `canAddTopics` from the variant function would have made the empty-state button render on every unlocked empty team, whatever the flag said. Instead, `ActiveTopicsEmptyState` takes a new required `addAllowed: boolean` prop and renders "Add custom topic" only when it is `true` (and the variant is not locked). `TopicManagementPage` passes its existing `addAllowed` (`!data.isCustomizationLocked && data.canAddTopics === true`), so the heading trigger and the empty-state action share one gate and the page's "`=== true`, a missing flag fails closed" rule covers both.

`canAddTopics` false or missing on an unlocked team is **reachable**: a frontend deployed ahead of its backend (flag missing), or a backend rollback (flag `false` for admins). In that state the empty state shows the plain unlocked message ("This team has no active topics.") and "Show archived topics (n)" when archived topics exist, with no add action and no explanatory note, consistent with the screen's no-teaser rule. One empty-state test pins this (task 4.3(e)); it is the drift guard that replaces the old row-5 test, not a test of a dead branch.

### D5. Admin who is also a team member: admitted (accepted for #176)
FR-8.2 places no membership restriction on Application Administrators, and TOPIC-004/005/006 already admit member-admins, with tests. TOPIC-003 follows the same rule. I'm not comfortable leaving it there for the ritual. It's the same social pressure the member-facilitator bar exists to prevent. So it becomes tracking issue **F1**, which covers TOPIC-003/004/005/006 together. It doesn't get fixed piecemeal on one endpoint.

### D6. FR-8.2 / FR-8.7 tension
FR-8.2 lets an Application Administrator author a custom topic's name, prompt and first-session description; FR-8.7 keeps only the *team definition* (annotation) facilitator-only, because it records what was said in the room. Do not "resolve" this by restricting the add form's fields for admins. Participants do see an admin-authored *prompt*, so the tension is real, but it sits mainly on the prompt. #198/#199 track visibility of the description.

### D7. Add-form helper text
Change the description helper text "…what this topic means for your team." to "…what this topic means for this team." It's the only add-form, toast or 403 string that assumes the reader belongs to the team's own facilitation. No broader copy rewrite.

### D8. Spec delta operation
In `add-custom-topic`, the two facilitator-only requirement titles are **RENAMED then MODIFIED**: "A standing facilitator or application administrator can add…" and "…standing-facilitator-or-administrator authorization". I chose this over ADDing sibling requirements so the spec keeps one requirement per concern and history reads as a rename. The "non-facilitator" scenarios become "neither facilitator nor administrator".

### D9. Validation Report annotation
The FR-8.2 row in `REST API Contract - Validation Report.md` said "Covered" before that was true. Append "(admin branch: #176)" so the history is honest.

## Risks / Trade-offs

- [Someone widens TOPIC-007 "for consistency"] → D1 leaves the shared function untouched. TOPIC-007's admin-403 tests must pass **without modification**. The existing "Do not 'fix' this for consistency" comment stays.
- [Admins bypass the lock] → explicit test: an admin on a locked team gets 409, and the `topic.write_denied_locked` row carries `actor_global_role = 'application_admin'` and `metadata.attempted_operation = 'topic.custom_added'`.
- [Check order or timing floor regresses because the new wrapper is decision-only] → floor assertions on admin → 404, admin → 409, and both 403 branches of the new wrapper. Admin check-order tests: 404 beats 422, 409 beats 422, 422 on an unlocked team. "Admin at 403" would test nothing and is deliberately absent.
- [Volume of admin writes] → no rate limit or per-team cap (out of scope, as for facilitators), but an admin reaches every team. A detection rule on `topic.custom_added` rows with `actor_global_role = 'application_admin'` is recommended for the ops/monitoring backlog (F7).
- [Flag and endpoint drift] → the parity test flips its admin rows to `ADMITTED_CAN_ADD` and deletes `ADMITTED_CANNOT_ADD`. It fails if only one side changes.
- [An admin add reaching a live room] → one integration test proves an open session's `session_topics` are unchanged after an admin add.
- [Member-admin social pressure] → accepted (D5), tracked as F1.
- [The `application_admin` population grows] → the low-risk argument for this change assumes `application_admin` stays a small, trusted group that is not the management line. If that role is ever handed out more widely (for example, to Engineering Managers for convenience during rollout), this change becomes a path for management to inject topics into a team's ritual, which is exactly what the `NOT_A_FACILITATOR` rejection of EMs prevents today. **This boundary is enforced by IdP role assignment, not by this application.** `account-resolver.ts` maps `users.global_role = 'application_admin'` directly from the signed ID token's `OIDC_ROLE_CLAIM` and re-applies it on every sign-in, so whoever administers the role-claim (app-role or group) assignment in an IdP can grant topic-write authority on every team, and the grant takes effect at that user's next sign-in. Nothing in this application can refuse it.
  - *Multiple providers.* OIDC here is provider-agnostic: Entra ID is the primary provider today, but it is not the only supported one. Every configured provider whose role claim can yield `application_admin` is an **independent grant path**, each with its own assignment administrator. Adding a provider widens the set of people who can create admins, and so the set who can inject topics org-wide. That is a property of the role-claim mapping, not of #176, but #176 raises what an admin grant is worth.
  - *Owners.* Policy owner (who *should* hold the role): VP Engineering (Rachel Okonkwo). Control owner (who *can* grant it): the role-assignment administrator of each configured IdP; for Entra, whoever administers the application's app-role assignments in the tenant. That person is not named anywhere in the repo, so naming them per provider is a pre-merge item (task 6.5), recorded in the PR description.
  - No code guard is added in #176. A structural restriction on who may hold the role, or per-provider restriction of which providers may assert `application_admin`, changes the identity integration, not topic authorization; it is follow-up F5.
- [Role revocation lag] → `users.global_role` is rewritten only at sign-in. The authorization read is live but reads a value that can be stale for the whole application session, so an admin whose role is removed in the IdP keeps admin authority until their session ends or they sign in again. That window already applies to TOPIC-004/005/006; #176 inherits it and adds a *generative* write (topic creation on every team) to it. The window is bounded by the application session lifetime. Forced re-evaluation on revocation (for any provider) belongs with the IdP/session work, not here; tracked as F6.
- [Admin-authored topics are invisible as such to the facilitator] → the `topic.custom_added` audit row records the actor, so nothing is lost *while audit retention is at least as long as the topic's lifetime* (`topics` has no `created_by`); a facilitator cannot see it. When F2 is designed it should decide whether provenance becomes a column on `topics` so retention policy can't erase it. Tracked as F2, targeted at the milestone after this change, not the general backlog.
- [Locked team with zero active topics cannot be repaired by anyone] → every write, including an admin's, is gated by the lock, which conflicts with FR-8.6 [HARD] ("visible and restorable for any team at any time"). This change does not create that gap and does not close it; it is raised on #200 with F4.

## Migration Plan

No schema or data migration. Deploy backend and frontend together, as usual for this monorepo. If an older frontend gets the flipped flag, it simply shows admins the add control, and the endpoint accepts their request. If a backend rollback happens with a newer frontend, the old backend returns `canAddTopics: false` for admins, so both the heading trigger and (with D4's `addAllowed` prop) the empty-state action stay hidden: a rollback hides the control for admins, and there is no 403 path. Rollback is reverting the commit.

## Open Questions

None blocking. F1–F4 are follow-ups (see proposal); F5–F7 were added from the design reviews. Ready-to-file drafts are in `follow-up-issues.md`; F1 and F2 must be filed, with numbers recorded in `tasks.md` 6.4, before merge. The IdP-side owner of `application_admin` assignment must be named per configured provider before merge (task 6.5).

## Design review response

Ingrid Sollenberger, Solution Architect. Reviews: `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás Ferreira).

### Engineer review

| # | Finding | Response | Where |
|---|---|---|---|
| B1 | D4 drops `canAddTopics` from the variant, but the variant is the only thing gating the empty-state add button; a missing/false flag on an unlocked team would show the button | **Accepted, verified in code.** `ActiveTopicsEmptyState.tsx` sets `addAction = variant === 2 \|\| variant === 4` and has no other permission input; `TopicManagementPage.tsx` already computes `addAllowed` (L1225) but uses it only for the heading trigger. D4 now keeps three message variants and adds a required `addAllowed` prop fed from the page's existing `addAllowed`. I chose a required boolean prop over "optional `onAddTopic`" because the absence of a callback is an implicit gate; an explicit prop reads as a permission and a type error catches a forgotten call site. My "unreachable state" claim was wrong: frontend-first deploy and backend rollback both reach it. Missing-flag empty-state test added. | D4; tasks 4.1, 4.2, 4.3, 4.5(e); `topic-management-screen` delta (new scenario) |
| S1 | Rollback sentence wrong | **Accepted.** Rollback hides the control for admins; no 403 path. | Migration Plan |
| S2 | Stale "TOPIC-003" comments in `topics.ts` and the parity-test header escape the 6.2 grep | **Accepted.** Named each comment in 1.4 and 3.9, and added a `grep -n "TOPIC-003"` pass to 6.2. | tasks 1.4, 3.9, 6.2 |
| S3 | Delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` rather than edit it | **Accepted.** Messages go inline in the new wrapper; the constant is deleted. | D1; task 1.2 |
| N1 | Fourth copy of the same wrapper | **Agreed, deferred.** Collapse into a factory when F1 changes all four together; noted in F1's draft. | follow-up-issues F1 |
| N2 | Parity test is the sole drift guard | Acknowledged; already D3's stated position. | — |
| N3 | Help text still addresses a definition editor admins can't use | Routed to #200's copy pass; not changed here. | — |
| N4 | Error paths | No action. | — |
| N5 | Test both `engineering_manager` and no-`users`-row on the `NOT_A_FACILITATOR` floor branch | **Accepted.** | task 3.5 |

### Security review

| # | Finding | Response | Where |
|---|---|---|---|
| S1 | The `application_admin` boundary is an IdP control, not an application policy; each additional OIDC provider is another grant path | **Accepted, and widened.** This project supports multiple OIDC providers (Entra is primary, not the only one), so I've framed it per provider: every configured provider whose role claim can yield `application_admin` is an independent grant path with its own assignment administrator. Risks now separates the policy owner (Rachel Okonkwo) from the control owner (each IdP's role-assignment administrator). No person is named for that in the repo, so naming them per provider is a pre-merge item rather than something I invent. Restricting which providers may assert `application_admin` is an identity-integration change, not topic authorization, so it's F5. | Risks; task 6.5; follow-up F5 |
| S2 | Revocation latency undocumented | **Accepted.** Risks states the window (bounded by application session lifetime), says #176 inherits it and adds a write to it, and routes forced re-evaluation to F6 (IdP/session work). | Risks; follow-up F6 |
| N1 | Attribution depends on audit retention | **Accepted as text.** Risks now qualifies "nothing is lost", and F2's draft asks whether provenance should be a `topics` column. | Risks; follow-up F2 |
| N2 | No volume detection on admin writes | **Accepted as follow-up.** Detection rule, ops backlog. | Risks; follow-up F7 |
| N3 | Deactivated teams accept admin adds | Accepted as intended behavior (consistent with Decision 11 and TOPIC-004/005/006). | — |
| N4 / condition 3 | F1 must name the audit row as the interim compensating control | **Accepted.** F1's draft says it explicitly; tasks 3.1/3.2 keep asserting the row. | follow-up F1; tasks 3.1, 3.2 |
| §5 | Assert the admin 201 body has no session fields | **Accepted.** | task 3.1 |

### Unresolved

None of the reviewers' findings is left open in this design. One item can't be closed by the design: naming the IdP-side role-assignment owner for each provider (security condition 1). It needs a person from outside the team, so it is a pre-merge task (6.5), not a design gap.
