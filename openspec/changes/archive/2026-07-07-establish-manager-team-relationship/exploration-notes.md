# Exploration Notes: Establish a Manager/Team Relationship
**Perspective:** Devon Calloway, Internal Champion
**Use Case Source:** requirements/use cases/01 - Identity and Access - Use Cases.md (lines 239–294)
**Related Specs:** openspec/specs/session-participation/spec.md, openspec/specs/role-assignment/spec.md
**Related API:** TEAM-006 (`POST /api/v1/teams/:teamId/managers`)
**Date:** 2026-07-06
**Revised:** 2026-07-06 — incorporating facilitator review (Priya Nair) and BA review (Marcus Delgado)

---

## 1. Intent and Why It Matters for the Ritual

The Engineering Manager is a carefully designed non-participant. They do not vote, they do not attend sessions, and — by the explicit design of the ritual — their presence in the room would undermine the honest participation the Health Check depends on. That is not my opinion; it is the load-bearing logic of the whole practice. The simultaneous reveal works because engineers know their manager is not watching them vote.

But managers need visibility. They need to see whether their team's health is trending in a worrying direction. They need to know whether action items are being followed through. The ritual produces data that is genuinely valuable to a manager; it is only the manager's live presence that is harmful.

This use case is the mechanism that gives EMs what they need without giving them what they cannot have. Done right, it keeps the access boundary clean: read the history, stay out of the room. Done wrong — if the access is broader than defined, if individual vote attribution is surfaced to managers, or if the separation between "can see history" and "can participate" is blurred — the ritual integrity erodes.

I want to be clear about what is at stake. Every protection I have fought to make structural depends on the EM role being correctly assigned and correctly constrained. This use case is where the EM/team relationship is formally established. It is foundational to every access control decision downstream.

---

## 2. How This Use Case Differs from "Assign a Role"

The previous exploration for "Assign a Role to a Team Member" (TEAM-005) covered a scenario where a user is already a team member and their `membership_role` is changed to `engineering_manager`. That is distinct from what this use case describes.

```
Two paths to Engineering Manager access on a team:
───────────────────────────────────────────────────

Path A — TEAM-005 (covered in previous change)
  ┌────────────────────────────────────────────────────┐
  │ User is ALREADY a team member as Engineer          │
  │ Admin or existing EM changes their membership_role │
  │ Endpoint: PATCH /api/v1/teams/:teamId/members/:id  │
  │ Precondition: active team_memberships row exists   │
  │ global_role: NOT checked, NOT modified             │
  └────────────────────────────────────────────────────┘

Path B — TEAM-006 (THIS use case)
  ┌────────────────────────────────────────────────────┐
  │ User has NEVER been a team member                  │
  │ They manage the team organizationally              │
  │ Admin establishes the EM/team relationship         │
  │ Endpoint: POST /api/v1/teams/:teamId/managers      │
  │ Precondition: target user has                      │
  │              global_role = 'engineering_manager'   │
  │ Creates or updates team_memberships row            │
  └────────────────────────────────────────────────────┘
```

The organizational scenario for Path B is the more common one in practice: a manager who oversees a team but was never an engineer on that team. They have no prior `team_memberships` row. This use case creates the relationship from scratch.

Both paths ultimately write `team_memberships.role = 'engineering_manager'` to the same table. They are idempotent with respect to each other: if TEAM-005 has already established `membership_role = 'engineering_manager'` for a user on a team, a subsequent TEAM-006 call for the same user/team combination updates the existing row. But their preconditions and authorization requirements are different, and the previous exploration explicitly said "Do not call TEAM-006 as part of EM designation in TEAM-005." That boundary is correct and must be maintained.

The implementation team must not treat these as interchangeable. TEAM-006 has a hard precondition that TEAM-005 does not: the target user must already have `global_role = 'engineering_manager'`. This is the critical new issue this use case introduces.

---

## 3. The Actor Conflict — Same Pattern, Higher Stakes

The use case says the actor is a **Facilitator**.

The REST API contract for TEAM-006 says the authorized actor is `global_role = 'application_admin'` only, explicitly noting that "it cannot be performed by an EM (to prevent privilege escalation) or a facilitator."

