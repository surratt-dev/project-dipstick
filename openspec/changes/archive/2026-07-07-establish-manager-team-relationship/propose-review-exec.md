# Executive Stakeholder Review
**Change:** establish-manager-team-relationship
**Reviewer:** Rachel Okonkwo, VP Engineering
**Date:** 2026-07-06

---

## Overall Assessment

This change is strategically necessary. The EM/team relationship is the hinge on which the entire access model turns — without it, Engineering Managers cannot see anything, and the trend visibility I approved this project to deliver doesn't exist. I support moving this forward, with two concerns that need resolution before implementation begins.

---

## What This Gets Right

**The field-level attribution boundary is handled correctly.** The requirement to prohibit individual vote attribution in EM-facing views is non-negotiable, and I'm glad to see it called out explicitly with Devon Calloway's sign-off named as a gate. This is not a documentation detail — it is the core trust guarantee that makes the ritual work. If engineers ever believe a manager can see who voted what, participation drops and the data becomes worthless. Keep this gate hard.

**The participant-accessible access model statement belongs in scope.** A single findable sentence explaining what an EM can and cannot see is low cost and high trust value. Engineers should not have to wonder. I want this in the product, not in an FAQ.

**Scoping out the removal operation is the right call.** Defining it explicitly as out of scope with a named owner and an interim procedure is disciplined. I would rather have a working association path with a documented administrative workaround for removal than have both paths delayed while the team figures out the full lifecycle.

**Auditing association establishment is appropriate.** Given that these relationships gate data access, the audit trail is not overhead — it is the record I would need if a concern about improper access ever surfaced.

---

## Concern 1: The Authorization Conflict Is a Policy Question, Not a Technical One

The proposal flags a conflict: the use case says Facilitators can establish the EM/team relationship; the API contract says Application Admins can. The proposal correctly requires this conflict to be resolved before implementation, but it stops there.

This is not a question the implementation team should resolve on their own. It is an organizational governance question: who has the authority to formally assign an Engineering Manager to a team?

My position: **this should require Application Admin authorization, not Facilitator authorization.** Assigning an EM to a team grants that person ongoing read access to session history, trend data, and action items — indefinitely. That is a consequential access grant. A Facilitator may rotate. An admin account carries accountability. The use case document needs to be updated to reflect this before implementation proceeds.

I am flagging this here so the proposal cannot move forward without explicit resolution. The team should confirm which document gets corrected and surface it for my acknowledgment.

---

## Concern 2: The First-Access Prerequisite Creates a Dependency I Want Tracked

The proposal correctly identifies that TEAM-006 cannot function without a mechanism to set `global_role = 'engineering_manager'` on a user account — and that no such mechanism currently exists in the first-access spec. This is a real blocker, and I appreciate that it is named clearly rather than left as an assumption.

What I want to understand: how long does this prerequisite add to the path? The options listed (IdP role claim mapping, privileged bootstrap endpoint, seed migration) have meaningfully different complexity profiles. A seed migration procedure might unblock implementation this week. An IdP integration might take a sprint on its own.

My ask: before this change is accepted for implementation, someone needs to propose which `first-access` mechanism will be used and get agreement on it. I am not asking for it to be fully implemented first — I am asking for the approach to be decided so the implementation team is not blocked mid-work. The first-access spec update can proceed in parallel with early TEAM-006 work, but it cannot be unresolved at implementation start.

---

## Scope Assessment

The scope is proportional to the value. The core deliverable — endpoint, EM read-only access, field-level boundaries, UI structural change, access model statement, audit trail — is the minimum viable version of what I need to actually use this feature. Nothing here looks like gold-plating.

One clarifying question: after this change is complete, will an EM with an established team association be able to navigate to trend data and session history in the application? Or does this change establish the relationship and gate access, with the actual views coming in a subsequent change? If the EM-facing views are a follow-on, I want to see that change scoped and queued before this one closes. I approved this project to surface trend data to managers — the relationship row alone doesn't deliver that.

---

## Summary

| Area | Assessment |
|------|------------|
| Strategic alignment | Strong — this is foundational to the access model |
| Scope proportionality | Appropriate — no scope creep identified |
| Field-level attribution boundary | Handled correctly; Devon Calloway gate is right |
| Authorization conflict | Must be resolved as policy before implementation; my position is Application Admin |
| First-access prerequisite | Approach must be decided before implementation starts |
| EM view availability | Needs clarification — are views in this change or a follow-on? |

I will not block this change from proceeding to implementation planning, but I expect the authorization conflict to come back to me with a recommended resolution, and I expect the first-access approach to be decided before the team picks up TEAM-006.
