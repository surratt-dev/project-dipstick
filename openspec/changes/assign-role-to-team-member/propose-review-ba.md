# Proposal Review — Assign a Role to a Team Member
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-06
**Source documents reviewed:** proposal.md, exploration-notes.md, design.md, requirements/use cases/01 - Identity and Access - Use Cases.md

---

## Overall Assessment

The proposal correctly identifies what must change and why. It carries the right scope decisions (Q2 closed, Q4 upgraded to prerequisite, warning behavior specified). The Q1 section is well-structured and gives a stakeholder something real to decide from.

What the proposal does not do is carry those decisions through to the level where a developer can build against them. Capabilities are described as bundles, not requirements. Acceptance criteria are either absent from the proposal or still wrong in the use case document. Two decisions made during exploration are missing from the proposal entirely. And in two places, the proposal creates obligations — a named owner, specific message text — that it then leaves unfulfilled.

These are fixable gaps. None of them are design problems. They are editorial gaps between what was worked out in exploration and what made it into the proposal. My notes below are organized by the fix each one requires.

---

## 1. The `role-assignment` Capability Is Not Implementable As Written

The single `role-assignment` capability reads:

> Team membership role management — the UI and API layer for changing a team member's `membership_role` between `participant` and `engineering_manager`. Covers the member management view, role selector with inline descriptions, pre-action zero-participant warning, plain-language confirmation, role change immediacy, and audit logging.

This is a shopping list, not a capability. A developer reading this does not know when any one piece is done. A reviewer cannot test it as a unit. "Covers the member management view" — what does done look like? "Role change immediacy" — what is the testable criterion?

Each element in that comma-separated list needs its own stated condition. The design.md has most of this already worked out. The proposal should carry it forward. Suggested expansion:

- **Member management view:** A team's members are displayed in a list view with each member's current role labeled as "Engineer" or "Engineering Manager." The view is accessible to an authorized actor before a session begins.
- **Role selector with inline descriptions:** The role selector presents exactly two options — "Engineer" and "Engineering Manager" — each with an inline description as specified in Design Decision 8. No other roles are selectable.
- **Pre-action zero-participant warning:** When a role change would result in zero members with `membership_role = 'participant'`, the specific warning text from Design Decision 5 is displayed before confirmation. The warning does not block the change.
- **Plain-language confirmation:** After a successful role change, the application displays a confirmation naming the person and their new role (e.g., "Devon Calloway is now an Engineering Manager for this team").
- **Role change immediacy:** The next API request from the affected user is evaluated against the updated `team_memberships.membership_role` value. No cached role value is used. (This is restatable as: after a role change, a user whose `membership_role` is set to `engineering_manager` cannot successfully lock in a vote.)
- **Audit logging:** Every role change writes a log entry containing: actor user ID, subject user ID, team ID, from-role, to-role, and timestamp. Both promotions and demotions are logged.

If the decision is to keep a single `role-assignment` capability, each of those bullets should be the acceptance criteria inside it — not left to the implementation team to infer.

---

## 2. Acceptance Criteria Are Missing From the Proposal

The proposal has no acceptance criteria section. It has "What Changes" and a capability description, but no testable conditions an implementer can check off or a QA pass can verify against.

This is not covered by the use case document, which is in a worse state than the proposal. The use case still reads:

> **Acceptance Criteria**
> - A facilitator can change a team member's role to Engineer, Facilitator, or Engineering Manager.
> - The role change takes effect immediately.
> - A facilitator cannot change roles for members of their own team.
> - An unauthorized actor (Engineer, Engineering Manager) cannot change team member roles.
> - The application displays confirmation after a successful role change.

AC1 is wrong on two counts: the actor may not be "facilitator" (Q1 unresolved), and Facilitator is no longer an assignable role (Q2 closed). AC3 was written for a facilitator-as-actor model that Q1 may overturn entirely. AC4 names Engineers and Engineering Managers as unauthorized — but if Q1 resolves to Option A, EMs on their own team are authorized, which contradicts AC4.

