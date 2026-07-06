# Exploration Notes: Assign a Role to a Team Member
**Perspective:** Devon Calloway, Internal Champion
**Use Case Source:** requirements/use cases/01 - Identity and Access - Use Cases.md (lines 173–228)
**Related Specs:** openspec/specs/session-participation/spec.md, openspec/specs/join-link/spec.md
**Date:** 2026-07-06
**Last Updated:** 2026-07-06 (incorporating reviewer feedback from Priya Nair and Marcus Delgado)

---

## Review Incorporation Notes

Two reviews were received after the initial exploration: one from Priya Nair (Staff Software Engineer / Facilitator) and one from Marcus Delgado (Senior Business Analyst). I have updated this document selectively. What I accepted, where I pushed back, and why is noted inline throughout.

Summary of material changes:

- **Q2 closed (Marcus):** Facilitator designation is out of scope. Scoped to `membership_role` only. Sections 2, 6e, 9, and 10 updated.
- **Q4 upgraded to Blocking (Marcus):** Session-participation spec update is a prerequisite, not a suggestion. Sections 5a and 9 updated.
- **Warning requirement made concrete (Marcus):** Section 6b now includes specific message text, trigger condition, placement requirement, and an acceptance criterion.
- **Session-initiation guard linked to role-change warning (Priya):** Section 6b now explicitly connects the role-change warning to the session-start enforcement point.
- **TEAM-005/TEAM-006 relationship explicitly addressed (Marcus):** Section 8 states Position A explicitly. Section 2 mapping table updated accordingly.
- **Mid-session behavior stated as requirement, not inference (Marcus):** Section 6d updated with requirement language.
- **Facilitator view during mid-session role change addressed (Priya):** Section 6d expanded to cover the readiness grid and expected-voter count.
- **Pre-session verification workflow added (Priya):** Section 7 expanded.
- **Escalation path for admin-only Q1 resolution documented (Priya):** Section 7 expanded.
- **Bootstrapping as onboarding friction acknowledged (Priya):** Section 4 expanded.
- **Inline role descriptions recommended (Priya):** Section 7 updated.
- **"Ready to run a session" signal (Priya, Observation 3): Not incorporated.** See pushback note in Section 7.

---

## 1. Intent and Why It Matters for the Ritual

Every protective constraint I have fought to keep structural — the no-manager rule, the facilitator-from-another-team rule — depends on roles being accurate. Role assignment is not an administrative detail. It is the foundation that every session-layer enforcement check is built on. Get this wrong, or leave it vague, and the session layer is checking a garbage value.

The ritual works because of separation: engineers participate, EMs review afterward, facilitators come from outside the team and run the session neutrally. The application enforces that separation by checking roles. But the application can only enforce roles that have been correctly assigned. This use case is where that assignment happens. It is not glamorous. It is essential.

There is a harder truth underneath. Before this use case is fully implemented, no session can run correctly. The join-link change correctly deposits new users into teams as `participant` members. The session participation spec correctly specifies that `engineering_manager` global role blocks session access. But none of that matters if the roles are never set — if there is no working path to designate a user as a Facilitator, or to designate an Engineering Manager for a team. Role assignment is the gate that everything else is standing behind.

I want to be direct: this use case has more unresolved ambiguity than any of the Identity and Access use cases so far. The use case notes acknowledge an open question about who can assign roles. That open question, when I trace it through the rest of the requirements, turns out to be a multi-layer problem. I am going to document what I found and what the team must resolve before this change can be implemented.

---

## 2. The Role System Is Two Separate Things — This Must Be Explicit

This is the central structural issue. When the use case says "assign a role of Engineer, Facilitator, or Engineering Manager," it is describing one operation. The data model requires two completely different operations, depending on which role is being assigned.

**Layer 1 — `users.global_role`**

This is the application-wide role stored on the `users` table. Valid values: `engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`. This is the role that determines what a person can do anywhere in the application — whether they can initiate sessions, facilitate sessions, access trend data, or administer the system.

**Layer 2 — `team_memberships.membership_role`**

This is the team-scoped role stored in the `team_memberships` junction table. Valid values: `participant` and `engineering_manager`. This determines whether a person is a voting participant on a specific team, or an EM with read-only access to that specific team's data.

