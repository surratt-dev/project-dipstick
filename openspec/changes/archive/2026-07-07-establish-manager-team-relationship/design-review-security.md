# Security Design Review — Establish Manager/Team Relationship

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-06
**Documents reviewed:** design.md, proposal.md
**Scope:** Authentication flows, data access boundaries, audit logging, threat model impact, deferred and implicit security decisions

---

## Summary

This change introduces a permanent, retroactive, read-only access grant to sensitive historical session data — vote distributions, trend data, and action items — for a user class (Engineering Managers) that currently has no application access path at all. The security posture of the change depends on three controls working correctly and in coordination: (1) the mechanism that elevates a user's `global_role` to `engineering_manager`, (2) the TEAM-006 access grant and its audit trail, and (3) the serialization-layer vote attribution boundary enforced in all EM-facing views.

All three of those controls have unresolved design elements as of this review. Two of them have explicitly deferred decisions that the design designates as "security analyst must own." This review is the security analyst's input on those decisions and on the findings that do not require a decision — they require a fix.

The findings below are separated into blocking items (no implementation should proceed past Phase 0 until resolved) and tracked items (must be resolved before any phase that touches the relevant component ships to production). I have not flagged items that the design already handles correctly — only gaps, deferments, and implicit assumptions that need to be made explicit.

---

## Blocking Findings

These findings prevent any implementation work from beginning on the relevant phases. They are not documentation issues. They are design gaps that, if implemented without resolution, will produce a system with structural security defects.

---

### B-1: Audit trail atomicity is unresolved, and the current framing introduces a write-ordering risk

**Location:** design.md — Impact section, database bullet: "Audit trail destination must be confirmed before any TEAM-006 implementation task begins"

**Finding:**

The TEAM-006 operation writes a `team_memberships` row (granting permanent, retroactive access to historical session data) and must also write an audit record. The design acknowledges the destination is unresolved but frames this as a logistics question — database table vs. structured log. It is a security question.

If the audit record is written to a structured application log, the write is not atomic with the database transaction. A successful database commit followed by a logging failure means access was granted with no audit record. A logging success followed by a database rollback means an audit record exists for an operation that did not complete. Neither of these is a benign edge case — TEAM-006 grants indefinite, retroactive access to sensitive historical data. The audit record is the control that makes this grant detectable and reviewable.

**Required action:**

The audit record for TEAM-006 MUST be written to a database table within the same transaction as the `team_memberships` row. If no `audit_log` table exists, this change must create one as part of Phase 2. A structured log write is not acceptable for this operation. The design currently leaves the door open to the structured log path and marks the question as "to be confirmed" — that door must be closed in the design before Phase 2 begins.

This is the same conclusion the design implies with its note about "transactional rollback requirements" — I am making it explicit so there is no ambiguity when the implementation team reaches Phase 2.

---

### B-2: Bootstrap endpoint (global_role Option B) has no security design, and "the security analyst must own the design" is not a design

**Location:** design.md — Decision 2 / Open Question Q1; design.md phrase: "Creates a high-sensitivity API surface that must be locked down carefully. The security analyst must own the design."

**Finding:**

If the implementation team selects Option B (a privileged bootstrap endpoint `POST /api/v1/admin/users/:userId/global-role`) for the `global_role` assignment mechanism, there is no security design for that endpoint. The current document defers the design to this reviewer without providing the context needed to produce it in time for Phase 1. The design notes that Option B "creates a high-sensitivity API surface" and then defers. That deferral is appropriate — this review is the response — but it means Phase 1 cannot begin until the following security requirements for Option B are documented and agreed:

1. The endpoint must be Application Admin authenticated. No other role may call it.
2. The endpoint must validate that the target `global_role` value is one of a fixed, enumerated set — it must not accept arbitrary strings. A caller passing `global_role = 'admin'` or `global_role = 'superuser'` must receive a 400, not a 500 or a silent success.
3. The endpoint must not allow a role to be set lower than its current value via a naive PUT/PATCH. A user who is already `engineering_manager` can be set to `engineer` through this endpoint only if role downgrade is an explicit, separately authorized operation. If the intended use is bootstrap-only (initial assignment), the endpoint should reject requests where the user already has a non-default role, and a separate, explicitly named endpoint must be defined for role removal.
4. Every call to this endpoint — success or failure — must produce an audit record in the database-backed audit log. The record must include: actor_user_id, actor_ip, target_user_id, old_global_role, new_global_role, timestamp, operation_result.
5. The endpoint must apply rate limiting. An Application Admin account is a high-value target. An attacker who has compromised an admin account must not be able to perform bulk role assignments before the compromise is detected. Rate limiting does not prevent abuse entirely, but it narrows the blast radius.
6. The endpoint must not appear in any frontend-accessible API documentation or route autodiscovery that is visible to non-admin users.

