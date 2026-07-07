# Proposal Review — Business Analyst
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Document reviewed:** proposal.md
**Date:** 2026-07-06

---

## Overall Assessment

The proposal is structurally sound. The why is clear, the blocking dependencies are named, and the out-of-scope boundaries are correctly drawn. It correctly flags the authorized actor conflict and the missing `global_role` path as prerequisites rather than implementation risks — that distinction matters and I want to acknowledge it.

That said, there are six problems with this proposal that need to be addressed before the implementation team treats it as buildable. Two of them are correctness issues (the proposal conflicts with the existing API contract in a specific way). The others are specificity gaps that will surface as implementation questions or, worse, as bugs found after the fact.

---

## Problem 1 — "New EM-facing endpoints" conflicts with the existing API contract

**Severity: High — this will mislead the implementation team.**

The Impact section states: "new EM-facing session history and trend data endpoints (read-only)."

These are not new. The REST API Contract already defines EM access for the following existing endpoints:

- **SESSION-007** (`GET /api/v1/teams/:teamId/sessions`) — authorization already includes `engineering_manager` for this team
- **SESSION-008** (`GET /api/v1/sessions/:sessionId`) — authorization same as SESSION-007; EM vote anonymization is already specified at the serialization layer via the `EngManagerSessionTopic` / `voteDistribution` response shape
- **TREND-001** (`GET /api/v1/teams/:teamId/trends`) — authorization already includes `engineering_manager`; notes explicitly state "EM access: score values are aggregates per topic per session. No individual vote attribution is returned."
- **TREND-002** (`GET /api/v1/teams/:teamId/topics/:topicId/trend`) — authorization same as TREND-001
- **ACTION-004** (`GET /api/v1/teams/:teamId/action-items`) — authorization already includes "engineering_manager: active team manager — sees the managed team's backlog (read-only)"
- **ACTION-005** (`GET /api/v1/action-items/:actionItemId`) — same as ACTION-004

The EM access model for these endpoints is already designed and specified in the REST API Contract. The work in this change is not building new endpoints — it is implementing the authorization enforcement that makes EM callers reachable at these existing endpoints. The TEAM-006 `team_memberships` row is the key that unlocks access.

If the proposal is left saying "new endpoints," the implementation team has two bad paths: build duplicate endpoints that conflict with the existing contract, or implement the existing endpoints and then discover the proposal doesn't describe what they built. Either outcome creates unnecessary rework.

**Required change:** Replace "new EM-facing session history and trend data endpoints (read-only)" in the Impact section with: "EM-authenticated callers are now reachable at SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 — these existing endpoints already model EM access; this change provides the `team_memberships` row that makes the authorization checks pass."

Also update the "updated team member list response (`GET /api/v1/teams/:teamId/members`)" in Impact — the correct endpoint is `GET /api/v1/teams/:teamId` (TEAM-003), not a members sub-route. TEAM-003's response already includes both a `members` array and an `engineeringManagers` array, which aligns with the labeled section requirement.

---

## Problem 2 — Action item assignee visibility (Q8) is already decided in the API contract, but the spec treats it as PENDING

**Severity: High — the spec has a PENDING marker on a question the API contract has already answered.**

The manager-team-association spec states: "Assignee visibility to EM: [PENDING Q8 RESOLUTION — must be decided explicitly before the action item view is designed]."

ACTION-004's response shape already includes `ownerDisplayName` in the response that EMs are authorized to receive. ACTION-005 also returns `ownerDisplayName` to EM callers. The API contract has implicitly resolved Q8: the assignee name is visible to EMs.

There are two possibilities here:

a) The API contract is correct and Q8 should be resolved as "assignee name is visible to EMs" — in which case the PENDING marker needs to be replaced with a stated decision and a rationale.

b) The API contract needs to be updated to redact `ownerDisplayName` for EM callers, consistent with the spec's caution about attribution — in which case the API contract needs to change before the spec resolves.

This cannot remain as PENDING. If the implementation team builds ACTION-004/ACTION-005 per the API contract, they will expose `ownerDisplayName` to EMs. If the spec later resolves Q8 the other way, that's a regression fix, not a forward change. The decision must be made now.

The attribution boundary language in the spec (Decision 5, design.md) says action item text "that attributes a concern to a named engineer is attribution-adjacent and must be reviewed before EM-facing display." Assignee names are not vote values, but they do reveal team member identity in the context of a work tracking record. This is the type of question Devon Calloway needs to answer, not leave as PENDING.