This is the same actor conflict that appeared in the "Assign a Role" exploration. But the stakes here are higher for two reasons.

**First:** The operation in this use case creates EM access to session history from scratch — not for a current team member but for a user who has no prior relationship to the team. That is a more significant privilege grant than changing the role of someone who was already a member. An EM who does not belong to a team being given session history access based on a facilitator's say-so is a larger trust assumption than the role-change scenario.

**Second:** TEAM-006 has a precondition that requires the target user to already have `global_role = 'engineering_manager'`. A facilitator who performs this action must be able to identify users by their global role. That means facilitators would need access to user search filtered by `global_role`. This is a broader capability than the role-change use case required and carries its own authorization surface area.

My position: the API contract's answer — admin only — is more defensible here than it was in the role-assignment case. The operation is more sensitive. The facilitator rationale that worked for TEAM-005 (facilitators are operational stewards who configure teams) is weaker here because this use case establishes access to historical session data for someone who was never part of the team.

**However:** the facilitator review makes a point that belongs in this analysis. Facilitators are the actors who do team setup in practice. When a team prepares for their first session, the facilitator configures the context: who facilitates, who participates, which manager has history access. If the TEAM-006 operation requires admin authorization, the facilitator cannot complete setup themselves and cannot confirm it is done before the session starts. If the admin turnaround is slow, the EM misses early sessions or the team waits. Neither outcome is acceptable for a ritual that depends on consistent follow-through to build trust.

This is an operational cost, not only a security question. The security analysis for Q2 must weigh it explicitly. A decision that says "admin only" without naming the facilitated-setup cost — and without specifying the escalation path — is not a complete decision. The minimum escalation requirement remains: a plain-language explanation of why the action is unavailable, plus a clear contact path to the admin. The contact path must be unambiguous. "Contact the admin" with no mechanism is insufficient.

**This conflict must be resolved before a proposal can be written.** Both documents must change simultaneously when it is resolved — not one without the other.

---

## 4. The Global Role Prerequisite — A New Blocker

This is the issue I did not have to face in the "Assign a Role" exploration, and it is the most structurally significant gap in this use case.

TEAM-006 requires: `engineeringManagerUserId` must be a user with `global_role = 'engineering_manager'`.

The API contract is explicit: a `409 Conflict` response is returned if the target user does not have `global_role = 'engineering_manager'`.

There is no API endpoint in the current REST API contract that sets `global_role` for a user. The First Access spec defaults all new users to `global_role = 'engineer'`. The bootstrapping problem from Section 4 of the "Assign a Role" exploration named this as a gap that "must be solved somewhere, but not here." For this use case, that deferral is no longer acceptable.

```
The bootstrapping chain for this use case:

Step 1: User signs in for the first time
        → First Access creates account with global_role = 'engineer' ✓
        → No path to global_role = 'engineering_manager'

Step 2: Someone must set global_role = 'engineering_manager'
        → No API endpoint exists for this operation
        → No documented out-of-band mechanism (seed migration? IdP claim? admin UI?)
        → BLOCKED

Step 3: Admin calls TEAM-006 with the EM's userId
        → Requires step 2 to have succeeded
        → Returns 409 Conflict if step 2 was skipped

Step 4: EM has read-only access to team session data ✓
```

Step 2 has no solution in the current application. This use case cannot function until that is resolved.

The previous exploration listed three viable options:
1. Seed migration: a database script sets `global_role = 'engineering_manager'` for designated users on first deploy
2. Bootstrap endpoint: a privileged API endpoint for initial `global_role` assignment, restricted to admins and protected carefully
3. IdP role claims: the First Access flow reads a role claim from the OIDC token and maps it to `global_role`, so users arrive with the correct global role already assigned

Each option has trade-offs:

**Seed migration** is operational and one-time. It works for initial deployment but requires another out-of-band operation every time a new EM is designated. Not scalable for an organization with changing management structures.

**Bootstrap endpoint** creates a privileged, high-sensitivity API surface. It must be locked down tightly — admin only, audited, not accessible in the normal flow. The security analyst must own the design of this endpoint. If it is implemented incorrectly, it is a privilege escalation vector.

