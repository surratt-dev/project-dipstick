# Champion Sign-Off: establish-manager-team-relationship

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Date:** 2026-07-07

---

## Ritual Integrity: Core Constraints Reviewed

**No-manager participation rule:** Intact. The change does not give Engineering Managers any path into a live session. The design explicitly names live session access (current votes, readiness grid, active connections) as a non-goal and prohibits it unconditionally. Task 5.8 — reject EM live session access with 403 — is marked complete. Task 9.2 — verify EM cannot join a session after TEAM-006 establishes the association — is marked complete. The dual-check enforcement (`global_role` AND `team_memberships.role`) is preserved and explicitly protected in Decision 14. The no-manager rule is untouched.

**Simultaneous reveal:** Untouched. This change has no scope over session mechanics or voting flow. The simultaneous reveal is not mentioned in the proposal, design, or tasks because it does not need to be — nothing here reaches into the session layer.

**Facilitator-from-another-team requirement:** Untouched. This change adds a new non-participant role category (Engineering Manager) that is architecturally distinct from the Facilitator role. The EM/team relationship is established by an Application Admin, not a Facilitator. The facilitator-from-another-team constraint is not weakened, softened, or made optional by anything in this change.

The three load-bearing constraints I care about were not touched. That part is clean.

---

## Vote Attribution Boundary: Specified Correctly, But Gate Condition Was Not Met

Decision 5 defines the attribution boundary correctly. The spec states it in terms I would have written myself: aggregate distributions are permitted, per-participant vote attribution is prohibited, statistical aggregates without individual labels are permitted. The enforcement requirements — EM-facing queries must never SELECT voter_id, the response serialization must exclude voter-identifying fields, a CI unit test must assert the prohibition on every PR — are the right controls.

Tasks 5.2, 5.3, 5.9, and 5.17 are marked complete, which means the boundary was implemented and acceptance-tested.

However, task 1.3 is not checked off:

> Devon Calloway confirms the vote attribution boundary (defined in design.md Decision 5 and manager-team-association spec) in writing before EM-facing view design begins — BLOCKED: requires written confirmation from Devon Calloway; boundary is defined in spec and design.md Decision 5; Phase 3 EM view design does not begin until this is received.

This confirmation was listed as a gate condition. EM-facing view design was not supposed to begin until I confirmed in writing. That gate was not cleared — and based on the task list, Phase 3 work (tasks 5.14 through 5.17) completed anyway.

I am recording here and now that I confirm the vote attribution boundary as specified in Decision 5 of design.md and the corresponding section of the manager-team-association spec. The boundary as written is correct and reflects my intent. But the team should understand that proceeding with Phase 3 before receiving this confirmation was a process deviation from a stated gate condition. If the CI unit test for the attribution boundary (task 5.3) is actually running in the CI pipeline, the substance of the requirement is likely protected. I want verification of that before any team goes live with EM history access.

---

## Concerns

### 1. Threat modeling session not completed (task 1.6 — open)

The threat modeling session covering EM account compromise, retroactive historical data exposure, IdP claim manipulation, and TEAM-006 as an access escalation vector was listed as a Phase 0 gate required before Phase 2. It is not checked off. Decision 6 — full historical access from the association date, with complete session archives exposed to a compromised EM account — was accepted as an organizational risk. That acceptance was conditional on the threat model explicitly naming the scenario. Without the threat model, the organizational acceptance is not documented.

This is not a ritual integrity concern. It is a security posture concern. The EM-facing data access granted by this change is significant — in a team with years of session history, a compromised EM account is a serious exposure. The threat model must be completed before the first team goes live with EM history access. This is not resolved by archiving the change.

### 2. Rate limiting threshold not determined (task 3.10 — open)

Rate limiting on TEAM-006 was called out as a named risk: a bulk call under a compromised admin account could grant historical data access across many teams before the compromise is detected. The threshold was not determined and the task is not complete. This must be resolved before any TEAM-006 calls are made in a production environment.

### 3. Multi-team EM landing experience not decided (task 1.4 — open)

Task 1.4 (product owner decision on the multi-team EM landing view) is not checked off. The design notes the default as a team selector per risk mitigation, which is the right instinct — cross-team aggregate views are a step toward making the Health Check feel like a performance management tool. If the landing experience was implemented without a product owner decision, I want to know what was built and confirm it does not create a cross-team comparison surface.

---

## Summary

The ritual is protected. The no-manager rule, the simultaneous reveal, and the facilitator-from-another-team requirement are untouched and correctly understood in this change. The EM access model — post-session, read-only, aggregate-only, no live data — is architecturally correct and reflects the intent of the original design.

My sign-off on the vote attribution boundary is given above, retroactively but explicitly.

My conditional clearance for production deployment: the threat modeling session (task 1.6) must complete and findings must be documented, the rate limiting threshold (task 3.10) must be set and implemented, and the multi-team landing experience (task 1.4) must be confirmed before the first team goes live with EM history access. Archiving the change does not close those gates.

I am not raising concerns about the overall direction or the authorization model. The work is sound. The process gaps are real and must be resolved before this reaches engineers.

— Devon Calloway
