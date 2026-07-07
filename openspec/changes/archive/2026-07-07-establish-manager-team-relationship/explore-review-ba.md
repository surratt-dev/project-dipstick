# BA Review: Exploration Notes — Establish Manager/Team Relationship
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Source:** exploration-notes.md
**Date:** 2026-07-06

---

## Summary Assessment

The exploration is well-structured and the blocking dependencies are identified with unusual clarity — that is not common in exploration documents and I want to acknowledge it. Devon understands the ritual constraints and the authorization architecture well enough to know where the hard problems are. The three blocking questions (Q1, Q2, Q3) are correctly ranked and the reasoning behind them is sound.

That said, this document is not ready to drive a proposal. The blockers are named but not resolved. Several acceptance conditions that are stated in principle have not been written out in testable form. And there are a handful of areas where the exploration is precise about what the problem is but hand-wavy about what the solution looks like. Those are the gaps I am flagging here.

---

## Clarifications Needed

### C1 — Idempotency response behavior is unspecified

Section 2 states that TEAM-006 "updates the existing row" when an EM/team relationship already exists and returns "success." This is correct in spirit but insufficient for implementation.

**What I need to know:**
- When TEAM-006 is called and the relationship already exists (idempotent case), what HTTP status code is returned — 200 or 201?
- Does the response body differ between the create-new case and the update-existing case?
- If the operation is truly idempotent, the response should not tell the caller whether a row was created or updated. Is that the intent?

Without this, two developers implementing the client and the server can independently make different assumptions about what a success response means and neither will be wrong by the spec.

### C2 — The 409 Conflict is not differentiated

Section 4 names the 409 Conflict response for the case where `global_role ≠ 'engineering_manager'`. But 409 is also a plausible status for other conflict scenarios (team does not exist, team is in a state where association is disallowed). The API contract must distinguish:

- What status code is returned for `teamId` not found? (Likely 404, not 409 — but it must be stated.)
- Is the 409 specifically and only for the global_role precondition failure? Or are there other conflict conditions?
- What is the error response body for the 409? The calling actor needs to know whether to tell the admin "this user isn't an EM yet" vs. "there's a data problem."

The implementation team cannot write meaningful error handling without this.

### C3 — The admin escalation UX is named but not described

Section 3 states that if admin-only authorization is the resolution for Q2, "a plain-language explanation of why the action is unavailable, plus a contact path to the admin" is the minimum requirement. This is a correct principle but not a requirement.

**What I need:**
- Where does this explanation appear? In the UI action that would otherwise perform the operation? As a tooltip? A modal?
- What is "a contact path to the admin"? A displayed email address? A link to send a message? A button that generates a request?
- Is this requirement contingent on Q2's resolution, or is it a general pattern that applies regardless of which actor is authorized?

Until Q2 is resolved, I understand this cannot be fully written. But when it is resolved, this escalation path must be documented as an acceptance criterion, not a side note.

### C4 — "Read-only access to session history, trend data, and action items" needs field-level precision

Section 5b defines what EMs must NOT see and what they MUST see, which is a useful start. But the positive side of the access model is still underspecified.

For session history, I need to know:
- Which fields from a completed session are surfaced to the EM? The revealed vote distribution per topic? The session date? The number of participants? The facilitator name?
- Is the session history a list view or a drill-down? Can the EM click into an individual session?

For trend data:
- Trend data over what time period? All history? Configurable?
- Are all topics shown, including topics that have since been removed? (The exploration does not address this intersection.)

For action items:
- What fields does the EM see? Title, status, assignee, due date? Or title and status only?
- Can the EM see who an action item is assigned to? (That touches attribution territory.)

The fact that Q3 — vote attribution must not be surfaced — is a named blocker makes this more urgent, not less. We cannot say the access model is correct until we have drawn the line precisely across all data types.

### C5 — The historical session visibility decision needs a stated position, not just an acknowledgment

Section 6e raises the question of whether historical sessions should be visible to an EM who was not designated as the manager at the time those sessions ran. The exploration's conclusion is that full historical access is correct.

That conclusion is reasonable. But it must appear in the requirements as a stated position, not as a downstream inference from "full access is granted upon association." The requirement should read something like:

> Upon successful completion of TEAM-006, the EM gains read access to all session history for the associated team, including sessions completed before the association was established. There is no date boundary on historical access.

If this decision is not written down, an implementer may reasonably scope historical access to sessions after the association date. I have seen this happen.

---

## Vague Areas

### V1 — "Display separation between participant members and associated managers"

