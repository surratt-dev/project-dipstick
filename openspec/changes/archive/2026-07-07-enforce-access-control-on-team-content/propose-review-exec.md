# Executive Review: Enforce Access Control on Team Content
**Reviewer:** Rachel Okonkwo, VP of Engineering
**Date:** 2026-07-07
**Source reviewed:** openspec/changes/enforce-access-control-on-team-content/proposal.md

---

## Summary Assessment

I support this change. The proposal makes the right call on every substantive policy decision — the Application Admin boundary, the no-caching rule, the EM aggregate-only constraint, the consistent denial behavior. The rationale in each decision section reflects exactly the access model I said was non-negotiable when this project was approved.

My concerns are about sequencing and scope, not direction. Three issues need resolution before the team starts implementation.

---

## Concern 1: The `draft` Session Status Belongs in a Different Change

Groups 7 (Facilitator Session Lifecycle) accounts for 10 tasks and touches the session state machine, a schema migration, a background expiry task, and the creation endpoint. The rationale for it — facilitators need to review historical data before creating the session, not after — is legitimate. Priya's review from the explore phase confirms this is a real workflow problem.

But it is a workflow problem, not an authorization problem. The authorization model works without `draft`. Decision 3 acknowledges this explicitly: the fallback is to document the workflow inversion and frame session creation as "start preparation." That fallback is less convenient for facilitators. It is not a psychological safety gap. No engineer's vote is exposed because a facilitator lacks a preparation-mode session status.

Bundling `draft` into this change adds state machine complexity, a background task, and lifecycle edge cases to a security enforcement change that already spans 10 groups and 47 tasks. That is scope creep. The implementation risk that `draft` introduces — new status, 24-hour expiry, status queries in every status-checking codepath — can affect delivery of the authorization infrastructure that is actually blocking adoption.

My recommendation: descope `draft` into a session lifecycle change that runs after this one ships. Use Decision 3's fallback. Frame session creation as "start your preparation" in the facilitator UX and document the workflow explicitly. Reassess `draft` status once the first team is actively running sessions and we have direct facilitator feedback on whether the workflow inversion is tolerable.

This descoping removes 10 tasks and eliminates the background task requirement. It does not compromise the security posture of the change.

---

## Concern 2: Zero-Latency WebSocket Revocation Is Proportional, But Deserves an Explicit Fallback Commitment

Group 8 (WebSocket Delivery-Time Authorization) is 9 tasks. The business case is that a user removed from a team mid-session should stop receiving live session events without requiring a reconnect. The threat model is an engineer who is mid-session and gets their membership revoked.

I understand why the team specified delivery-time checks over connection-time or subscription-time checks. The security argument is correct: connection-time checks cannot satisfy re-authorization requirements. And SEC-25, as cited, does not give us an "eventually consistent" option on this.

My concern is implementation risk, not the requirement itself. Delivery-time authorization means a live database read on every pushed event during an active session. The design documents this risk explicitly and points to two mitigation controls: index the team membership and session status queries to keep reads fast, and use a timer-based fallback if latency is unacceptable.

That fallback is described as acceptable only "if delivery-time checking introduces unacceptable latency or implementation complexity." The open question in the design (Q-implementation) asks what latency bound is acceptable. That question has no owner and no answer.

My recommendation: before implementation begins on Group 8, the engineering lead must answer Q-implementation with a specific bound. If delivery-time checks produce per-event latency above that bound in the test environment, the team switches to the timer-based fallback with a stated maximum latency (e.g., 60 seconds from database commit to event cessation). The proposal should carry that number, not leave it to be discovered during implementation.

This is not a reason to delay the change. It is a reason to do the measurement before writing the WebSocket code.

---

## Concern 3: Option B Is the Right Call — But the Admin Operational Gap Must Be Acknowledged and Owned

Decision 2 chooses Option B: Application Admins access administrative data only and are blocked from session content unconditionally. The rationale is sound. An admin who can access session content — even through an audited path — creates a surveillance vector that audit logging cannot adequately mitigate after the fact.

