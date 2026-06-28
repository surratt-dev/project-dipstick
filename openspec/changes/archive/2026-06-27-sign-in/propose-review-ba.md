# Sign-In Proposal Review — Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-06-25
**Verdict:** Approve with required revisions

---

## Summary

The proposal is substantially complete. My exploration feedback was incorporated — all twelve items are addressed, and the disposition table in the exploration notes confirms each one. The positions we established during exploration (single IdP, subject claim, 7-day expiry, sign-out confirmation for all participants) are preserved in the proposal. The capabilities are specific enough to implement against with one significant gap and several areas where language needs tightening.

---

## Exploration Feedback Incorporation: Verified

All twelve items from my exploration review are accounted for:

| # | My Feedback | Status in Proposal |
|---|---|---|
| 1 | No-team page needs acceptance criteria | Present in exploration notes. **Not carried forward into proposal.** See Finding 1. |
| 2 | "Already a member" notification pattern | Present in exploration notes as testable criterion. Referenced implicitly in proposal via join-link capability. |
| 3 | Enumerated error states | Present in exploration notes with table and content standard. Referenced in proposal via `auth-error-handling` capability. |
| 4 | Sign-out confirmation scope | Present in exploration notes. Referenced in proposal ("confirmation prompts for any participant in an active session"). |
| 5 | Validate 90-minute lifetime vs. IdP config | Retained as open question 1 in exploration notes. |
| 6 | Single-IdP constraint | Present in exploration notes under explicit positions. |
| 7 | Account matching via subject claim | Present in proposal ("using the IdP's subject claim (`sub`) as the stable identifier — not email"). |
| 8 | Join link expiry policy | Present in proposal ("7-day default expiry"). |
| 9 | Replace vague language with testable criteria | Present in exploration notes (zero-interstitial, single-uninterrupted-flow). |
| 10 | Specify no-team page interactive elements | Present in exploration notes acceptance criteria. |
| 11 | Open question triage | Resolved — "already a member" moved from open question to acceptance criterion. |
| 12 | No offline/degraded access | Present in exploration notes under explicit positions. |

---

## Findings

### Finding 1: Proposal does not carry forward the acceptance criteria from exploration (REQUIRED)

The exploration notes contain detailed, testable acceptance criteria for the no-team landing page, join link flow, in-transit experience, batch arrival, error messaging, sign-out confirmation, and facilitator readiness. The proposal's "What Changes" section references these behaviors but as a narrative bullet list, not as acceptance criteria.

The proposal is the artifact the implementation team builds from. If the acceptance criteria live only in the exploration notes, the team has to cross-reference two documents and decide for themselves which exploration notes are requirements and which are context.

**Required action:** Each capability in the proposal should include or reference its acceptance criteria explicitly. Either inline them under each capability or add a section that maps capabilities to their acceptance criteria in the exploration notes with explicit cross-references.

### Finding 2: "Already a member" behavior specified in exploration but not in proposal

The exploration notes specify: "When an authenticated user follows a join link for a team they are already a member of, the application displays a transient notification ('You are already a member of this team') and redirects to the team view. The notification does not require user action to dismiss."

The proposal's `join-link` capability says "validation" but does not enumerate what validation covers. The use case (UC: Join a Team via Invite Link, alternate flow) specifies this behavior. The proposal should state it explicitly.

**Required action:** Add the already-a-member behavior to the `join-link` capability description or its acceptance criteria.

### Finding 3: Use case coverage — Sign Out alternate flow gap

The use case for Sign Out specifies an alternate flow: "User is a facilitator mid-session." The proposal expands sign-out confirmation to all participants (which is correct per the exploration position), but the proposal does not address what happens to a live session when its facilitator signs out. The use case notes say: "The behavior of an in-progress session without a facilitator is an implementation concern that should be resolved."

This is not a sign-in scope concern per se, but the proposal's sign-out capability needs to either resolve this or explicitly defer it with a cross-reference.

**Required action:** State whether the facilitator-signs-out-mid-session scenario is in scope for this change or deferred. If deferred, note the dependency.

### Finding 4: Session expiry use case — "no loss of unsaved data" criterion

