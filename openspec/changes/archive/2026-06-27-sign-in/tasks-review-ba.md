# Tasks Review -- Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2025-06-25
**Verdict:** Approve with required revisions

---

## Summary

The tasks are well-structured and cover the majority of the proposal's capabilities. The translation from proposal to tasks is largely faithful. However, there are specific gaps where proposal acceptance criteria or use case requirements have no corresponding task, and a few places where task language is softer or narrower than the requirement it implements.

---

## Coverage Assessment by Requested Focus Area

### No-team landing page
**Status: Covered**
Task 7.3 creates `NoTeamPage.tsx` and explicitly states: no navigation menu, no empty dashboards, no feature chrome. Task 7.4 routes to it when the user has zero team memberships. This matches the proposal's `first-access` acceptance criteria and UC: First Access postconditions.

### Already-a-member notification
**Status: Partially covered -- task language is weaker than proposal**
Task 5.4 includes a test case: "already-a-member shows transient notification." Task 5.3 mentions `ON CONFLICT DO NOTHING` for idempotent membership. However, no task explicitly requires the implementation to *display* the transient notification ("You are already a member of this team") on the frontend. Task 5.3 describes the backend behavior but the frontend rendering of that notification is not tasked. The proposal acceptance criterion states: "the application displays a transient notification... and redirects to the team view. The notification does not require user action to dismiss." A test asserting this behavior exists, but no implementation task produces the UI component.

**Required revision:** Add a frontend task (or extend 7.4/7.5) to implement the transient "already a member" notification display on the team view when a duplicate join is detected.

### Session-aware join links
**Status: Partially covered -- missing specificity**
Task 5.3 states: "checks for active session, redirects to session or team view." This covers the intent. However, the proposal acceptance criterion is precise: "If an active session (session state: in progress) exists for the team at the time a join link flow completes, the user is directed to the active session." The task does not repeat the "in progress" qualifier, which matters because the proposal explicitly excludes scheduled sessions that have not started. The distinction was a BA review finding (item 6) that was incorporated into the proposal specifically to prevent ambiguity.

**Required revision:** Task 5.3 should clarify that "active session" means session state "in progress" and that scheduled-but-not-started sessions do not trigger redirection.

### Sign-out confirmation for all participants
**Status: Covered**
Task 3.4 implements `POST /auth/logout` with 409 + `confirmRequired` for users in an active session. Task 7.6 handles the 409 on the frontend with a confirmation dialog. The proposal is explicit that this applies to *any* participant in an active session, not just facilitators. The task language ("user is in an active session") is role-neutral, which is correct.

Note: The use case (UC: Sign Out) mentions only facilitators in the alternate flow warning. The proposal deliberately broadened this to all participants. The tasks correctly follow the proposal, not the narrower use case language. This is the right call.

### Error message enumeration
**Status: Partially covered**
Task 6.1 maps OIDC error codes to plain-language responses and names three states: IdP unreachable, IdP error, user cancelled. Task 6.2 adds callback-route error handling. Task 6.3 creates the error page with retry button and IT contact guidance. This covers the proposal's `auth-error-handling` acceptance criteria for plain language, suggested next action, and distinguishing user-resolvable vs. IT-resolvable errors.

However, the proposal acceptance criterion states: "All authentication failures are logged with sufficient detail for operator diagnosis, including error type, timestamp, and any error codes returned by the identity provider." No task explicitly requires server-side error logging with these specific fields. Testing and verification tasks (Section 9) do not check for log output.

**Required revision:** Add a task (or extend 6.1/6.2) requiring server-side logging of authentication failures with error type, timestamp, and IdP error codes.

### Default 'participant' role on join
**Status: Covered (with a terminology note)**
Task 5.3 specifies "adds user to team as Engineer." The proposal says "default role of Engineer." The use case says "default role of Engineer." All three are aligned. The user's question asks about "default 'participant' role" -- the application's term for this is "Engineer," not "participant." The tasks are correct.

---

## Proposal Capabilities Without Corresponding Tasks

### 1. Facilitator can regenerate join links at any time
The proposal's `join-link` acceptance criterion states: "Facilitators can regenerate join links at any time." Task 5.2 implements `POST /api/teams/:teamId/join-links` which allows creating new links, but no task addresses revoking an existing link before generating a new one, and no task addresses the UI surface for this action. The backend route supports creation but the proposal implies a regeneration flow (revoke old + create new) as a facilitator action.