Option A (IdP claim mapping) remains my recommended path — see B-3. But if Option B is selected, these requirements are the minimum security design. The implementation team should not begin Phase 1 until these requirements appear in the first-access spec and have been reviewed.

---

### B-3: IdP claim mapping (global_role Option A) requires explicit token validation requirements, not just a mapping spec

**Location:** design.md — Decision 2 / Open Question Q1: "The OIDC flow reads a role claim from the ID token and maps it to `global_role`."

**Finding:**

Option A is the correct architectural choice for `global_role` assignment. It is also the easiest to misimplement in ways that create privilege escalation vulnerabilities. The design describes Option A as reading a role claim from the ID token and mapping it to `global_role`, but does not specify:

1. Which claim in the ID token carries the role (a custom claim, the standard `roles` claim, a provider-specific claim)?
2. Whether that claim is present in the signed ID token or in a separate userinfo endpoint response. Claims from the userinfo endpoint are not signed — they must be treated differently from claims in the signed ID token.
3. What happens when the claim is absent from the token — is the user assigned a default role, rejected, or allowed to proceed without a `global_role` assignment?
4. Whether the claim is validated against an allowlist of valid role values before the mapping is applied. A claim containing an unexpected value (including a value that looks like a valid internal role not intended to be grantable via IdP) must be rejected, not mapped.
5. Whether the mapping is re-evaluated on each authentication (token refresh, re-login) or only at first access. If a user's IdP role is changed by an administrator, how long before the application reflects that change?

These are not implementation details to be resolved later — they determine whether the `global_role` mechanism is exploitable by IdP claim manipulation. The first-access spec update must answer all five questions explicitly before implementation begins.

---

### B-4: No EM/team relationship removal path exists, and the interim procedure is undefined

**Location:** design.md — Open Question Q4: "Explicitly out of scope. Interim procedure: [to be documented before this change is deployed — documented, audited, access-controlled administrative operation]. Owner for follow-on change: [to be assigned]."

**Finding:**

TEAM-006 grants permanent, retroactive access to all historical session data for the life of the association. The design explicitly defers relationship removal to a follow-on change with no scheduled timeline, no named owner, and no specified interim procedure. The brackets in Q4 are placeholders — they indicate the procedure has not been written.

This is not an out-of-scope observation. It is a blocking finding for deployment. An access grant that cannot be revoked — even administratively — is an access control liability that compounds over time. The scenarios that require revocation include: an EM leaves the organization, an EM changes roles, an EM is determined to have accessed data inappropriately, or an EM account is compromised. In every one of these scenarios, the application provides no mechanism to terminate access.

The design's stated mitigation is: "Document the explicit out-of-scope statement, specify the interim administrative procedure (documented, audited, access-controlled — not a backdoor), and name the owner responsible for scheduling the follow-on removal change." None of those three things have been done. The placeholders remain.

**Required actions before this change is deployed to production (not before implementation begins, but before any team goes live with EM history access):**

1. A written interim administrative procedure must exist. At minimum: a named role (Application Admin) authorized to perform the operation, a defined database operation (`UPDATE team_memberships SET role = NULL` or equivalent removal), and confirmation that the operation is audited through the same audit log as TEAM-006 itself.
2. A named owner for the follow-on removal change must be assigned.
3. A defined timeline or condition for when the follow-on change enters the backlog.

Without these, the deployment gate in the design's migration plan is the phrase "to be documented before this change is deployed" — a condition that is never formally verifiable.

---

## Tracked Findings

These findings must be resolved before the phase that introduces the relevant component ships. They are not decisions to be made during implementation — they are requirements that need to appear in the spec before implementation begins.

---

### T-1: Ongoing EM data access events are not in the audit trail scope

**Location:** design.md — Impact section, audit record fields: "actor_user_id, actor_global_role, actor_ip, target_user_id, team_id, operation, timestamp"

**Finding:**

The audit fields specified in the design cover the TEAM-006 association establishment event. There is no mention of audit records for EM access to session history, trend data, or action items at SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005. The design unlocks EM access at six existing endpoints; none of those endpoints are mentioned in the audit trail design.

An application that audits the access grant but not the access exercise provides an incomplete audit trail. If an EM accesses session history they should not have accessed — or if a compromised EM account is used to exfiltrate historical data — the audit trail as specified will show when the association was established but will not show what data was accessed or when.

**Required action:**

Before Phase 3 (EM-facing views), the spec must define which EM access events generate audit records and what those records contain. My minimum requirement: every EM access to a session history, trend data, or action item endpoint that returns data generates a record containing caller identity, team, session identifier (where applicable), and timestamp. Bulk reads (a trend view covering twelve sessions) should log the team identifier and the date range, not individual session identifiers for each row — logging at that granularity creates a logging volume problem without proportional security value. The access pattern itself is what needs to be visible, not every row returned.