**Required change:** Resolve Q8 explicitly, update the spec to replace the PENDING marker with a stated decision, and verify that the API contract's ACTION-004/ACTION-005 response shapes are consistent with that decision.

---

## Problem 3 — Capability bundling makes testability unclear

**Severity: Medium — creates implementation planning ambiguity.**

The single `manager-team-association` capability slug bundles at minimum six distinct behaviors:

1. The TEAM-006 endpoint itself (creation, idempotency, error responses)
2. Audit trail for association establishment
3. EM read-only access to existing session history / trend / action item endpoints
4. Vote attribution boundary enforcement
5. Team administration view labeled sections
6. Participant-accessible access model statement

These are independently testable and can fail independently. A deployment where TEAM-006 works but the labeled sections don't is a partial failure that the capability model as written cannot represent.

This is not a blocker on its own — the tasks list does correctly separate these into independent task groups. But the capability model in the proposal creates the false impression that the manager-team-association capability is either all done or not started. If there's a project tracking tool that uses capability slugs to report status, this structure will produce misleading status reports.

**Suggested change:** Break `manager-team-association` into sub-capabilities or at minimum add a note that the single slug encompasses multiple independently testable components. The tasks already have the right structure; the capability model should reflect it.

---

## Problem 4 — The `first-access` gate language is self-contradictory

**Severity: Medium — will cause confusion during implementation kickoff.**

The modified capabilities section for `first-access` states: "This is a hard prerequisite: the first-access spec must be updated before this change can be proposed for implementation."

This change is already a proposal. The statement as written would make this proposal invalid by its own logic. What is meant — and what should be written — is: "The first-access spec must be updated with the chosen mechanism before any implementation tasks in this change begin. No TEAM-006 code is written until the end-to-end path from sign-in to `global_role = 'engineering_manager'` is documented and the first-access spec is updated."

The gate structure in tasks.md (tasks 1.1–1.5) already captures this correctly. The proposal language needs to match it.

**Required change:** Replace the contradictory sentence with a clear statement: "Implementation of any task in this change is blocked until the mechanism for setting `global_role = 'engineering_manager'` is documented in the first-access spec and verified end-to-end. Task 1.2 is the gate condition."

---

## Problem 5 — Audit trail target is unspecified and the infrastructure may not exist

**Severity: Medium — the spec references "same audit infrastructure as TEAM-005" but that infrastructure is not defined.**

The TEAM-006 spec says "in the same audit infrastructure used by TEAM-005." The TEAM-005 API contract references "SEC-13" as the authority for audit requirements and states "The audit log must record the change."

The database schema has no audit log table. The schema's architectural validation notes state that "WebSocket-level audit events are logged to the structured log, not to a database table." The schema does have `action_item_history` for action item changes, but that is a domain-specific history table, not a general audit log.

If TEAM-005 audit records go to a structured application log (not a database table), "same audit infrastructure" means structured log. If TEAM-005 audit records are expected to go to a database table that hasn't been designed yet, this change needs to either define that table or defer the audit requirement until the infrastructure exists.

The TEAM-006 audit field list in the spec is specific and correct (actor_user_id, actor_global_role, actor_ip, target_user_id, team_id, operation, timestamp). But the destination for those fields is unspecified. An implementation team that hits this question in sprint planning will either make an independent decision or stop work to ask.

**Required change:** The spec must specify where the audit record goes — structured application log or database table. If it goes to a database table, the table must either exist in the schema or a schema change must be part of this change's scope.

---

## Problem 6 — "Team view or session lobby" is two places, not one

**Severity: Low — but it will produce inconsistent implementations.**

The participant-accessible access model statement requirement specifies: "accessible from the team view or session lobby." The "or" here means two different surfaces are both acceptable. A developer who reads this will pick one. A different developer on a different sprint will pick the other. A QA engineer testing against this requirement cannot determine which surface to check.

The use case and design both list the same "or" phrasing, which suggests this has not been resolved rather than that both surfaces are equally valid.

From a participant's standpoint, the session lobby is the more natural place: that is when the question "can my manager see this?" is most likely to surface. The team view is appropriate for persistent reference. Both could be present, but if both are present, both need to be in scope.

**Required change:** Specify whether the statement appears in the team view, the session lobby, or both. If both: say so explicitly and add both to the acceptance criteria. If one: name it and remove the "or."

---

## Acceptance Criteria Assessment

The existing acceptance criteria (in the spec scenarios) are testable for most behaviors. Specific cases that are either missing or implicit:

**Missing: No acceptance criterion for the GET /api/v1/teams/:teamId (TEAM-003) response showing separate `members` and `engineeringManagers` arrays.** The labeled sections requirement depends on TEAM-003 returning both arrays in a way that maps to separate UI sections. The API contract already defines this response shape (`members` array and `engineeringManagers` array), but there is no acceptance criterion confirming that the EM appears in `engineeringManagers` and not in `members` after TEAM-006 succeeds.

**Missing: No acceptance criterion for the case where a user has both a participant history and a current EM role on the same team.** The spec covers "historical participant designated as EM retains their previous participation records" as a scenario, but does not specify what TEAM-003 returns for that user — do they appear in `members` (historical), `engineeringManagers` (current), or both? The database schema has a soft-delete approach (`removed_at`), but TEAM-006 on an existing participant updates the role rather than creating a new row. If the role is updated in place, the user's prior participation history is in `session_participants`, not in `team_memberships` — so they would correctly appear only in `engineeringManagers`. But this needs to be a stated acceptance criterion, not an inference.

**Vague: "The application SHALL provide a documented, tested, and access-controlled mechanism."** This is stated in the first-access spec, but "documented, tested, and access-controlled" is a collection of adjectives without testable conditions. It should be restated as: "A QA engineer with no direct database access can verify that a user reaches `global_role = 'engineering_manager'` through the chosen mechanism by following documented steps only."

---

## Gaps Against Requirements

**The "Establish a Manager/Team Relationship" use case (UC, Identity and Access, page 10)** lists a precondition: "The Engineering Manager has been assigned the Engineering Manager role on at least one team, or this action establishes that association." This is slightly inconsistent with the proposal's model, which requires `global_role = 'engineering_manager'` as a hard precondition for TEAM-006 — meaning the EM must already have the global role before the team relationship is established. The use case precondition implies the team relationship IS the mechanism that establishes the role. This ambiguity between `users.global_role` and `team_memberships.role` in the use case language is the root of the confusion that has existed throughout this change. The resolved version of the use case (once Q2 is resolved) should clarify that TEAM-006 establishes the `team_memberships.role = 'engineering_manager'` row only, and that `users.global_role = 'engineering_manager'` must pre-exist as a separate precondition. The use case document needs this correction.

**The access control use case (UC, Identity and Access, page 11)** asks: "Is the user the Engineering Manager associated with this team?" The proposal correctly notes that this check is satisfied by the `team_memberships` row. But the use case's main flow still has redundant language — step 2 asks both "Is the user a member of the team (Engineer, Facilitator, or Engineering Manager role on this team)?" AND "Is the user the Engineering Manager associated with this team?" as if they are separate checks. They are not. After TEAM-006, the EM's relationship to the team is the `team_memberships` row. Both bullets in step 2 resolve to the same row. The use case should be simplified to reflect this, or an implementer will write two separate authorization checks that are semantically identical.

---

## What Is Specific Enough to Carry Forward Without Change

The following elements of the proposal and specs are specific enough that I am comfortable with them as written:

- The TEAM-006 endpoint specification (method, path, request body, idempotency rules, differentiated error codes) — this is precise and buildable
- The vote attribution boundary in Decision 5 / design.md and the corresponding spec text — this is the most important correctness requirement in the change and it is well-defined
- The labeled sections requirement and its acceptance criterion — "a facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation" is a testable behavioral criterion
- The multi-team EM independence scenarios — these are correctly specified
- The historical access policy (no date boundary) — this is stated explicitly and the acceptance criterion is clear
- The out-of-scope declaration for relationship removal — correct and necessary; the proposal is right to make this explicit

---

## Summary of Required Changes

| # | Change | Severity |
|---|---|---|
| 1 | Replace "new EM-facing endpoints" with "authorization now reachable at existing endpoints SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005" | High |
| 2 | Resolve Q8 (action item assignee visibility) and remove PENDING marker from spec; verify API contract consistency | High |
| 3 | Correct the self-contradictory gate language for `first-access` prerequisite | Medium |
| 4 | Specify audit trail destination (structured log vs. database table) | Medium |
| 5 | Replace "team view or session lobby" with a single specified surface | Low |
| 6 | Add acceptance criterion for TEAM-003 `engineeringManagers` array post-TEAM-006 | Low |
| 7 | Correct the "Establish a Manager/Team Relationship" use case precondition language to distinguish `global_role` from `team_memberships.role` | Low |

Items 1 and 2 are correctness issues. The others are specificity gaps. None of the high-severity items will be obvious to the implementation team until they are in sprint — which is the wrong time for them to surface.

---

*Review complete.*