Section 6a identifies that the team member list will show both participant members and associated managers if both have `team_memberships` rows. The recommendation is that they be "displayed differently." This is accurate as a UX principle but is not a requirement.

What does "displayed differently" mean?
- Two labeled sections in one list?
- Separate panels or tabs?
- A visual badge or tag distinguishing the two?
- Does the EM appear in the member list at all, or in a separate "Team Managers" surface?

This is not a cosmetic question. If the EM appears in the main member list, even labeled differently, a new facilitator could mistake them for a participant. If they appear in a completely separate section, the session setup flow needs to account for navigating to that section to confirm association. The design must make a choice. "Displayed differently" is not that choice.

**Suggested rewrite:** See R1 below.

### V2 — The vote attribution constraint is named but not drawn

Section 8 states "do not expose individual vote attribution to Engineering Managers" and Q3 ranks it as blocking to correctness. I agree on both counts. But what exactly is individual vote attribution?

The exploration correctly identifies the obvious case: "Devon voted 2, Marcus voted 4 — is not." But where is the line between aggregate and attributed?

Consider:
- A session with 3 participants where Topic A received votes of [2, 2, 4]. The distribution makes individual votes potentially derivable in a small team. Is this vote attribution?
- The "outlier" flag — a participant whose vote diverged from the group — does not name the outlier but could narrow it down. Is this acceptable?
- Action items often include notes that indicate which engineer raised a concern. Is the action item text itself attribution-adjacent?

I am not saying all of these are problems. I am saying the constraint as written is not specific enough to test. An acceptance criterion that says "individual vote attribution is not surfaced to EMs" fails to define attribution in a way that an engineer writing the EM view can use as a decision rule.

The spec for this change must define the attribution boundary with enough precision that an implementer can make a yes/no call for any given data point.

### V3 — "Named follow-on use case with a named owner" for EM relationship removal

Section 6b and Section 9 Q4 correctly defer the removal operation and state it must be "a named follow-on item in the proposal." Devon says: "An association that cannot be removed is an access control liability." Correct. But "a named follow-on item" is not a specific enough commitment.

What does a named follow-on item mean in practice? A Jira ticket? A line in the proposal's out-of-scope section? A change proposal drafted in parallel?

For this to be meaningful from an access control standpoint, the proposal must:
1. Explicitly name the removal operation as out of scope in this change
2. State what the interim operational procedure is for removing an incorrect association (database operation? Admin-only backdoor?)
3. Name the person or role responsible for scheduling the follow-on

If there is no interim procedure and the follow-on is unscheduled, "named follow-on" is a way of saying "we will leave broken associations in place indefinitely."

### V4 — Multi-team EM landing experience is unresolved and the exploration does not narrow the options

Section 5c and Q5 identify that an EM who manages multiple teams has an unaddressed landing experience. Q5 raises three candidates: team selector, most recently active team, aggregate view. But Devon does not eliminate any of them or identify what information would help choose.

This is a design question, not a BA question — but it must be answered before design is written, and the exploration leaves it entirely open. Marcus is flagging this as a gap in the exploration, not just a design gap.

At minimum, the exploration should have identified the decision criteria: Is the primary use case monitoring a single team at a time or comparing across teams? Do EMs typically focus on one team or genuinely split attention? The answer to those questions would narrow the options. Without them, the designer is guessing.

I will work with the product owner to get an answer before the proposal is written. But this should not have been left as an open question in the exploration — there is enough observable behavior in how managers use the spreadsheet today to make a recommendation.

---

## Suggested Rewrites

### R1 — Replace "displayed differently" with a specific structural requirement

**Current (exploration, Section 6a):**
> The UI must distinguish between "participant members" and "managers associated with this team." These are semantically different relationships and should be displayed differently.

**Suggested rewrite for the spec:**
> The team administration view must display participant members (users with `team_memberships.role = 'participant'`) and associated managers (users with `team_memberships.role = 'engineering_manager'`) in separate, labeled sections. The section headings must make clear that associated managers are not session participants. A facilitator viewing the team administration page must be able to determine at a glance that the EM is a manager of the team, not a voting participant.
>
> Acceptance criterion: A facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation.

### R2 — Replace the vote attribution must-not with a testable constraint

**Current (exploration, Section 8):**
> Do not expose individual vote attribution to Engineering Managers. ... per-person breakdown — Devon voted 2, Marcus voted 4 — is not.