I am on record that data controls are non-negotiable. Option B is the correct choice.

However, the design flags a risk that I want to name explicitly at the executive level: "Admins who need session-level diagnostics must work through a team facilitator or team member." This constraint will create friction when we need to investigate data integrity issues, diagnose session recording failures, or respond to a reported data anomaly. The answer to "why did this session's data not appear in the trend dashboard?" requires someone with session content access. Under Option B, that person cannot be an admin.

This is a trade-off I accept. But it is a trade-off that must be owned rather than discovered. Before this change ships:

- The support and operations runbook must document explicitly that session-level diagnostics require a team facilitator or team member's involvement.
- The admin UI must surface a clear message when an admin hits a session content boundary — not a generic 403, but an explanation that names the boundary and the escalation path.
- Whoever is designated as the operational point of contact for system issues (likely the engineering lead for this application) must have a defined escalation path that does not require them to create a fake team membership to access data.

These are operational commitments, not implementation tasks for this change. But they need to be named here so they do not get lost between the proposal and the first time an admin hits the boundary in production.

---

## On Scope: 47 Tasks / 10 Groups Is Proportional If Scoped Correctly

My concern about scope is specific, not general. The authorization enforcement core — Groups 1 through 6 and Group 10 — is appropriately sized for what it is doing. Building a shared authorization helper, enforcing the content access matrix at the serializer layer, establishing consistent 403/404 behavior, and testing all of it end-to-end is not over-engineering. It is installing the floor that every future content endpoint will stand on. We cannot descope our way to a cheaper version of that without leaving gaps that undermine the ritual.

If `draft` session status is removed (my Concern 1), the task count drops to approximately 37 across 9 groups. That is a substantial change, but it covers new infrastructure with security implications and an existing codebase that has no shared authorization contract. I would not characterize it as over-engineered.

What I would flag: Group 9 (Live Session Facilitator Error States) requires specific UX decisions — error message text, banner behavior, recovery paths — that should involve Priya Nair in review before implementation. Priya's explore review surfaced legitimate concerns about what facilitators see when authorization checks fail during a live session. Those concerns are addressed by this group, but the implementation team should not write the error states without a facilitator sign-off on the UX before code is written. That is a coordination step, not a task, and it should be explicit.

---

## Adoption Risk Assessment

This change is on the critical path for first-team deployment. The prior five changes built the data model. This change builds the enforcement layer that makes the data model trustworthy. Without it, the application is deployed with session history endpoints that have no shared authorization contract. Devon's framing in the design document is accurate: the threat is not an external attacker. It is a skeptical engineer on the first team who makes a direct API call to verify that the tool does what it says it does.

If that engineer finds a gap — and they will look — the ritual's credibility is gone before it starts. Objective 4 (no engineer perceives the data as evaluative or punitive) is not achievable if the enforcement layer is incomplete. The psychological safety guarantee is the entire value proposition of this application.

Delaying this change is not a viable path. Descoping the WebSocket group or removing `draft` status is viable. Descoping the core authorization infrastructure is not.

The team that is first to adopt needs to see this change land before their first session. That is the scheduling constraint I am asking the implementation team to hold.

---

## Summary of Recommendations

| Issue | Recommendation | Blocking? |
|---|---|---|
| `draft` session status (Group 7) | Descope to a follow-on session lifecycle change; apply Decision 3 fallback (frame session creation as preparation start) | Yes — should not ship in this change |
| WebSocket latency bound (Q-implementation) | Engineering lead must specify a measurable bound before Group 8 implementation begins; document timer-based fallback criteria | Yes — must be answered before Group 8 starts |
| Admin operational gap | Document the escalation path and admin UI messaging before go-live; assign operational owner | Not blocking implementation, but blocking first deployment |
| Facilitator error state UX (Group 9) | Require Priya Nair sign-off on error message text and recovery path before code is written | Not blocking start, but blocking Group 9 completion |
| Core authorization infrastructure (Groups 1–6, 10) | Proceed as specified | Approved |
| Application Admin Option B (Decision 2) | Approved as stated | Approved |