**IdP role claims** is the most transparent and scalable option. If the identity provider carries role claims, First Access can read them and set `global_role` accordingly. This is consistent with how enterprise applications typically handle role provisioning. My original proposal assumed this approach. The current First Access spec does not implement it — but the spec noted it as a named follow-on item.

I am not in a position to choose between these options unilaterally. This is a security architecture question that the solution architect and security analyst must own. But I want to be direct: **the "Establish Manager/Team Relationship" use case should not be proposed or implemented until the path to `global_role = 'engineering_manager'` is documented and either implemented or explicitly scheduled as a dependency.**

A proposal that describes TEAM-006 without a working mechanism to reach its precondition is a proposal for a feature that cannot be used. Going further: teams should not be onboarded with EM history access promised until Q1 is fully resolved. It is not enough to say "this use case cannot be implemented yet." We must not create expectations with teams that we cannot fulfill. If a team completes their first session and EM history access cannot be established because the bootstrapping problem is deferred, that team has been given a commitment we could not keep. That is worse than not promising it at all.

**API precision required (from BA review):**

Two precision gaps in the TEAM-006 contract must be resolved before implementation:

*Idempotency response codes:* The exploration states that TEAM-006 "updates the existing row" when the relationship already exists and returns "success." That is not precise enough. The spec must specify: what HTTP status code is returned in the idempotent case — 200 or 201? Does the response body differ between the create-new case and the update-existing case? If the operation is truly idempotent, the response should not tell the caller whether a row was created or updated. Two developers independently implementing the client and server can make different assumptions about this and neither will be wrong by the current spec.

*409 differentiation:* The exploration names the 409 Conflict for the `global_role` precondition failure. But 409 is also a plausible response for other conditions: team not found (likely 404, not 409 — but it must be stated), team in a state where association is disallowed. The error response body must distinguish between "this user does not have the EM global role yet" and other failure conditions. The calling actor — and any facilitator-facing error UX — depends on knowing which condition occurred.

---

## 5. Critical Ritual Constraints in Play

### 5a. The No-Manager Participation Rule

This use case directly serves the no-manager rule by creating a formal EM/team relationship that grants historical access without session access. The session participation spec (openspec/specs/session-participation/spec.md) already enforces that users with `global_role = 'engineering_manager'` OR `team_memberships.role = 'engineering_manager'` cannot join sessions.

