# BA Review: Exploration Notes — Assign a Role to a Team Member
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Source:** exploration-notes.md
**Date:** 2026-07-06

---

## Overall Assessment

This is the most structurally complex exploration Devon has produced so far. The two-role-layer analysis in Section 2 is the most important thing in the document, and Devon is right that it is the foundation everything else rests on. The mapping table and the immediate consequence — that no endpoint exists for `global_role` modification — are stated with enough precision to carry directly into a proposal, provided the scope decision is made correctly.

The blocking questions Devon raised in Section 9 are real. My job here is not to re-flag them; Devon has already done that. My job is to assess whether each is truly blocking or can be deferred, identify where Devon's analysis stops short of a requirement, and surface gaps Devon did not raise.

The core problem with this exploration: several findings are correctly identified but stop at "this must be decided" rather than providing the specific acceptance conditions an engineer needs to build and test against. Two of these are high-priority. There are also two gaps — things Devon did not raise — that matter significantly for requirements.

---

## Clarifications Needed

### 1. The Scope Decision on Facilitator Assignment Must Be Made Before the Proposal — Not Restated as Open

Devon's Section 6e correctly identifies that assigning the Facilitator role requires changing `users.global_role`, for which no endpoint currently exists. Devon recommends Option 2: scope this use case to team membership roles only (`participant ↔ engineering_manager`) and handle Facilitator designation separately. That recommendation is correct. But a recommendation in an exploration document is not a decision. This use case cannot be proposed with Facilitator as a reachable option when no backend operation can fulfill it.

This is my call as BA. I am closing it here:

**Decision: This use case is scoped to `team_memberships.membership_role` changes only. The assignable roles for this use case are Engineer (stored as `participant`) and Engineering Manager (stored as `engineering_manager`). Facilitator designation is out of scope for this change and must be addressed as a separate use case requiring a new privileged API endpoint.**

This decision has three downstream consequences that must be reflected in the proposal:

**a.** The use case text — specifically the Preconditions, Main Flow step 3, and Acceptance Criterion 1 — must be rewritten to remove Facilitator as an assignable role in this change.

**b.** Any UI role selector built for this change must not include a "Facilitator" option. If the UI surfaces only roles that `TEAM-005` can write, Facilitator is not in that list.

**c.** A separate use case stub for "Designate a Facilitator" must be created to capture the deferred scope. It cannot be silently omitted — it must be explicitly deferred with a documented rationale and a named artifact for tracking.

Until the use case text is updated to reflect this scoping decision, any proposal written against the current use case will carry an incorrect set of assignable roles and potentially an incorrect actor.

---

### 2. The Actor Authorization Conflict Must Be Resolved, Not Documented

Q1 in Devon's exploration is flagged as blocking. It is. But Devon's treatment stops at "both answers have defensible rationale — the BA and security analyst need to weigh in." That is a correct statement of what is needed, not a resolution.

Here is what I can establish as BA before the security analyst weighs in.

The API contract's answer — only `application_admin` and `engineering_manager` (for their own team) can call TEAM-005 — is the more recent document. It appears to represent a deliberate decision that was made without informing the use case, which is a process failure but not a reason to ignore it. The use case's own Notes section acknowledges the actor question as open. The API contract closed it. The question is whether that closure is correct.

From a requirements standpoint: the use case's rationale for Facilitator-as-actor is operational — facilitators are the stewards of the ritual, they should be able to configure teams. The API contract's rationale for restricting to admin and EM is security — role assignment is a privileged operation with access control implications, and a Facilitator who is explicitly not a permanent team member should not be able to elevate other users' access to that team's sensitive history.

Devon correctly notes the security concern. I will not override it. But I also will not accept a silent resolution. **Before the proposal is written, the security analyst must weigh in with a recommendation, and I must update either the use case actor or the API contract authorization — one of the two, not both left in conflict.**

If the security analyst recommends restricting to admin and EM: the use case actor changes from "Facilitator" to "Application Admin | Engineering Manager." The precondition that "the facilitator is a member of a different team than the one being modified" becomes irrelevant and must be rewritten. The UX is designed for an administrator or EM flow, not a facilitator flow.