The use case talks about assigning "Engineer, Facilitator, or Engineering Manager" as if they are all the same kind of thing. They are not:

| Use Case Role | What It Actually Is | Which Table |
|---|---|---|
| Engineer | `membership_role = 'participant'` | `team_memberships` |
| Facilitator | `global_role = 'facilitator'` | `users` — **out of scope for this use case (see Section 6e)** |
| Engineering Manager | `membership_role = 'engineering_manager'` | `team_memberships` only — **not `users.global_role` (see Section 8)** |

This distinction has an immediate implementation consequence: there is no single API endpoint that handles all three. TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`) handles the `team_memberships.role` value. There is no API endpoint in the current REST API contract for modifying `users.global_role`. The Facilitator role assignment — the thing that makes someone a Facilitator across the entire application — has no endpoint.

**This use case is scoped to `team_memberships.membership_role` changes only.** Q2 is closed — see Section 6e. Facilitator designation requires a separate use case with a new privileged endpoint. Engineering Manager designation via this use case writes only to `team_memberships.membership_role`; it does not require or invoke `TEAM-006` or a `global_role` change. See Section 8 for the explicit TEAM-006 rationale.

If a developer implementing this use case reaches for TEAM-006 when handling EM designation, they should stop. Section 8 explains why TEAM-006 is not part of this use case.

---

## 3. The Actor Discrepancy — Use Case vs. REST API Contract

The use case says the actor is a **Facilitator** who is "a member of a different team than the one being modified."

The REST API contract for TEAM-005 says the authorized actors are:
- `global_role = 'application_admin'` (any team), OR
- `global_role = 'engineering_manager'` with an active membership for the team (own team only)

A Facilitator is not in that list. The use case also notes — in the Notes section, not buried — that "it is an open question whether any authenticated user (not just a facilitator) should be able to manage team roles, given that team creation requires no admin role."

This is not a minor inconsistency. It is a direct conflict between the use case and the API contract, which was written later and appears to have resolved the question without informing the use case. The resolution in the API contract is: *only admins and EMs can manage roles*.

From my perspective, both answers have defensible rationale:

**The use-case answer (facilitators can assign roles):** Facilitators are the operational stewards of the ritual. They set up sessions, they manage the experience, they should be able to configure the team correctly. Requiring an admin to assign roles every time someone joins a team adds bureaucratic friction that slows adoption. A tool that requires admin approval for routine team maintenance will not be adopted by teams I have never met.

**The API contract answer (only admins and EMs can assign roles):** Role assignment is a privileged operation with security implications. A facilitator assigning an engineering_manager role would grant read-only access to potentially sensitive session history. Putting that capability in the hands of a Facilitator who is, by definition, not a permanent member of the team they are facilitating creates a privilege escalation risk. The admin-only path ensures that EM designation is a deliberate organizational decision, not a casual convenience.

I am not going to pick one. But I am stating clearly: **this must be resolved before the proposal is written, and the resolution must be reflected in both the use case and the API contract.** If the team resolves it as "facilitators can assign roles," TEAM-005's authorization must be updated and the security implications must be analyzed. If the team resolves it as "only admins and EMs," the use case actor must be updated to `Application Admin | Engineering Manager` and the UX must be designed for that actor, not a facilitator.

The BA and the security analyst both need to weigh in here. This is not a Devon-makes-the-call question. It touches security, UX, and the operational model.

Marcus confirmed in his review that the API contract's answer has not been formally adopted into the use case — the BA has not yet closed this question and will not do so until the security analyst weighs in. Once that input arrives, both documents must be brought into alignment. One of the two changes; both cannot remain in conflict.

If the resolution is "only admins and EMs can assign roles," there must be an explicit facilitator escalation path built into the UX. See Section 7. A facilitator who hits a grayed-out control with no explanation at session-start time is a failure of the tool and an adoption risk.

---

## 4. The Bootstrapping Problem — Who Gets the First Role?

Every user who signs in for the first time receives `global_role = 'engineer'` and no team memberships. That is correct behavior. First Access is clean.

But how does anyone ever become an `application_admin`? Or a `facilitator`? Or an `engineering_manager`?

Looking at the current API contract, there is no endpoint for modifying `users.global_role`. TEAM-005 modifies `team_memberships.role`. TEAM-006 establishes EM/team relationships but requires the target user to *already have* `global_role = 'engineering_manager'`. Neither endpoint creates a facilitator or an admin.

This means that role assignment above `engineer` is currently an out-of-band operation with no supported path through the application UI. For the application to work at all — for anyone to be able to create a session, facilitate one, or access EM history — someone must bootstrap the first `facilitator` and `engineering_manager` users through a database operation or a migration. The application offers no self-service path.

This could be intentional and acceptable. Organizations typically provision roles through their IdP or through a bootstrap migration on first deploy. My original proposal assumed the identity provider could carry role claims. That would mean an IdP-side configuration assigns roles, and the application trusts those claims during First Access instead of defaulting to `engineer`.

But the current First Access spec and implementation do not honor role claims from the IdP — they default `global_role` to `engineer` unconditionally. If the bootstrapping design relies on IdP role claims, that must be documented as a dependency. If it relies on a database bootstrap script, that must be explicit in the deployment instructions.

**This is a blocking open question for this use case, but it is not this use case's job to solve it.** Role assignment within the application (changing team-scoped membership roles) is meaningful and implementable. But the proposal must be explicit about what it covers and what it does not: it assigns `team_memberships.role`, and the bootstrapping of `global_role` is handled by a mechanism that must be separately defined.

The team must answer, before implementation begins: "When a new organization first deploys this application, how do they get their first facilitator and their first admin?" That answer must appear somewhere in the requirements or deployment documentation before this change ships.

**On bootstrapping as onboarding friction (incorporated from Priya's review):** I initially framed this as a deployment documentation concern. That framing is correct but incomplete. The bootstrapping question is also a facilitator-facing onboarding experience problem. When I sit down with a new team for their first session and someone asks how the application was configured and who set up the roles — I need an answer I can give in the room. If the honest answer is "a DBA ran a migration script," I have lost the room. Teams adopt this ritual when it feels transparent and trustworthy. A setup process that happens invisibly before the facilitator arrives undermines that.

The proposal must specify not just the technical bootstrapping mechanism, but what a facilitator can show a new team about how their configuration was established. If the answer is "this was done through the admin portal, and here is the account that did it, on this date," that is workable. If the answer is "no one knows," that is an adoption risk I am not willing to accept. Marcus confirmed that the bootstrapping deferral must land in a named artifact in the proposal — not only in exploration notes. The proposal must include an explicit out-of-scope note naming the question, the viable options (seed migration, bootstrap endpoint, IdP role claims in First Access), and a named owner for the follow-on work.

---

## 5. Critical Ritual Constraints in Play

### 5a. The No-Manager Participation Rule

This rule is why role assignment matters most. If a user's team membership role is set to `engineering_manager` for a team, they must not be able to participate in that team's sessions. The session participation spec already captures the enforcement point: the session participation endpoint checks `users.global_role` server-side and rejects `engineering_manager` values.

But there is a subtlety. The `session-participation` spec specifies checking `users.global_role`. The team membership role — `team_memberships.membership_role = 'engineering_manager'` — is a separate field. The access control use case (Enforce Access Control on Team Content) defines an "Engineering Manager" as "a user with an active `engineering_manager` team membership for the relevant team." A user could have `global_role = 'engineer'` but `membership_role = 'engineering_manager'` on their team, or the reverse.

**This use case creates or modifies the team membership role. The session participation check must cover both fields, not just `global_role`.**

The updated check must read:

> A user MUST NOT be recorded as a session participant if their `users.global_role = 'engineering_manager'` OR if their `team_memberships.membership_role = 'engineering_manager'` for the team whose session they are attempting to join.

**This is a prerequisite, not a suggestion.** Marcus confirmed in his review that updating the session-participation spec to check `team_memberships.membership_role` in addition to `users.global_role` is required before implementation of role assignment begins. Once a working path exists to assign `membership_role = 'engineering_manager'`, the session participation enforcement must already reflect it. The session-participation spec must be updated first; role assignment cannot ship against a session participation check that covers only `global_role`.

The no-manager rule requires a check on both fields. A user whose team membership role is `engineering_manager` is, for the purposes of that team's sessions, an Engineering Manager — regardless of their global role.

### 5b. The Facilitator-From-Another-Team Rule

The session setup precondition checks that a facilitator is not a member of the team they are facilitating. Specifically, it checks `team_memberships` for a row linking the facilitator to the team. This check exists in the `session-participation` spec.

The "Assign a Role" use case creates a scenario where this check could be affected: if a Facilitator's team membership role is changed from `participant` to `engineering_manager`, they are still a member of the team. The facilitator-from-another-team check — which looks for any active `team_memberships` row — does not care about the role value; it looks for membership existence. So this use case does not introduce new risk on the facilitator constraint. The constraint is on membership existence, not membership role.

This is worth stating explicitly because a developer might reason: "if we're changing someone to an EM role, they're stepping back from participation — maybe the facilitator constraint should be relaxed." It should not be. EM designation and facilitator eligibility are independent. A person can have a team membership role of `engineering_manager` on their team and still be ineligible to facilitate that team's sessions. The two constraints are separate and both must hold.

### 5c. Role Changes Must Be Immediate

The use case requires the role change to take effect immediately. The REST API contract confirms this: "Role changes take effect immediately on the next authenticated request from the affected user."

The implementation must not use a cached role value that could lag the change. Any middleware or session-state caching that resolves a user's role must be invalidated or bypassed on the request following a role change. The most reliable pattern is to read `team_memberships.role` directly from the database on each request that requires team-specific authorization, rather than caching it in the session cookie or an in-memory cache. This is an implementation concern, but it is explicit because the no-manager rule depends on it: a user designated as EM must not be able to cast a vote in the session they are currently in after their role is changed.

---

## 6. Edge Cases That Must Be Resolved

**6a. Demoting from Engineering Manager to Engineer**

The use case says roles can be changed to Engineer, Facilitator, or Engineering Manager. It implies bidirectionality — you can change someone to EM and change them back. What happens when an EM is changed back to Engineer (participant)?

Their read-only access to session history should be revoked immediately. If a session history page is open in their browser, the next request should return 403. The access control spec requires server-side enforcement, so this should work — but it must be a named acceptance criterion. "Demoting an EM to Engineer revokes their session history access immediately" should appear in the acceptance criteria.

**6b. A team with no engineers after a role change**

The use case's alternate flow mentions this: "Role change creates a conflict (e.g., a team would have no engineers) — The application may warn but does not block."

"May warn" is not a requirement. The application must warn — with a specific, visible, pre-action message — when a role change would leave the team with zero participant-role members. The following is the concrete requirement this use case must carry into the proposal.

**Warning trigger condition:** After applying this change, does any member of this team have `membership_role = 'participant'`? If not, the warning fires. This check runs at submission time, before the action is confirmed.

**Warning placement:** Pre-action warning, surfaced when the user selects the new role and before they confirm. This is not a toast shown after the action completes — it appears in the confirmation step so the user understands the consequence before proceeding.

**Warning message text:**

> "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

**Acceptance criterion:**

> When a role change would result in the team having zero members with `membership_role = 'participant'`, the application SHALL display a warning message before the user confirms the change. The warning SHALL explain that no session can proceed without at least one Engineer. The warning SHALL NOT block the change — the user may confirm and proceed.
>
> Scenario: Role change reduces Engineers to zero
> - GIVEN a team with exactly one member with `membership_role = 'participant'`
> - WHEN an authorized actor selects a new role of Engineering Manager for that member
> - THEN the application displays the warning before the action is confirmed
> - AND if confirmed, the role change proceeds and the member's `membership_role` is updated

**Connection to session-initiation guard (incorporated from Priya's review):** The role-change warning and the session-initiation guard are two separate checks, and both must be implemented. The warning at role-change time informs the actor before they create a broken state. The session-initiation check blocks a session from starting when zero participant-role members exist. These are not redundant — they fire at different points in the flow and have different implications (warn-and-allow at role change; block at session start). A developer who implements the warning correctly but misses the initiation guard will have incomplete enforcement. The proposal must specify both.

**6c. A team with no EM after demotion**

Not a blocking constraint — teams are not required to have an Engineering Manager. The EM relationship is optional. No warning is needed when the last EM is demoted.

**6d. Changing the role of a user currently in an active session**

If a user is mid-session and their team membership role is changed from participant to engineering_manager during the session, what happens to their current-session votes?

**Stated requirement:** A role change applied to a user during an active session does not retroactively invalidate votes that have already been locked in by that user in the current session. The role change takes effect on the user's next API request. If the role change occurs before the user locks in their vote for the current topic, the lock-in request MUST be rejected at the session participation endpoint (server-side check on `team_memberships.membership_role`). If the role change occurs after the user has locked in, the vote is recorded and counted at reveal.

This must be stated explicitly in the session-participation spec update, not left to inference from the "next authenticated request" principle.

**Facilitator view during mid-session role change (incorporated from Priya's review):** The data integrity requirement above does not address what the facilitator sees. If a participant's role is changed from Engineer to Engineering Manager while a session is live — by an admin acting in another browser tab — the facilitator's readiness grid must reflect the change. The expected-voter count denominator must update. The participant indicator for the affected user must be removed from the voting grid. The facilitator must not be left managing a stale control surface while the underlying data has changed.

This is a facilitator control surface requirement, distinct from the data integrity requirement above. It must be addressed in the design for the facilitator view separately from the session-participation spec update.

**6e. The "Assign Facilitator Role" scope — CLOSED**

Q2 is closed. Marcus confirmed: **this use case is scoped to `team_memberships.membership_role` changes only. The assignable roles for this use case are Engineer (stored as `participant`) and Engineering Manager (stored as `engineering_manager`). Facilitator designation is out of scope for this change and must be addressed as a separate use case requiring a new privileged API endpoint.**

This was my recommendation in the original exploration (Option 2), and the BA has confirmed it. The downstream consequences:

1. The use case text must be updated to remove Facilitator as an assignable role in this change.
2. Any UI role selector built for this change must not include a "Facilitator" option.
3. A separate use case stub for "Designate a Facilitator" must be created as an explicit deferral artifact — not silently omitted.

---

## 7. UX Considerations

My concern about the application feeling like a tool being run on people rather than a conversation people are having is relevant here, but the member management view is one of the least visible parts of the application. Most of the time, this is backstage infrastructure. It runs before the session, not during it. I do not have concerns about it being too prominent in the normal flow.

What I do care about: the vocabulary must be consistent with how the ritual describes roles, not how the database implements them. The member management view must show "Engineer," not "participant." It must show "Engineering Manager," not "engineering_manager." The vocabulary mapping from the join-link spec applies here too.

Since Facilitator is out of scope (Q2 closed), the visible role selector labels are "Engineer" and "Engineering Manager." The confirmation after a successful role change should name the role in plain language: "Devon Calloway is now an Engineering Manager for this team" is clearer than "Role updated: engineering_manager."

**Inline role descriptions in the role selector (incorporated from Priya's review):** The role selector should include a brief consequence summary beneath each option — not just a label. "Engineering Manager" alone is not self-explanatory to a new team member who does not yet know what EMs do and do not do in this ritual. Suggested inline text:

- **Engineer** — participates in session voting
- **Engineering Manager** — can view session history; will not vote

This reduces first-session confusion without requiring a separate tutorial. I accept this recommendation fully. It is consistent with the ritual's emphasis on transparency and informed participation.

**Pre-session verification workflow (incorporated from Priya's review):** I framed member management as "backstage infrastructure" and then did not specify what the facilitator actually does before a session. Priya is right that this understates the operational reality. The most common moment when role misconfiguration is discovered is not mid-session — it is the fifteen minutes before a session when the facilitator is walking through the setup. A new team member who joined via the invite link an hour earlier, received the default `participant` role, and is actually the team's Engineering Manager is a first-session reality, not an edge case.

The member management view must support pre-session verification. The design should make it possible for a facilitator to assess role state at a glance before a session starts. This means role assignments must be clearly visible and readable in list form — not buried behind confirmation dialogs or editable-only states. If a facilitator needs to scan ten names and verify that only one is designated Engineering Manager, the list should support that scan without requiring drill-downs.

**Escalation path when role assignment is restricted to admins (incorporated from Priya's review):** If Q1 resolves to "only admins and EMs can assign roles," the member management view must not dead-end with a grayed-out control and no explanation. A facilitator who discovers a misconfigured role at session-start time needs an actionable path within the application. Options, in order of preference:

1. The member management view surfaces the admin contact (name and an in-app message or email path) when the facilitator does not hold the permission to change a role.
2. The member management view includes an in-app role-change request that notifies an admin.
3. At minimum, the permission restriction is explained in plain language ("Only an Application Admin can change this role. Contact your admin to update this before the session."), not surfaced as an opaque disabled control.

Option 3 is the minimum acceptable implementation. Options 1 or 2 would be significantly better for adoption. A facilitator who encounters a dead-end with no explanation at session-start time will not recommend this tool to anyone. The adoption risk here is real and I want it documented explicitly.

**Pushback on Priya's Observation 3 — the "ready to run a session" pre-flight signal:** Priya recommends that the member management view function as a pre-flight check, surfacing readiness indicators: whether at least one participant-role member exists, whether an EM is correctly designated, whether the facilitator constraint holds. I understand the appeal. I am not incorporating this as part of this use case.

The pre-flight check she describes — particularly the facilitator-constraint check — crosses from role management into session management UX. The member management view should show roles accurately and let a facilitator draw her own conclusions by reading them. If she can see "Engineer" and "Engineering Manager" labels clearly for each member, she can assess readiness without a purpose-built dashboard. Adding readiness indicators to the member management view conflates two different concerns: role display (this use case) and session readiness assessment (a session-initiation UX concern). The correct enforcement point for zero-participants is the session-initiation guard, not an indicator on the member list. I do not want this change's scope to creep into session management territory.

---

## 8. What This Change Must Not Do

**Do not design role assignment as a team creation prerequisite.** The join-link spec explicitly noted that a facilitator who joins a team via a join link should not be blocked from doing so. Role assignment is a post-join operation. This use case should not introduce a pre-join role-selection step.

**Do not treat `global_role` and `membership_role` as the same thing.** The vocabulary confusion between the two role layers is a documented problem in this codebase. Any implementation that writes `membership_role = 'facilitator'` to the database would cause a constraint error, because `facilitator` is not a valid `membership_role` enum value. The implementation must be explicit about which table and which enum it is writing to.

**Do not make Engineering Manager designation reversible without full consideration of access implications.** Demoting an EM removes their read-only access to session history. That is the correct behavior and should be implemented. But the audit log must record the demotion — who changed it, what they changed it from, what they changed it to, when it happened. Session history access is sensitive data. The audit trail for EM designation and removal must be complete.

**Do not call TEAM-006 as part of EM designation in this use case.** This requires explicit treatment (incorporated from Marcus's review). TEAM-006 (`POST /api/v1/teams/:teamId/managers`) establishes the manager/team relationship and requires the target user to already have `global_role = 'engineering_manager'`. A developer implementing EM designation will see TEAM-006 in the API contract and may reach for it. Do not.

**Position A applies to this use case:** `TEAM-005` (setting `membership_role = 'engineering_manager'`) is sufficient for the purposes of this change. The no-manager enforcement, once the session-participation spec is updated per Q4, checks `team_memberships.membership_role`. The session history access check uses the same field. A user does not need `global_role = 'engineering_manager'` for the behaviors this change enables: exclusion from session voting and access to session history for their team. `TEAM-006` and a `global_role` change are not part of this use case.

A separate administrative flow may be required to fully establish EM status at the application-wide level, but that is not this use case's job. If Position A turns out to be incorrect — if another part of the system requires `global_role = 'engineering_manager'` alongside `membership_role = 'engineering_manager'` — that is a new discovery that must be raised before implementation proceeds, not resolved silently during development.

**Do not confuse this use case with the Establish Manager/Team Relationship use case.** TEAM-006 in the API contract is `POST /api/v1/teams/:teamId/managers` and requires application_admin. The "Assign a Role" use case covers membership role changes, not the separate manager/team relationship establishment. These are related operations but they are not the same. The proposal must be precise about which endpoints this change introduces or modifies.

---

## 9. Open Questions — Ranked by Blocking Severity

**Q1 (Blocking): Who can assign roles?**

The use case says Facilitator. The REST API contract says application_admin or EM. This is an unresolved conflict. The BA and security analyst must resolve it before a proposal can be written; the resolution must be reflected in both documents simultaneously. If the resolution is admin-only, the facilitator escalation path described in Section 7 must be designed as part of this change — not deferred.

**Q2 (CLOSED): Does this use case cover `global_role` changes (Facilitator assignment)?**

Closed by Marcus (BA). Facilitator designation is out of scope. This use case covers `team_memberships.membership_role` changes only (Engineer ↔ Engineering Manager). A separate use case stub for "Designate a Facilitator" must be created as an explicit deferral artifact. The use case text must be updated to remove Facilitator as an assignable role before the proposal is written.

**Q3 (Blocking to completeness — must be documented): How are the first Facilitator and first admin provisioned?**

This does not block writing a proposal for team-membership-level role changes, but the proposal must include an explicit out-of-scope note naming the question, the viable options (seed migration, bootstrap endpoint, IdP role claims in First Access), and a named owner for the follow-on work. It cannot remain only in exploration notes. See Section 4 for the full analysis, including the facilitator-facing onboarding friction consideration.

**Q4 (Blocking — upgraded from "should resolve"): Should the session participation spec's no-manager check cover `team_memberships.membership_role` in addition to `users.global_role`?**

Confirmed by Marcus as a prerequisite. The session-participation spec must be updated to check both fields before role assignment is implemented. Without this update, EM designation via this use case does not fully enforce the no-manager constraint. The updated check logic is specified in Section 5a. This is not a parallel task — it is sequentially prior to role assignment implementation.

**Q5 (Resolved — requirement now stated): What happens to locked-in votes when a role changes mid-session?**

The requirement is now stated in Section 6d rather than framed as an expected answer. Role changes take effect on the next API request; pre-change locked-in votes are not invalidated; post-change lock-in attempts are rejected at the session participation endpoint. This must be carried into the session-participation spec update.

**Q6 (Deferred — future use case): How does role removal (full team membership removal) relate to role change?**

The use case says removing a user from a team is a separate use case. That is correct and the separation is clear. The future "remove from team" use case must respect all the same constraints: the audit log, the immediate revocation of access, the preservation of historical session data.

---

## 10. Structural Summary

This use case is more constrained and more ambiguous than any of the Identity and Access use cases I have reviewed. The core operation — changing a team member's role — is straightforward. The surrounding ambiguity is not.

**What can be implemented, given current constraints and scope decisions:**
- Changing `team_memberships.role` between `participant` and `engineering_manager` via a UI built on TEAM-005
- The vocabulary mapping (Engineer / Engineering Manager in UI terms, with inline role descriptions per Section 7)
- The pre-action warning when a role change would leave zero participant-role members (concrete requirement now in Section 6b)
- The confirmation display in plain language
- The audit log requirement
- The mid-session role change behavior (stated as requirement in Section 6d)

**What requires resolution before implementation can begin:**
- Q1: Who can authorize the role change (use case actor and API contract are in direct conflict — still blocking; facilitator escalation path must be designed once this is resolved)
- Q4: The session-participation spec must be updated to check `team_memberships.membership_role` — this is a prerequisite, not a parallel task
- Use case text must be updated to reflect Q2's closure (Facilitator removed as assignable role; Acceptance Criterion 1 and 4 updated per Marcus)

**What is a known gap this change should document but not solve:**
- The bootstrapping path for the first admin and facilitator (must appear as a named artifact with a named owner in the proposal)
- The facilitator view update during mid-session role changes (control surface requirement separate from the data integrity requirement in Section 6d — design work needed)
- The facilitator escalation path if Q1 resolves to admin-only (must be designed explicitly as part of this change, not deferred)
- Role change history visibility for incoming facilitators (the audit log serves compliance but does not serve the facilitator handoff story; Priya flagged this as a gap worth addressing — I agree, but it is a design question for a future use case or an addition to the audit log design, not a blocker here)

**What Facilitator designation requires that this use case does not provide:**
- A new privileged API endpoint for modifying `users.global_role`
- A separate use case stub documenting the deferral with a named owner
- This is an explicitly scoped-out item, not a gap

The implementation team should not begin the proposal for this change until Q1 is resolved by the security analyst and the BA, and Q4 is addressed through the session-participation spec update. Marcus holds the pen on the use case text update. Devon is available as a sounding board on the ritual constraints, not as the authority on the security architecture.