---

### T-2: Action item body content filtering is described but not defined

**Location:** proposal.md — Q8 resolution: "Action item text that attributes a concern to a named engineer remains attribution-adjacent and must still be reviewed before EM-facing display."

**Finding:**

The Q8 resolution establishes that `ownerDisplayName` (action item assignee names) is visible to EMs. It then states that action item body text that attributes concerns to named engineers "must be reviewed before EM-facing display." No mechanism for this review is defined. It is not clear whether:

1. Review means a human approval gate for each action item before it becomes EM-visible
2. Review means a technical filter applied at the serialization layer
3. Review means a one-time policy decision that applies categorically (e.g., "body text is never shown to EMs")

A requirement to review content "before EM-facing display" that does not specify who reviews it, how, or what the enforcement mechanism is will be silently dropped during implementation. The serialization layer will either show the full body text or not, and the decision will be made by whoever writes the serializer rather than by the people who should be making it.

**Required action:**

The spec must resolve this before Phase 3 begins. The resolution options are: (a) action item body text is redacted entirely from EM-facing views (simplest to implement and verify), (b) body text is shown in full (accept the attribution risk, document the decision), or (c) body text requires a specific structural filter at the serialization layer (define the filter). A policy of "to be reviewed" is not an implementation specification.

---

### T-3: Retroactive full historical access grant creates a larger-than-stated data exposure on account compromise

**Location:** design.md — Decision 6: "Upon successful TEAM-006 call, the EM is granted read access to the full session history of the associated team. This access is not date-bounded to the association date."

**Finding:**

Decision 6 is a product decision and I am not contesting it on product grounds. I am flagging the security implication so it is explicit in the threat model: a compromised EM account exposes the complete historical session archive of every team the EM is associated with, not only recent sessions. For a team that has been running Health Checks for three years, that is the full three-year session history.

This is not a reason to change the decision. It is a reason to ensure the controls around EM account authentication are commensurately strong. The threat model for this change must state explicitly: "A compromised EM account grants access to the complete historical session archive of all associated teams. The controls that prevent this are [OIDC token validation, session revocation, EM account monitoring]."

**Required action:**

The threat model (once it is produced — see T-4) must include this scenario explicitly. There is no code change implied here, but the teams responsible for OIDC integration review and ongoing access monitoring need to understand this exposure.

---

### T-4: A threat model document for this change does not exist

**Location:** design.md generally; design does not reference or produce a threat model

**Finding:**

The design makes reference to threat model considerations (session participation enforcement, dual authorization checks, access control liabilities) but no threat model document exists for this change. The design is not a threat model. A threat model names specific threat actors, attack paths, and corresponding controls. Without it, I cannot confirm that the right controls have been selected — I can only note findings from reading the design.

My original engagement with this project included a commitment to a formal threat modeling session before production deployment. The changes introduced here — a new role type, a new access grant mechanism, a new high-sensitivity API endpoint, and retroactive historical data access — warrant that session. The fact that it was not scheduled before the design review means I am reviewing a design without a shared threat model, and my findings are based on pattern recognition rather than systematic analysis.

**Required action:**

Schedule the threat modeling session before Phase 2 begins. The threat model must cover: TEAM-006 as an access escalation vector, EM account compromise, `global_role` elevation mechanism abuse (for whichever option is selected in Q1), and the data sensitivity of historical session archives under the retroactive access model. This is not optional — it is a commitment from the initial engagement.

---

### T-5: Dual authorization check consolidation recommendation may weaken defense-in-depth

**Location:** design.md — Impact section, Authorization bullet: "The two authorization bullets in step 2 of that use case resolve to the same row and should be simplified before implementation to prevent duplicate authorization checks."

**Finding:**

The design recommends simplifying a dual authorization check — "Is the user an Engineering Manager (global_role)?" AND "Is the user the EM associated with this team (team_memberships.role)?" — on the grounds that both checks resolve to the same `team_memberships` row.

This reasoning is correct in the steady state but misses the failure mode. The `global_role` check and the `team_memberships.role` check are independent controls that can diverge if the system is in an inconsistent state — for example, if a user's `global_role` is updated out-of-band while their `team_memberships` row is not, or if a future change allows `global_role = 'engineering_manager'` to be set without going through TEAM-006. The design's own migration plan and risks section notes that "the session-participation spec's dual enforcement...must not be weakened if the TEAM-006 precondition changes" — and then recommends consolidating the checks.