**Required revision:** Clarify whether task 5.2 is sufficient for regeneration (i.e., creating a new link implicitly supersedes the old one) or whether an explicit revoke-and-regenerate flow is needed. If the former, add a note. If the latter, add a task.

### 2. Redirect chain documentation
The proposal's `auth-error-handling` acceptance criterion states: "The redirect chain for a first-time user completing join-link-through-auth is documented with the expected number of page transitions and approximate timing for both first-time and returning users." No task produces this documentation artifact.

**Required revision:** Add a task to document the redirect chain with expected page transitions and timing.

### 3. No interstitial screens (zero application-controlled screens)
The proposal's `oidc-auth` acceptance criteria include three related items asserting zero application-controlled interstitial screens between navigation and IdP redirect, and between IdP assertion and destination. Task 6.4 creates `AuthLoadingPage.tsx` -- a "branded loading state shown during application-controlled redirect processing (post-callback token exchange)." These are in tension. The proposal itself acknowledges this tension by listing the in-transit loading state as the first deferral candidate. No verification task checks that the zero-interstitial criteria are met (or explicitly documents which criteria are relaxed by the loading page).

**Observation (not a required revision):** The implementation team should resolve this tension before implementation. If the loading page is built, the "zero application-controlled screens" acceptance criteria from the proposal cannot be literally satisfied. The team should either (a) defer the loading page per the proposal's own guidance and satisfy the criteria, or (b) build the loading page and document that these specific criteria are relaxed. Either way, the decision should be explicit.

### 4. Batch arrival / concurrency validation
The proposal's `join-link` acceptance criteria include: "The application's authentication callback handler supports concurrent requests without degraded response times" and "The system handles at least 10 concurrent join-link-through-auth flows without degraded response times." No task includes a concurrency or load test. The proposal's Impact section notes this can be "validated initially with a smaller number and hardened to the full target in a subsequent pass," but no task validates even the smaller number.

**Observation (not a required revision for this change):** A concurrency validation task should be planned, even if deferred to a subsequent pass per the executive review disposition.

---

## Use Case Requirements Not Addressed in Tasks

### UC: Sign Out -- "advised to close the browser" fallback
The use case states: "If the sign-out request fails (e.g., network error), the session may persist. The user should be advised to close the browser as a fallback." No task addresses this failure-mode UX. Task 7.6 handles the 409 confirmation flow but does not address network failure during sign-out.

**Observation:** Low severity. Worth noting but not blocking.

### UC: Session Expiry -- "no loss of unsaved data without appropriate warning"
The use case acceptance criterion states: "Session expiry does not result in loss of unsaved data without appropriate warning to the user." The proposal addresses this by prevention (sliding-window refresh makes mid-use expiry impossible). This is a valid approach, but no task or verification step confirms that the sliding window actually prevents mid-use expiry under realistic conditions (e.g., a 90-minute session with 1-hour access tokens).

Task 9.7 covers manual verification of silent refresh, which partially addresses this. Acceptable.

---

## Required Revisions Summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | No frontend task for the "already a member" transient notification UI | Medium -- proposal acceptance criterion has no implementation task |
| 2 | Task 5.3 does not qualify "active session" as "in progress" state, excluding scheduled sessions | Medium -- ambiguity that was specifically resolved in proposal review |
| 3 | No task for server-side authentication failure logging with error type, timestamp, and IdP codes | Medium -- proposal acceptance criterion has no implementation task |
| 4 | Join link regeneration flow not clarified -- is create-new sufficient or is revoke-old required? | Low -- needs clarification, may not need a new task |
| 5 | No task to document the redirect chain with page transitions and timing | Low -- proposal acceptance criterion has no implementation task |

---

## Disposition

The tasks demonstrate a solid translation of the proposal into buildable work. The gaps identified are not architectural -- they are places where specific acceptance criteria from the proposal did not make it into a corresponding task. Addressing findings 1-3 before implementation begins will prevent these from surfacing as late discoveries. Findings 4-5 can be addressed during implementation without rework risk.