The proposal says to "update the use case text" but does not provide replacement AC language. That leaves the update undefined. Whoever makes the edit has to reconstruct what the criteria should be from scratch.

The proposal should carry the new AC text explicitly. At minimum, it should provide stubs with clear markers indicating what Q1's resolution will determine. For example:

> - AC1: An authorized actor [TBD — determined by Q1 resolution] can change a team member's `membership_role` from `participant` to `engineering_manager`, and from `engineering_manager` to `participant`.
> - AC2: The role change takes effect on the next authenticated request from the affected user.
> - AC3 [conditional on Q1 Option A]: An actor without the required authorization sees a plain-language explanation of why the action is unavailable and an actionable path to request the change.
> - AC4: A role change to `engineering_manager` that would leave the team with zero `participant`-role members displays the specified warning message before confirmation.
> - AC5: Every role change produces an audit log entry containing actor, subject, team, from-role, to-role, and timestamp.
> - AC6: A user whose `membership_role` is updated to `engineering_manager` cannot lock in a vote on that team's next session.
> - AC7: A user whose `membership_role` is updated back to `participant` loses access to that team's session history on their next request.

AC7 is worth noting specifically — it addresses the demotion case (exploration Section 6a), which is not named anywhere in the proposal's What Changes section or capability description.

---

## 3. Two Exploration Decisions Are Absent From the Proposal

### 3a. Mid-session data integrity

Exploration notes Section 6d states a requirement:

> A role change applied to a user during an active session does not retroactively invalidate votes that have already been locked in by that user in the current session. If the role change occurs before the user locks in their vote for the current topic, the lock-in request MUST be rejected at the session participation endpoint.

Design.md Decision 6 covers the facilitator readiness grid update but does not restate the data integrity requirement. The proposal does not mention it at all.

This is a gap. Without an explicit requirement, a developer may implement role-change immediacy (next request is evaluated against the updated role) without specifically ensuring the session-participation endpoint applies that check at lock-in time. The phrase "role changes take effect immediately" in the proposal is true but does not specify what happens to an in-progress session.

The What Changes section should include a line: "The session-participation endpoint must reject a lock-in request from a user whose `team_memberships.membership_role` has been updated to `engineering_manager` since the session began, while preserving any votes that were already locked in before the change."

### 3b. Demotion — immediate revocation of session history access

Exploration Section 6a establishes: demoting an EM to Engineer revokes their read-only access to session history immediately. If a session history page is open in their browser, the next request should return 403. This was stated as a named acceptance criterion in the exploration notes.

It does not appear in the proposal's What Changes section, capability description, or anywhere else. It should be named explicitly, because it is the mirror of the promotion-side behavior and it is equally testable.

---

## 4. Vague Language That Needs Concrete Conditions

**"Pre-action warning — with specific message text, before confirmation"**

The proposal says this but does not include the message text. The text exists — it is in both the exploration notes (Section 6b) and design.md (Decision 5):

> "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

The proposal should carry this text, not defer it to design.md. An implementer reading only the proposal has no idea what the message says.

**"Update the use case text to reflect the closed scope decision: Facilitator is not an assignable role in this change"**

This instruction conflates two separate edits that must be made independently:

1. Remove Facilitator from the list of assignable roles (Q2 closure — this can be done now)
2. Update the actor field and AC3 to reflect who can actually perform the action (Q1 resolution — cannot be done until Q1 is signed off)

The proposal treats these as a single update. They are not. Edit 1 can and should be made immediately as part of this proposal. Edit 2 must wait for Q1 sign-off and must happen simultaneously in both the use case and the API contract. The proposal should be explicit about this distinction so the person making the edits knows what is actionable now and what is blocked.

**"Deferral artifact required: A stub for 'Designate a Facilitator' must be created as an explicit deferral — not silently omitted — naming what is deferred and who owns the follow-on"**