An EM established through TEAM-006 will have both: `global_role = 'engineering_manager'` (required by TEAM-006's precondition) and `team_memberships.role = 'engineering_manager'` (the result of the operation). The enforcement is doubly redundant. That is correct.

There is one scenario to watch: if the `global_role = 'engineering_manager'` requirement for TEAM-006 is later relaxed or replaced by an alternative mechanism, the session participation check must not be weakened along with it. The no-manager enforcement must check BOTH fields regardless of how the relationship was established.

### 5b. The Read-Only Boundary

The use case states that EMs receive "read-only access to session history, trend data, and action items." This is correct and consistent with the application's access model. The original exploration named what EMs must not see. The BA review correctly identified that the positive side of the access model is underspecified. Adding field-level precision here.

**The EM must NOT be able to:**
- View individual vote attribution (who voted what) — this is the most sensitive access point; individual vote data is how you turn a team health tool into a performance review tool, and I will not accept any implementation that surfaces vote attribution to managers
- Create or update action items
- Modify topic configuration
- View live session data (current votes, readiness grid, who is connected)
- Initiate or close sessions

**The EM MUST be able to see — specific fields:**

*For session history:*
- The aggregate vote distribution per topic (e.g., "3 participants voted 4, 1 voted 2") — revealed as a group, no individual attribution
- The session date
- The participant count as an aggregate number — not the names of who participated
- The facilitator name (this is organizational context, not sensitive participant data)
- The topic names active during that session

*For trend data:*
- Trend data over the team's full available history — no artificial time boundary
- All topics that were active during historical sessions, including topics subsequently removed (historical completeness matters for trend integrity)
- Statistical displays: averages, medians, trend direction — without labeling individual participants

*For action items:*
- Title and current status
- Due date if set
- The assignee question requires a design decision: if an action item is assigned to a named engineer, surfacing the assignee's name to the EM is attribution-adjacent. The EM should see that an action item exists and its completion status — whether the assignee name is also visible must be decided explicitly and documented. This is added as Q8 in the open questions.

**Vote attribution boundary — precise definition:**

The BA review drafted language that draws this line more precisely than the original exploration. I am endorsing this language and adopting it into these notes. This is the definition I will confirm with the implementation team when the spec is written:

> EM-facing views of session history and trend data must not surface the connection between a specific vote value and the participant who cast it. Specifically:
>
> - Aggregate vote distributions (e.g., "3 participants voted 4, 1 participant voted 2") are permitted.
> - Named or identifiable per-participant vote values are prohibited.
> - Statistical displays (averages, medians, ranges) that do not label individual participants are permitted.
> - The presence or absence of an outlier flag in the aggregate results is permitted; the identity of the outlier is not.
>
> Acceptance criterion: A QA reviewer testing the EM view must be unable to determine any individual participant's vote for any topic in any session using only the data surfaced in the EM view.

One addition to this draft: action item text is also in scope. If an action item was written in a way that attributes a specific concern to a specific engineer — "Devon raised a concern about deployment process" — that text is attribution-adjacent. The constraint must be considered when reviewing action item text surfaced in EM-facing views. This does not mean action items must be scrubbed of all context; it means the team should be aware that well-intentioned item descriptions can inadvertently attribute concerns to individuals, and the EM view should be reviewed for this risk before finalization.

### 5c. Multi-Team Support

The use case correctly notes: "An Engineering Manager may manage multiple teams." The database schema supports this. TEAM-006 can be called multiple times for the same EM with different `teamId` values. This must be a named acceptance criterion.

The facilitator and BA reviews both reinforce what I noted in the original exploration: the multi-team EM landing experience is not a gap to flag — it is a design-blocking question that must be answered before design begins. Elevating Q5 accordingly.

One observation I can offer that narrows the design options: from watching how managers use the current shared spreadsheet, EMs with multiple teams typically examine each team independently. They are not using the Health Check to compare teams against each other. The ritual is not a benchmarking tool; it is a per-team health signal. This argues against an aggregate multi-team view as the primary landing experience and toward a team selector. It does not answer the design question definitively, but it means the designer should not be defaulting to a cross-team comparison view.

---

## 6. Edge Cases That Must Be Resolved

**6a. The EM searches for themselves in the team member list and is confused**

After TEAM-006 establishes the relationship, the EM has a `team_memberships` row. If the application's team member list shows all users with a `team_memberships` row for a team, the EM will appear there. But the EM is not a team member in the ritual sense — they are an observer.

The original exploration said these should be "displayed differently." That is not a requirement; it is a UX principle. Replacing it with a structural requirement (per BA review):

> The team administration view must display participant members (users with `team_memberships.role = 'participant'`) and associated managers (users with `team_memberships.role = 'engineering_manager'`) in separate, labeled sections. The section headings must make clear that associated managers are not session participants. A facilitator viewing the team administration page must be able to determine at a glance that the EM is a manager of the team, not a voting participant.
>
> Acceptance criterion: A facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation.

This section separation also serves the facilitator's operational need: a facilitator confirming team setup before a session must be able to see that the EM is associated without searching for them in a combined member list.

**6b. An EM is associated with a team they shouldn't manage**

Because the operation requires admin authorization, this is an administrative error. The reverse operation — removing a manager/team relationship — is not described in this use case. But it is an operational necessity. If an EM moves to a different role or changes teams, their association must be removable.

The use case explicitly defers this, and I support that deferral. But the BA review is correct that "named follow-on item" is not specific enough. The proposal must do three things:

1. Explicitly name the removal operation as out of scope for this change.
2. State the interim operational procedure for removing an incorrect association. Until a formal removal endpoint exists, the admin must have a documented, audited procedure for doing this — via the admin interface or a controlled, authorized operation with an audit trail. This procedure must be written in the proposal, not left to ad-hoc discovery. I will not accept "we'll figure it out when it comes up" for an access control operation.
3. Name the person or role responsible for scheduling the removal-operation follow-on change.

An association that cannot be removed is an access control liability that compounds over time.

**6c. An EM is associated with a team where they were previously a participant**

If a user was previously an engineer on a team (via invite link, `membership_role = 'participant'`) and is later formally designated as the EM for that team via TEAM-006, there is an existing `team_memberships` row. TEAM-006 notes say it is idempotent and will update the existing row. This is correct database behavior.

But there is a history question: what happens to their historical votes and participation records? They are a former participant now designated as manager. Their old votes should remain in the session history. Their `session_participants` records remain. What changes is only their `team_memberships.role`. This is clean and correct. But the implementation must not delete or hide their prior participation when their role changes.

**6d. An EM's access is not revoked when they change roles organizationally**

If someone ceases to be an Engineering Manager — if they move to an IC role, leave the organization, or change teams — their `team_memberships.role = 'engineering_manager'` rows must be updated or the rows must be soft-deleted. The application has no mechanism to do this automatically: it does not know about organizational changes unless told. The `deactivated_at` field on `users` handles the "left the organization" case via the IdP. But "changed roles within the org" is not captured. This is an operational gap that should be documented but not solved in this change.

**6e. The facilitated session's historical data becomes visible to a newly-associated EM**

This requires an explicit policy statement, not an inference. The original exploration concluded "yes, full access is correct" but left the decision as an unstated assumption. The BA is right that an implementer may reasonably scope historical access to sessions after the association date without explicit guidance.

The explicit policy:

> Upon successful establishment of the EM/team relationship via TEAM-006, the Engineering Manager is granted read access to the full session history of the associated team. This access is not date-bounded to the association date. Sessions completed before the association was established are included.
>
> This is a deliberate access policy decision. Teams that require time-bounded access to historical data must be handled as a separate configuration capability. That capability is not in scope for this change.
>
> Acceptance criterion: After TEAM-006 is successfully called, the EM can view sessions that completed before the TEAM-006 call was made.

From a ritual integrity standpoint: post-session historical access is the entire point. What matters is that the EM does not see data in real time, during the session. Historical aggregate data is not harmful. This decision should be stated, not assumed.

---

## 7. The Relationship Between This Use Case and the Access Control Use Case

The "Enforce Access Control on Team Content" use case (also in the Identity and Access section) states:

> The application checks the user's relationship to the team: Is the user the Engineering Manager associated with this team?

This check — "Is the user the Engineering Manager associated with this team?" — depends entirely on what TEAM-006 writes. The access control enforcement is downstream of this use case. If this use case is not implemented, or if the relationship it creates is stored inconsistently, the access control for EMs will not work.

This is a dependency that must be explicit in the proposal: the access control use case relies on the EM/team relationship established here. They are not independent. The access control spec must reference the EM/team relationship as a prerequisite.

---

## 8. What This Change Must Not Do

**Do not expose individual vote attribution to Engineering Managers.** See the precise definition in Section 5b. The constraint is not just a spec note — it must be a demonstrable acceptance criterion. Before any team goes live with EM history access enabled, it must be verifiable — with an account in EM role, looking at actual session history — that individual vote attribution is not surfaced. This is a test case, not a design guideline. The proposal must include it as an explicit acceptance criterion.

**Do surface a participant-accessible access model statement.** This belongs in "what this change must do," not "must not do," but I am adding it here as a named requirement because it came out of the facilitator review and is important enough to call out explicitly.

When a new team runs their first session, the moment of highest anxiety is usually someone asking: "Can our manager see this?" Currently the facilitator answers that question. The application should let participants verify the answer themselves. Not a prominent disclaimer — something available if they want to look. "Your Engineering Manager can see session history but cannot join or observe live sessions." One sentence, accessible from the team view or session lobby.

This directly serves my goal: the tool should carry the knowledge I have been carrying manually. If a future facilitator who has never met me runs a first session with a new team, the tool should be able to answer that question on their behalf.

The implementation must not make this prominent. No modal, no acknowledgment flow, no gamification. It should be findable — a clear statement available to any participant who wants to look. The goal is self-service verification, not a compliance checklist.

**Do not conflate this use case with TEAM-005.** These are different operations. TEAM-006 is used when the EM is not a team member. TEAM-005 is used when a team member's role is changed. A developer who reaches for TEAM-005 to implement this use case will implement the wrong thing (TEAM-005 requires an existing team membership; TEAM-006 creates it). A developer who reaches for TEAM-006 to implement the Assign a Role use case will find a different precondition (`global_role = 'engineering_manager'` required) and likely produce bugs in the role assignment flow. The two endpoints must remain distinct.

**Do not implement removal of the EM/team relationship as part of this change.** The scope is establishment only. Removal is a separate use case that requires its own access control analysis and audit log requirements. Mixing the two in one change will balloon scope and delay the establishment path.

**Do not surface this operation to the EM being associated.** The use case correctly notes that notifications to the EM are out of scope. I agree. I would go further: the EM should not receive any in-application notification that they have been given access. They will discover it when they sign in and see their team view. Notifications create expectations about timing and generate support questions. The ritual does not require them.

---

## 9. Open Questions — Ranked by Blocking Severity

**Q1 (Blocking): There is no path to `global_role = 'engineering_manager'`**

TEAM-006 requires it. First Access does not set it. No API endpoint modifies it. This use case is a dead end until this is resolved. The three options are: seed migration, bootstrap endpoint, or IdP role claims in First Access. The solution architect and security analyst must choose. The BA must document the decision. This cannot remain deferred — a proposal written without resolving this is a proposal for an unusable feature. And teams must not be promised EM history access until this is resolved end-to-end.

**Q2 (Blocking): Who is the authorized actor?**

The use case says Facilitator. The API contract says application_admin only. Same conflict as TEAM-005. Same resolution requirement: BA and security analyst must align both documents simultaneously. If admin-only: the facilitator escalation path must be designed explicitly (see Section 3). The operational cost of admin-only authorization must be named in the decision, not treated as an afterthought.

**Q3 (Pre-proposal gate): Vote attribution boundary must be defined and confirmed before EM-facing views are designed**

The constraint exists in intent and is now stated precisely in Section 5b. But the definition I have written in these notes must be reviewed and confirmed before it enters the spec. This is not a documentation task to complete at proposal time — it is a prerequisite to designing the EM-facing history views. If the definition is not confirmed before the views are designed, it will not be enforced; it will be assumed. And I am the person who must confirm it, as the ritual authority on this question.

The BA must schedule this confirmation before the design phase starts.

**Q4 (Deferred, but must be named): Removal of the EM/team relationship**

Not in scope for this change. But the proposal must include: (1) an explicit out-of-scope statement, (2) a documented interim operational procedure for removing an incorrect association, and (3) a named owner responsible for scheduling the follow-on change. See Section 6b.

**Q5 (Design prerequisite — elevated from flagged gap): Multi-team EM landing experience**

This is not a deferred question. It is a prerequisite for the design phase. If an EM manages multiple teams, what do they see when they sign in? The design team must have an answer before wireframes are drawn. See Section 5c for an observation that may narrow the options. The BA will work with the product owner to reach a decision before the proposal is written. This question must not enter the proposal as still open.

**Q6 (Resolved, document the decision): Historical session visibility upon first association**

Resolved in Section 6e: full historical access from the moment of association, not date-bounded. The proposal must state this explicitly rather than leaving it as an inference.

**Q7 (Required for facilitator UX): Facilitator-visible EM status in team view**

After TEAM-006 is called, how does the facilitator confirm it succeeded? The facilitator who configures teams before sessions needs to be able to see — from within the application — whether the EM association for each team they manage has been established. The team administration view should show the associated EM by name (not just userId) and indicate whether the association exists. An unestablished state should be visually distinct — not an error, but an incomplete setup indicator.

This is not a nice-to-have. If the facilitator cannot confirm setup from within the application, they are managing it out of band — which is exactly what the application is supposed to eliminate.

Additionally: when a facilitator hands off a team to another facilitator, the incoming facilitator must be able to see the EM association as part of the team context they inherit. This is a continuity requirement, not a new workflow. A facilitator picking up a team should not have to conduct a handoff conversation to learn which manager is associated.

**Q8 (Design decision required): Action item assignee visibility to EM**

If an action item is assigned to a named engineer, is that assignee name visible to the EM in the action item view? This sits in attribution-adjacent territory. See Section 5b. The design must make an explicit decision and document it.

---

## 10. Structural Summary

This use case has a simpler core operation than "Assign a Role" but a more constrained precondition chain. The core operation — establishing a `team_memberships` row with `role = 'engineering_manager'` for a user — is straightforward. The surrounding dependencies are not.

**What can be implemented, given resolved constraints:**
- TEAM-006 endpoint: `POST /api/v1/teams/:teamId/managers`
- Idempotent behavior (existing relationship returns success, no duplicate row) — with precisely specified HTTP status codes and response body behavior
- Multi-team support (multiple TEAM-006 calls with different `teamId` values for the same EM)
- EM read-only access to session history, trends, and action items for associated teams — with field-level precision per Section 5b
- Separate, labeled display of participant members and associated managers in team views — structural requirement per Section 6a
- Participant-accessible access model statement in team view or session lobby

**What requires resolution before implementation can begin:**
- Q1: How does a user acquire `global_role = 'engineering_manager'`? No existing path. Blocks TEAM-006 entirely.
- Q2: Who is the authorized actor — Facilitator or application_admin? Use case and API contract conflict. Must be resolved with both documents updated simultaneously.
- Q3: The vote attribution boundary must be confirmed by Devon before the EM-facing history view is designed.
- Q7: Facilitator-visible EM status must be scoped into the team administration view.

**What this change should document but not solve:**
- The removal of an EM/team relationship (separate use case, named owner required, interim procedure documented)
- The multi-team EM landing experience (design decision, must be answered before design is written — not a blocker to the core implementation but must not be left open)
- Historical session visibility upon first association (explicit policy decision stated in Section 6e — no scope required, just documentation)

**The prerequisite chain:**
This use case cannot be proposed or implemented until Q1 is resolved. The bootstrapping question was deferred in the "Assign a Role" exploration. It cannot be deferred again. Before a proposal for "Establish Manager/Team Relationship" is written, the implementation team must have a documented, testable path to creating a user with `global_role = 'engineering_manager'`. If that path is an IdP claim in First Access, the First Access spec must be updated before this change's proposal is written. If it is a bootstrap endpoint, that endpoint must be scoped and designed. If it is a seed migration, the migration must be specified.

I am available as a sounding board on the ritual implications of any of those approaches. The security and architecture decisions are not mine to make. But I want to be explicit: a manager who cannot see their team's health data because a bootstrapping problem was deferred is a failure of this project, and I will name it as such.

---

## 11. Review Responses — Feedback Incorporated and Rejected

### Incorporated from Facilitator Review (Priya Nair, 2026-07-06)

**Actor conflict as operational/workflow problem, not just security question (Observation 1):** Incorporated into Section 3. Priya's point that facilitators are the actors who actually do team setup is a legitimate operational argument that the security analysis must address. I still hold that admin-only is more defensible here than in TEAM-005, but the decision cannot be made without explicitly naming the facilitator-setup cost. The Q2 resolution requirement is updated to reflect this.

**Facilitator-visible EM status in team view (Observation 2, Q-F1, Q-F2):** Incorporated as Q7 and into Section 10. If the facilitator cannot confirm EM association from within the application, the tool has not eliminated out-of-band management. It has moved it. The structural requirement for a labeled, confirmable setup state in the team administration view is now named as a requirement for this change.

**Multi-team EM landing experience elevated to design prerequisite (Observation 3, Q-F5):** Incorporated. Q5 is now a design prerequisite, not a flagged gap. Section 5c is updated accordingly with an observation from the spreadsheet usage patterns that may help narrow the design options.

**Participant-facing access model statement (Observation 4, Q-F4):** Incorporated into Section 8. This directly serves the application's role as the carrier of institutional knowledge I have been carrying manually. The implementation must treat this as findable but not prominent. No modal, no acknowledgment flow.

**Vote attribution as demonstrable acceptance criterion, not spec prose (Observation 5):** Incorporated into Q3 and Section 8. The constraint must be a test case, not a design guideline. The proposal must name it as an explicit acceptance criterion that can be verified with an EM-role account against actual session history.

**Teams should not go live until Q1 is resolved — interim-state gap (Observation 6):** Incorporated into Section 4 and Q1. It is not enough to say the feature cannot be implemented. Teams must not be given commitments about EM history access until the end-to-end path works.

**Facilitator handoff context (Q-F6):** Incorporated into Q7. An incoming facilitator must be able to see the EM association for a team they are picking up without a handoff conversation. This is a continuity requirement consistent with the broader goal.

### Incorporated from BA Review (Marcus Delgado, 2026-07-06)

**Idempotency response behavior unspecified (C1):** Incorporated into Section 4. HTTP status code (200 vs. 201) and response body behavior for the idempotent case must be specified before implementation.

**409 Conflict not differentiated (C2):** Incorporated into Section 4. The 409 for `global_role` mismatch must be distinguishable from 404 (team not found) and other error conditions. The error response body must tell the calling actor which condition occurred.

**Vote attribution boundary with testable definition (V2, R2):** Incorporated into Section 5b. The BA's draft language is adopted verbatim, with one addition: action item text is also in scope for attribution review.

**"Displayed differently" replaced with structural requirement (V1, R1):** Incorporated into Section 6a. The specific structural requirement — separate, labeled sections with acceptance criterion — replaces the vague "displayed differently" framing.

**Historical access as explicit policy statement (C5, R3):** Incorporated into Section 6e. The policy is now stated explicitly: full historical access from association date, no time boundary, deliberate decision.

**"Named follow-on item" for removal must be more specific (V3):** Incorporated into Section 6b. The three components required — explicit out-of-scope statement, interim procedure, named owner — are now named.

**Vote attribution as pre-proposal gate (R4):** Incorporated into Q3. The vote attribution boundary must be confirmed before EM-facing views are designed, not at review time.

**Field-level precision for EM read-only access (C4):** Incorporated into Section 5b. Specific fields are now named for session history, trend data, and action items.

**Multi-team EM landing as design decision, not open question (V4):** Incorporated. The BA is correct that observable spreadsheet behavior should have narrowed the options in the original exploration. Section 5c now includes the observation that EMs use the tool per-team, not cross-team.

**Removal interim procedure must be named (V3):** Incorporated into Section 6b. "Database operation or admin-only backdoor" is restated as "documented, audited procedure" — see rejection note below.

### Rejected Feedback

**"Admin-only backdoor" framing for interim EM removal procedure (BA review, V3):** The BA's language offered "database operation? Admin-only backdoor?" as candidate interim procedures. I am not accepting "backdoor" as a framing or an acceptable approach. Any interim procedure for removing an EM association must be documented, access-controlled, and produce an audit trail. An undocumented backdoor is precisely the kind of quiet workaround that normalizes itself. The difference between "backdoor" and "documented admin-only procedure with an audit trail" is not semantic — it is the difference between an access control liability and a managed operational step. Section 6b reflects this position.

**Prescribing the admin escalation UI mechanism (Facilitator review, Q-F3):** Priya asks whether the escalation contact path is "a button, a form, a contact mechanism built into the tool." These are design decisions, not exploration-level requirements. The exploration establishes the principle: a plain-language explanation of why the action is unavailable, plus an unambiguous contact path to the admin. What form that contact path takes — displayed email, form, generated request — belongs in the design phase, contingent on Q2 being resolved. Over-specifying the mechanism here risks constraining the design before the actor question is answered. The minimum requirement stands; the implementation detail does not belong in exploration notes.

**The implication that vote attribution definition can enter the spec without Devon's explicit sign-off (BA review, R4):** The BA's R4 rewrite suggests the attribution definition should be "documented in the spec" before design begins. That is correct as far as it goes. But the framing risks treating this as a documentation task the BA can complete independently. The vote attribution boundary is a ritual integrity question. The BA can draft the language — and the draft in Section 5b is good — but I must confirm it before it enters the spec. I am the person the team should consult when a requirement touches the core intent of the ritual. R4 is incorporated as a gate, with the explicit requirement that confirmation comes from Devon, not just from internal spec review.