The Session Expiry use case includes the acceptance criterion: "Session expiry does not result in loss of unsaved data without appropriate warning to the user." The proposal mentions sliding-window refresh and 90-minute lifetime but does not address the warning-before-expiry behavior. The use case's own "Out of Scope" section calls advance-expiry-notification a "desirable enhancement" but not required.

The proposal should acknowledge this criterion and state its disposition (in scope, deferred, or satisfied by the sliding-window design making expiry during active use impossible).

**Required action:** Add a note clarifying that the sliding-window refresh strategy is intended to make mid-use expiry impossible, satisfying this criterion by prevention rather than warning. Or state the warning is deferred.

### Finding 5: Vague language — "batch arrival handling" in Concurrency section

The proposal states: "callback handler and First Access account creation must handle batch arrival (10+ concurrent join-link-through-auth flows) without serialization." The exploration notes specify this as "without degraded response times for individual users."

"Without serialization" is an implementation constraint. "Without degraded response times" is a testable behavior. The proposal should use the testable version.

**Required action:** Replace "without serialization" with "without degraded response times for individual users" or specify both (the behavior requirement and the implementation constraint).

### Finding 6: Vague language — "session-aware join links" lacks condition specificity

The proposal says: "if an active session exists for the team when the join flow completes, land the user in the session, not on the team page." The exploration notes define "active session" in the sign-out confirmation section as "a session in the 'in progress' state. Scheduled sessions that have not started do not trigger the confirmation."

The same definition should apply here. A scheduled session that has not started should not redirect a joining user to a session view.

**Required action:** Clarify that "active session" means a session in the "in progress" state, not a scheduled session.

### Finding 7: Use case coverage — default role assignment on join

The use case for Join a Team via Invite Link specifies: "The application adds the user to the team with the default role of Engineer." The proposal's `join-link` capability does not mention default role assignment. This is in the use case and should be preserved.

**Required action:** Add "user is added to the team with the default role of Engineer" to the join-link capability or its acceptance criteria.

### Finding 8: Open question 1 needs a gate

Open question 1 (validate 90-minute session lifetime against IdP token configuration) is flagged in the exploration notes as "must be validated before implementation begins, not discovered during it." The proposal does not surface this as a prerequisite or gate.

**Required action:** Add the `offline_access` scope validation as a prerequisite in the proposal's Impact section or as a named pre-implementation gate.

---

## Use Case Completeness Check

| Use Case | Covered in Proposal? | Notes |
|---|---|---|
| Sign In | Yes | Main flow and alternate flows addressed. |
| First Access | Yes | Subject claim matching, no-team landing page, auto-creation. |
| Join a Team via Invite Link | Yes | Join-link-through-auth, destination preservation, session-aware landing. Missing: default role, already-a-member behavior. |
| Assign a Role to a Team Member | Out of scope | Correct — not a sign-in concern. |
| Establish a Manager/Team Relationship | Out of scope | Correct — not a sign-in concern. |
| Enforce Access Control on Team Content | Partially | Auth middleware is listed in Impact. Access control enforcement is downstream but the middleware foundation is in scope. |
| Sign Out | Yes | Expanded confirmation scope. Missing: facilitator-mid-session disposition. |
| Session Expiry | Yes | 90-minute lifetime, sliding-window refresh. Missing: expiry-warning disposition. |

---

## Positions Preserved from Exploration

All critical positions are confirmed present in the proposal:

- Single identity provider (Entra): confirmed
- Subject claim (`sub`) as account matching attribute: confirmed, explicitly stated
- 7-day join link expiry default: confirmed
- Sign-out confirmation for all participants (not just facilitators): confirmed
- No offline/degraded access: confirmed in exploration notes, not restated in proposal but consistent
- Role-blind sign-in: confirmed in exploration notes, consistent with proposal
- Zero-interstitial constraint: confirmed in exploration notes, proposal references in-transit loading states

---

## Bottom Line

The proposal captures the right scope and preserves the positions from exploration. The primary gap is structural: the acceptance criteria developed during exploration need to be surfaced in the proposal itself, not left in the exploration notes. The individual findings (2-8) are addressable without rethinking the proposal — they are missing specifics, not missing concepts. Once the acceptance criteria are integrated and the eight findings are addressed, this is ready for implementation planning.