No owner is named. The obligation exists but has no accountable party. The proposal should name someone. Similarly, the bootstrapping documentation requirement in the Out of Scope section says "a named owner for that follow-on work" but does not name one. Both deferral artifacts need an owner assigned before this proposal is approved.

---

## 5. Q1 Is Well-Framed But Has One Gap

The Q1 section is the strongest part of the proposal. Three options are presented with clear consequences, Devon's recommendation is stated with reasoning, and the adoption risk of Option A without the escalation path is named explicitly.

One gap: if Option A is selected, the proposal says:

> "Preferred: the view surfaces the admin contact (name and an in-app message path) for facilitators who need a role corrected before a session starts"

This is stated as "preferred," which is softer than it should be. The exploration notes are more direct: "Option 3 is the minimum acceptable implementation. Options 1 or 2 would be significantly better for adoption." The proposal should reflect that minimum-acceptable is still a defined, testable requirement, not an optional preference.

The acceptance criterion for the escalation path should be stated in the proposal alongside Q1's options, so that when a stakeholder signs off on Option A, they are simultaneously signing off on a specific escalation UX level (minimum vs. preferred). A stakeholder who signs off on "Option A" without knowing the escalation UX is underspecified may later contest what was included in this change.

Suggested addition under Option A:

> **Acceptance criterion (required if Option A is selected):** When an actor who does not hold the required authorization accesses the member management view, they see a plain-language explanation of why role assignment is unavailable AND a specific actionable path (at minimum: the admin contact name and how to reach them). A grayed-out control with no explanation is not acceptable and will not pass acceptance.

---

## 6. The "See Design for Rationale" Reference Is Workable But Should Be Stated

In the Impact section, the proposal says: "authorization rules for this endpoint are subject to the Q1 decision (see Design)" and "no new endpoint required for the team_memberships change." The first is fine — design.md Decision 3 has the full rationale.

What I want to make sure is explicit: the proposal currently says "see Design for rationale" regarding why TEAM-006 is not called. Design.md Decision 1 covers this clearly. But a developer who reads only the proposal without reading design.md will not know not to call TEAM-006. The proposal should carry at least one sentence making this explicit: "TEAM-006 is not called as part of this change. `TEAM-005` alone is sufficient. See Design Decision 1 for rationale." The exploration notes call this out repeatedly; the proposal should not rely on the developer finding it in design.md by searching.

---

## Summary of Fixes Required Before This Proposal Is Approvable

| # | Gap | What's Needed |
|---|---|---|
| 1 | `role-assignment` capability is a bundle | Expand to testable sub-conditions or explicit AC |
| 2 | Use case AC are stale and no replacement text is provided | Provide updated AC text (Q1-conditional where applicable) |
| 3 | Mid-session data integrity requirement absent | Add to What Changes: lock-in rejection after mid-session EM designation |
| 4 | Demotion/history-access revocation absent | Add as explicit requirement and acceptance criterion |
| 5 | Warning message text not in proposal | Carry the specific text from design.md into the proposal |
| 6 | Use case text update conflates two separate edits | Separate the Q2-closure edit (do now) from the Q1-actor edit (blocked) |
| 7 | Deferral artifacts have no named owner | Name an owner for "Designate a Facilitator" stub and bootstrapping follow-on |
| 8 | Option A escalation path presented as "preferred" not as minimum requirement | Reframe as minimum-acceptable criterion with testable condition |
| 9 | TEAM-006 exclusion not stated in proposal body | Add one sentence explicitly; do not rely on design.md reference alone |

Q1 is presented clearly enough for a stakeholder to make a real decision. The sign-off requirement is stated. The three options and their consequences are well-described. What is missing is: a named mechanism for how sign-off is communicated back into the documents, and an explicit statement that the use case actor field update and the API contract update must happen simultaneously and be reviewed together before implementation begins. Add both and Q1 is complete.

The proposal is close. The decisions are right. The gaps are in carrying those decisions through to language that developers and testers can use directly.