If the security analyst recommends allowing Facilitator: TEAM-005's authorization model must be updated, and a security analysis of the privilege implications must be documented and approved before the endpoint change ships.

Either way, both the use case and the API contract must reflect the same answer.

---

### 3. "May Warn" Is Not an Acceptance Criterion — Specify the Warning

Section 6b correctly strengthens the use case's "may warn" to "should warn." But "should warn with a specific, visible message" is still not a requirement. An engineer implementing this feature needs three things that Devon does not provide:

**a. What is the message text?**

Suggested text for the proposal:

> "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

**b. Where does the message appear and at what point in the flow?**

A pre-action warning shown before the confirmation button is pressed is different from a toast shown after the action completes. These have different UX and different implementation implications. I expect this to be a pre-action warning — surfaced when the user selects the new role, before they confirm. The proposal must specify this.

**c. What is the condition that triggers the warning?**

"A role change that would leave the team with zero participant-role members" is the condition. The check is: after applying this change, does any member of this team have `membership_role = 'participant'`? If not, show the warning. This is checked at submission time.

**Suggested acceptance criterion:**

> When a role change would result in the team having zero members with `membership_role = 'participant'`, the application SHALL display a warning message before the user confirms the change. The warning SHALL explain that no session can proceed without at least one Engineer. The warning SHALL NOT block the change — the user may confirm and proceed.
>
> Scenario: Role change reduces Engineers to zero
> - GIVEN a team with exactly one member with `membership_role = 'participant'`
> - WHEN an authorized actor selects a new role of Engineering Manager for that member
> - THEN the application displays the warning before the action is confirmed
> - AND if confirmed, the role change proceeds and the member's `membership_role` is updated

---

### 4. Audit Log Requirement Is Stated But Not Specified

Section 8 states: "the audit log must record the demotion — who changed it, what they changed it from, what they changed it to, when it happened." This is a concrete requirement. It does not appear anywhere in the use case's Acceptance Criteria. That is a gap.

The use case must be updated to include an audit log criterion. What needs to be added:

> Every role change MUST be recorded in the application audit log with: the identity of the actor who made the change, the identity of the affected user, the team on which the change was made, the previous role value, the new role value, and a timestamp. This applies to both promotion (Engineer → Engineering Manager) and demotion (Engineering Manager → Engineer).
>
> Scenario: Audit log entry created on role change
> - WHEN an authorized actor changes a team member's role
> - THEN the audit log contains a record with: actor id, affected user id, team id, previous role, new role, and timestamp
> - AND the record is created regardless of whether the change was a promotion or a demotion

The EM demotion scenario Devon raises in Section 6a — "Demoting an EM to Engineer revokes their session history access immediately" — is also not in the acceptance criteria. It should be. Devon frames it as "should appear in the acceptance criteria," which is correct, but that framing means someone has to add it. I am confirming: add it to the use case before the proposal is written.

---

## Vague Areas — Need Resolution Before Proposal

### 5. The Session-Participation Spec Must Be Updated — This Is a Prerequisite, Not a Suggestion

Devon raises Q4 as "should resolve before proposal" and frames it as "I believe it should" cover both role fields. That belief is correct. But "I believe it should" is an opinion in an exploration document, not a requirement in a spec.

The situation is this: the session-participation spec currently checks only `users.global_role` to enforce the no-manager constraint. This use case creates a path to set `team_memberships.membership_role = 'engineering_manager'` for a user whose `global_role` may remain `engineer`. Once that path exists, a user can have EM team membership without the `global_role` value the session participation check currently looks for. The enforcement is incomplete.

I am confirming Q4 as a prerequisite: **The session-participation spec must be updated to check `team_memberships.membership_role` in addition to `users.global_role` before the role assignment feature is implemented.** The current spec is a first-entry stub with a known scope limitation. Updating it is not future work for someone else — it is the work this change makes urgent.

The updated check should read:

> A user MUST NOT be recorded as a session participant if their `users.global_role = 'engineering_manager'` OR if their `team_memberships.membership_role = 'engineering_manager'` for the team whose session they are attempting to join.