**Suggested rewrite for the spec:**
> EM-facing views of session history and trend data must not surface the connection between a specific vote value and the participant who cast it. Specifically:
>
> - Aggregate vote distributions (e.g., "3 participants voted 4, 1 participant voted 2") are permitted.
> - Named or identifiable per-participant vote values are prohibited.
> - Statistical displays (averages, medians, ranges) that do not label individual participants are permitted.
> - The presence or absence of an outlier flag in the aggregate results is permitted; the identity of the outlier is not.
>
> Acceptance criterion: A QA reviewer testing the EM view must be unable to determine any individual participant's vote for any topic in any session using only the data surfaced in the EM view.

### R3 — Replace the historical access assumption with an explicit policy statement

**Current (exploration, Section 6e):**
> From a ritual integrity standpoint: yes. The data is historical and read-only.

**Suggested rewrite for the spec:**
> Upon successful establishment of the EM/team relationship via TEAM-006, the Engineering Manager is granted read access to the full session history of the associated team. This access is not date-bounded to the association date. Sessions completed before the association was established are included.
>
> This is a deliberate access policy decision. Teams that require time-bounded access to historical data must be handled as a separate configuration capability. That capability is not in scope for this change.
>
> Acceptance criterion: After TEAM-006 is successfully called, the EM can view sessions that completed before the TEAM-006 call was made.

### R4 — Strengthen the Q3 blocker into a pre-proposal gate condition

**Current (exploration, Section 9, Q3):**
> The constraint exists in intent but is not named explicitly in any spec. It must be a named acceptance criterion in the spec for this change.

**Suggested rewrite for the proposal gate:**
> Before the proposal for "Establish Manager/Team Relationship" is written, the following must be documented in the spec: a precise definition of what constitutes "individual vote attribution" for the purposes of access control on EM-facing views, and an explicit acceptance criterion that tests whether that definition is enforced. This is not a post-implementation verification task. If the definition is not written before the EM-facing views are designed, it will not be enforced — it will be assumed.

---

## What Is Specific Enough to Carry Forward

The following areas of the exploration are sufficiently precise that they can be translated into requirements without further clarification:

- **The distinction between TEAM-005 and TEAM-006** (Section 2). The precondition difference is clearly stated and the implementation risk of conflating them is well-named. This belongs in the spec as an explicit developer note.
- **The doubly-redundant session participation enforcement** (Section 5a). The check against both `global_role` and `team_memberships.role` is correctly specified and the note about not weakening either check if the global_role mechanism changes is a valid, testable constraint.
- **Multi-team support** (Section 5c). The acceptance criterion — an EM can be associated with more than one team — is stated clearly. It should be carried into the spec verbatim.
- **Former participant now EM** (Section 6c). The behavior is well-reasoned: the `team_memberships.role` is updated, prior `session_participants` records are retained, prior votes remain in session history. This can be written as a regression test criterion directly.
- **Removal is out of scope** (Section 6b). The deferral is correctly justified. Carrying the explicit out-of-scope statement into the proposal will prevent scope creep.
- **The access control dependency** (Section 7). The dependency between TEAM-006 and the "Enforce Access Control on Team Content" use case is clearly articulated and must appear in the proposal as an explicit dependency reference.

---

## Pre-Proposal Gate: What Must Be Resolved

I am treating the following as gates that block the proposal from being written. Writing a proposal without resolving these will produce requirements that cannot be implemented correctly or cannot be tested.

**Gate 1 (Q1): Document a testable path to `global_role = 'engineering_manager'`.**
This is not a BA decision. The solution architect and security analyst must choose between seed migration, bootstrap endpoint, or IdP role claims. Whatever is chosen must be specified precisely enough that a QA engineer can write a test for it. I will document the decision once it is made.

**Gate 2 (Q2): Resolve the actor conflict between the use case and the API contract.**
The use case says Facilitator. The API contract says application_admin. Both documents must be updated simultaneously when this is resolved. The BA and security analyst must align. Until this is resolved, I cannot write authorization acceptance criteria for TEAM-006.

**Gate 3 (V2 / Q3): Define the vote attribution boundary.**
Before the EM-facing views are designed, the attribution line must be drawn precisely. I have drafted candidate language in R2 above. That draft must be reviewed and confirmed by Devon (as Internal Champion and ritual authority) before it enters the spec.

**Gate 4 (V4 / Q5): Resolve the multi-team EM landing experience.**
This is a design decision, not an implementation detail. It must be made before design begins. I will facilitate a decision with the product owner. It should not enter the proposal as an open question.

---

*Review complete. No proposal should be initiated until the four gate conditions above are met.*