Consolidating these checks creates a single point of failure. If the one check is wrong or bypassable, there is no backstop. I understand the motivation (avoid confusing duplicates in code), but the solution is clear code documentation explaining why both checks exist, not removing one.

**Required action:**

Remove the recommendation to simplify the dual authorization check. Both checks should be retained and implemented independently. Code comments should explain that the `global_role` check is a global role guard and the `team_memberships.role` check is a team-scoped association guard — they serve different purposes even when they produce the same result in the common case.

---

## Implicit Security Decisions That Must Be Made Explicit

The following items are not stated as open questions in the design but represent security decisions that will be made implicitly during implementation unless they are stated explicitly in the spec. I am flagging them so the implementation team does not resolve them informally.

**I-1: Rate limiting on TEAM-006**
The design does not address rate limiting on the TEAM-006 endpoint. An Application Admin account that is compromised and used to make bulk TEAM-006 calls would grant historical data access across many teams rapidly. Rate limiting on this endpoint is a compensating control. The spec should state whether rate limiting applies and at what threshold.

**I-2: CORS configuration for EM-facing endpoints**
The design enables EM access at six existing endpoints and creates new EM-facing views. The CORS configuration for these endpoints is not addressed. If the application's CORS policy allows cross-origin requests from overly permissive origins, the EM data access model is bypassable from a malicious origin. This must be verified as part of Phase 3, not assumed to be covered by existing configuration.

**I-3: Error response information exposure in TEAM-006 error codes**
Decision 4 specifies that the 409 response body must include a machine-readable error code distinguishing the `global_role` precondition failure. This is correct. However, the design should also specify that error responses must not leak existence information beyond what is authorized. A 404 for "team not found" should be indistinguishable from a 404 for "team found but you are not authorized to know it exists" when the caller is not an Application Admin. The current error code design does not address this; depending on the team visibility model, this may need to be examined.

**I-4: Session token and EM access at WebSocket endpoints**
The design does not address whether EM-authenticated users can connect to WebSocket endpoints used for live session data. The non-goal is clear ("Any EM access to live session data (current votes, readiness grid, who is connected)"), but the enforcement of that non-goal at the WebSocket layer is not mentioned. If the WebSocket endpoint uses the same authorization model as the HTTP endpoints, the `team_memberships.role` check will exclude EMs from live sessions correctly. If the WebSocket endpoint is separately managed or has a looser authorization check, an EM could potentially connect. This must be verified before Phase 3.

**I-5: `ownerDisplayName` in action items creates a participant identity linkage for EMs**
The Q8 resolution in the proposal makes `ownerDisplayName` visible to EMs. The design's attribution boundary prohibits EM access to individual vote values. However, an EM who knows that a specific engineer (identified by name in an action item) was assigned an action item following a session where a particular topic scored poorly has a meaningful inference path toward individual vote attribution — specifically in small teams where the action item assignment pattern correlates with the vote outcome. This is not a hard boundary violation because it depends on inference rather than direct data exposure, but it should be named in the threat model as a known inference risk that the organization has accepted. Right now it is not named anywhere.

---

## Open Questions Requiring My Input (from the design)

**Q1 (global_role mechanism):** My position is Option A (IdP claim mapping) with the explicit validation requirements from B-3 above incorporated into the first-access spec. Option B (bootstrap endpoint) is viable with the requirements from B-2. Option C (seed migration) is not scalable and I will not approve it as a production mechanism. The choice between A and B should be made with the solution architect. My recommendation is A.

**Q2 (authorized actor for TEAM-006):** The proposal resolves this as Application Admin. I agree with that resolution. It is the correct decision. My input was solicited; this is it.

---

## What I Will Verify Before Production

Consistent with my pre-production review commitment, I will verify the following before any team goes live with EM history access:

1. The `global_role` mechanism chosen in Q1 has been implemented, tested end-to-end, and the token validation requirements (B-3) are satisfied in the implementation.
2. TEAM-006 writes the audit record in the same database transaction as the `team_memberships` row. I will test the failure path: a simulated transaction rollback must not produce an audit record without a corresponding `team_memberships` row.
3. The EM-facing views at SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 do not return individual vote attributions. I will test this directly using an EM-role account against actual session data — not against fixture data.
4. The session participation enforcement (dual `global_role` + `team_memberships.role` check) correctly excludes EM accounts from live session access. I will attempt to access live session endpoints with an EM-role account.
5. An interim administrative procedure for EM/team relationship removal exists in writing before the deployment gate is cleared.
6. Action item body text handling is resolved per T-2 — no "to be reviewed" placeholder in the spec.

---

*This review is based on the design.md and proposal.md documents as of the review date. Findings should be addressed by updating the relevant specification documents. Re-review will be conducted if any finding in the Blocking section produces a new design decision that was not present in this version.*