This update must appear in the proposal as a named dependency, and the session-participation spec must be updated before any implementation tasks begin.

---

### 6. Mid-Session Role Change Behavior Must Be a Stated Requirement, Not an Inference

Section 6d describes the mid-session scenario correctly and provides an expected answer. Devon frames it as inference: "the answer I expect is." That is not a requirement that an engineer can build or test against.

This does not require extensive deliberation. The principle is already established by Section 5c of the exploration — role changes take effect on the next authenticated request. Applying that principle consistently:

**Proposed requirement text:**

> A role change applied to a user during an active session does not retroactively invalidate votes that have already been locked in by that user in the current session. The role change takes effect on the user's next API request. If the role change occurs before the user locks in their vote for the current topic, the lock-in request will be rejected at the session participation endpoint (server-side check on `team_memberships.membership_role`). If the role change occurs after the user has locked in, the vote is recorded and counted at reveal.

This should be stated explicitly in the session-participation spec. It should not be left to inference.

---

### 7. The Bootstrapping Deferral Must Land in a Named Artifact

Devon is correct that Q3 — how the first admin and facilitator are provisioned — is not this use case's job to solve. But "the team must answer before implementation begins" is a concern, not a documented deferral. Floating concerns in exploration documents disappear.

The proposal for this change must include an explicit out-of-scope note that states:

> Bootstrapping of `global_role` values above `engineer` — including the first `application_admin` and the first `facilitator` — is not addressed by this change. Before this feature is considered production-ready, the deployment documentation must specify the bootstrapping mechanism. Options include: a seed migration run at first deploy, a bootstrap endpoint accessible only in initialization mode, or IdP role claims honored during First Access (which would require a modification to the First Access spec).

That text — or equivalent — must appear in the proposal with a named owner for the follow-on work. It cannot remain only in exploration notes.

---

## Gap Devon Didn't Raise: The Use Case Acceptance Criteria Are Insufficient for This Complexity

The five acceptance criteria currently in the use case do not reflect the complexity Devon's exploration revealed.

**Criterion 1: "A facilitator can change a team member's role to Engineer, Facilitator, or Engineering Manager."** This must be updated to reflect the scoping decision (Facilitator out of scope) and to specify which table and which field are written.

**Criterion 4: "An unauthorized actor (Engineer, Engineering Manager) cannot change team member roles."** Once the actor conflict in Q1 is resolved, this criterion may be incorrect. If the resolution is "only admins and EMs can change roles," then Engineering Managers can change roles for their own team — which is the opposite of what this criterion says. This must be updated once Q1 is closed.

**Missing criteria that must be added before the proposal is written:**
- EM demotion immediately revokes session history access (Section 6a — Devon noted this should appear in acceptance criteria; someone must add it)
- Audit log record created on every role change (see Item 4 above)
- Warning displayed when role change would leave team with zero participant-role members (see Item 3 above)
- Role change is reflected in `team_memberships.membership_role` — not in `users.global_role` — for Engineer and Engineering Manager assignments

Five acceptance criteria for a use case with this much behavioral complexity is not enough. The acceptance criteria are the contract between requirements and implementation. They must cover the full behavioral surface before a proposal is written.

---

## Gap Devon Didn't Raise: The TEAM-005 and TEAM-006 Relationship Needs Explicit Treatment

Devon correctly states in Section 8: "Do not confuse this use case with the Establish a Manager/Team Relationship use case." That is correct guidance. But Devon does not address whether this use case's EM designation is complete without also involving TEAM-006.

TEAM-006 (`POST /api/v1/teams/:teamId/managers`) establishes the manager/team relationship and requires the target user to already have `global_role = 'engineering_manager'`. If this use case only sets `membership_role = 'engineering_manager'` and leaves `global_role` as `engineer`, then TEAM-006 cannot be called for this user afterward — the precondition on `global_role` would fail. This means a user designated as EM via this use case may be in an inconsistent state: EM membership role on the team, but not the global role that other parts of the system may expect.

The proposal must explicitly address one of two positions:

**Position A:** `TEAM-005` (setting `membership_role = 'engineering_manager'`) is sufficient for the purposes of this use case. The no-manager enforcement checks `team_memberships.membership_role` (per Q4 above), the session history access check uses the same field, and `TEAM-006` / `global_role = 'engineering_manager'` are not required for the behaviors this change enables. State this explicitly.

**Position B:** A complete EM designation requires both `TEAM-005` and a `global_role` change. If so, Facilitator designation and EM global_role assignment are both `global_role` changes, both require an endpoint that does not currently exist, and the scoping decision in Item 1 above must also address EM.

I believe Position A is correct — this use case scopes to team membership, and the session-level enforcement should be updated to match (per Q4). But this must be stated explicitly in the proposal, not assumed. A developer who encounters TEAM-006 in the API contract while implementing EM designation will reach for it if the proposal does not explain why it is not called here.

---

## Items Ready to Carry Into a Proposal Without Changes

The following sections are sufficiently specified and need no further clarification:

- **Section 5c (Role changes must be immediate):** The requirement is clear, implementation guidance is clear, and rationale is stated. Ready to carry as an acceptance criterion.
- **Section 5b (Facilitator-from-another-team rule is unaffected):** The analysis is correct and the reasoning is stated. Carry as an "interaction with existing constraints" note.
- **Section 6a (EM demotion revokes session history access):** The scenario is clear. Add it to the acceptance criteria with the word "immediately." Devon's framing is correct.
- **Section 6c (No EM on team is not a blocking constraint):** Correct. Carry as an explicit "not required" note so no one adds an unnecessary validation.
- **Section 7 (UX vocabulary mapping):** The requirement to show "Engineer" and "Engineering Manager" — not `participant` and `engineering_manager` — in UI text, and to display a human-readable confirmation message, is clear and ready to carry.
- **Section 8's four "must not" constraints:** All four are clear, rationale is stated. Carry as explicit scope exclusions in the proposal.

---

## Open Questions — Status

| Question | Who Closes It | Status |
|---|---|---|
| Q1: Who can assign roles? (Facilitator vs. Admin/EM) | BA + Security Analyst | Blocking. Security analyst review needed; use case and API contract must then align. |
| Q2: Does this use case cover Facilitator/global_role changes? | BA | Closed above. Facilitator out of scope. Use case text must be updated before proposal. |
| Q3: How are first admin and facilitator provisioned? | Deployment/ops decision | Deferred — not this use case. But deferral must be documented with a named owner and target artifact. |
| Q4: Should session-participation check membership_role in addition to global_role? | BA | Confirmed as prerequisite. Session-participation spec must be updated before implementation begins. |
| Q5: Mid-session locked-in votes after role change | BA | Resolved above as a stated requirement. Carry into session-participation spec update. |

---

## Summary

Three items must be resolved before a proposal can be written:

1. **Actor authorization (Q1):** The security analyst must weigh in. Once they do, I will finalize the use case actor and the update required to the API contract. The proposal cannot be written with the use case and the API contract in direct conflict.

2. **Use case text update (Q2):** The use case must be updated to remove Facilitator as an assignable role and to correct Acceptance Criterion 4 (which may be reversed by the Q1 resolution). These are textual changes I own and will make once Q1 is closed.

3. **Session-participation spec update (Q4):** The spec must be updated to check `team_memberships.membership_role` in addition to `users.global_role`. This is a prerequisite, not a parallel task. Without it, EM designation via this use case does not fully enforce the no-manager constraint.

Two gaps Devon did not raise need to be addressed in the proposal:

- The use case's current five acceptance criteria are insufficient. They must be expanded before the proposal is written to cover EM demotion/access revocation, audit logging, the zero-participants warning, and the correct field being written.
- The TEAM-005 / TEAM-006 relationship for EM designation must be explicitly addressed in the proposal. A developer who sees TEAM-006 in the API contract while implementing EM designation will reach for it. The proposal must explain why Position A (TEAM-005 only) is correct and sufficient.

The exploration is a strong document. Devon's two-layer analysis is the right foundation, and the structural summary in Section 10 is accurate about what can and cannot proceed. The work needed before a proposal is: closing the authorization question, updating the use case text, and translating Devon's findings into specific acceptance criteria rather than concern statements.
