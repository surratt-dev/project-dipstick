# Sign-In Exploration — BA Review

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-06-25
**Source:** exploration-notes.md (Devon Calloway perspective)
**Status:** Review complete — clarifications required before proposal

---

## Overall Assessment

Devon's exploration captures adoption risk well and correctly identifies the join-link-through-authentication flow as the critical path. The design principles are sound. However, several areas are too vague to build from and several open questions are already answered (or partially answered) in the existing use cases. Below is what needs to be tightened before this moves to a proposal.

---

## 1. Clarifications Needed

### 1.1 "Waiting room" no-team state — what is actually on the screen?

Devon says: "a single screen with a short explanation and a prompt to follow a join link. Not a dashboard."

This is a preference, not a requirement. To build from this, we need:

- **What text is displayed?** Devon lists four things the user should understand. Are those literal copy, or intent for a copywriter? If they are requirements, write them as acceptance criteria: "The no-team landing page MUST communicate: (a) the user is authenticated, (b) they have no team membership, (c) how to join a team via a join link, (d) that no further setup is required."
- **What interactive elements exist?** Is there a text field to paste a join link? Just a static page? A "contact your facilitator" link?
- **What is NOT on this page?** Devon says "not a dashboard, not navigation to features." State this as a constraint: "The no-team state MUST NOT display application navigation, empty dashboards, or feature surfaces that require team membership."

**Suggested rewrite as acceptance criteria:**
- [ ] The no-team landing page displays a clear explanation that the user has no team and that this is the expected state for new users.
- [ ] The page presents exactly one next action: follow a join link provided by a facilitator.
- [ ] The page does not display application navigation, empty session lists, or any feature surface that requires team membership.

### 1.2 "Already a member" message on duplicate join link — transient or blocking?

Devon says: "a brief, clear message — 'You are already a member of this team' — before redirecting."

- How long is "before redirecting"? Is this a toast notification during redirect, an interstitial page with a continue button, or a timed redirect?
- The use case (Join a Team via Invite Link, alternate flow) says "redirects the user to the team view without creating a duplicate record." Devon is adding UX on top of that. This needs to be a concrete requirement with a specified interaction pattern.

**Suggested acceptance criterion:**
- [ ] When an authenticated user follows a join link for a team they are already a member of, the application displays a transient notification ("You are already a member of this team") and redirects to the team view. The notification does not require user action to dismiss.

### 1.3 Error messaging granularity — how many error states?

Devon asks whether the application distinguishes "identity provider unreachable" from "identity provider rejected the user." The use cases define three failure modes:

1. Authentication fails (IdP rejects credentials) — user stays on IdP error page
2. Identity provider unavailable (redirect fails/times out) — application shows error
3. User cancels authentication — user returns to sign-in page

Devon is asking for a fourth distinction within case 2: is the IdP unreachable vs. did the IdP return an error? This is a real gap. But to make it buildable:

- **How many distinct error messages does the application need?** Enumerate them.
- **Who is the audience?** End users need "try again later." Operators need specific error codes in logs.

**Suggested requirement:**
- [ ] The application displays distinct user-facing error messages for: (a) identity provider unreachable/timeout, and (b) identity provider returned an error response. Both messages use plain language and do not expose technical details.
- [ ] All authentication failures are logged with sufficient detail for operator diagnosis, including the error type, timestamp, and any error codes returned by the identity provider.

### 1.4 Sign-out confirmation scope — facilitator only or all participants?

Devon says: "any participant signing out during an active session should see a confirmation."

The existing use case (Sign Out, alternate flow) only specifies this for facilitators. Devon is expanding scope. This needs a decision:

- **Is this a new requirement or a preference?** If it is a requirement, add it as an acceptance criterion to the Sign Out use case.
- **What constitutes "during an active session"?** Is it any session state (scheduled, in progress, voting), or specifically during a live voting round?

**Suggested acceptance criterion (if adopted):**
- [ ] Any authenticated user who is a participant in an active session and initiates sign-out receives a confirmation prompt: "You are in an active session. Signing out will remove you from the session. Continue?"
- [ ] The confirmation does not block sign-out; it requires a single explicit confirmation action.

---

## 2. Vague Areas That Cannot Be Built From

### 2.1 "Human" error messages

Devon says error messaging needs to be "human" and gives an example: "We could not sign you in. This usually means the company login system is having trouble."

This is a tone guideline, not a specification. Either:
- Provide the actual error message copy for each error state (preferred), or
- Define a content standard: "Error messages MUST use plain language, MUST NOT include protocol names or error codes, and MUST suggest a next action."

### 2.2 "Forgettable" sign-in

Devon says sign-in should take "a few seconds of conscious attention." This is aspirational. The application delegates to an external IdP — the sign-in duration is not within the application's control. What IS within control:
- Number of application-side screens before and after IdP redirect (should be zero)
- Whether the application adds any interstitial pages

**Suggested constraint:**
- [ ] The application MUST NOT display any interstitial page between the initial navigation and the IdP redirect.
- [ ] The application MUST NOT display any interstitial page between receiving the IdP assertion and landing the user on their destination page.

### 2.3 "Seamless" join link flow

Devon says the join link flow "must be seamless." That is not testable. What IS testable:

- [ ] A user who follows a join link while unauthenticated completes authentication and lands on the team view in a single uninterrupted flow, with no manual steps between authentication and team membership.
- [ ] The join link destination survives the IdP redirect. (Mechanism is an implementation concern, but the behavior is testable.)

---

## 3. Open Questions — Triage

### Already answered in the requirements:

| Open Question | Status |
|---|---|
| Q3: What happens if someone follows a join link for a team they are already on? | **Answered.** Join a Team use case, alternate flow: "The application recognizes the existing membership and redirects the user to the team view without creating a duplicate record." Devon's addition of a notification message is new scope — handle as 1.2 above. |

### Partially answered — need implementation decisions:

| Open Question | Gap |
|---|---|
| Q2: How does the join link survive the OIDC redirect? | The use case requires the behavior (alternate flow: "preserving the join link destination"). The mechanism is correctly flagged as an implementation concern. Devon's suggestion to use the OIDC `state` parameter is reasonable but is a technical decision, not a requirement. **No requirements gap — this is an engineering decision.** |
| Q6: Does sign-out during a live session need a confirmation for all participants? | Partially answered. The use case covers facilitators. Extending to all participants is new scope. **Decision needed — see 1.4 above.** |

### Genuine gaps — need answers before implementation:

| Open Question | Action Needed |
|---|---|
| Q1: What does the no-team landing page look like? | **Requirements gap.** The use case says "surfaces available next steps" without specifying what those steps are or what the page looks like. See 1.1 above for suggested criteria. |
| Q4: Has the 90-minute session lifetime been reconciled with the IdP's token lifetime? | **Technical validation gap.** The requirement (90-minute session lifetime) is clear. Whether the infrastructure supports it is an implementation concern, but it should be validated before implementation begins, not discovered during it. **Add as a pre-implementation checklist item.** |
| Q5: What is the error experience when the IdP is down? | **Requirements gap.** The use case says "displays an error indicating that sign-in is temporarily unavailable" but does not distinguish between IdP-unreachable and IdP-returned-error. See 1.3 above. |

---

## 4. Implicit Assumptions to Make Explicit

### 4.1 Single identity provider

The exploration assumes a single IdP (Entra). The use cases are written provider-agnostically. If the application will only ever support one IdP, say so — it simplifies error handling, configuration, and testing. If multi-IdP is a future possibility, the data model needs to accommodate it now.

**Needed:** A stated constraint: "The application supports exactly one configured identity provider" or "The application's identity model must support multiple identity providers."

### 4.2 Account matching uses a stable identifier

The First Access use case notes say "the identity attribute used to uniquely identify a user (e.g., email, subject claim) is an implementation concern; it must be stable across sign-ins." Devon's exploration does not address this. If email is the matching key and an employee's email changes, they get a new account. If subject claim is the key, email changes are transparent.

**Needed:** A decision on the matching attribute, documented as a requirement, not left as an implementation concern. This affects whether accounts can survive email changes, which affects facilitator workflows.

### 4.3 No offline or degraded-mode access

The exploration assumes the IdP is always reachable or the user simply cannot sign in. There is no discussion of cached sessions, offline access, or graceful degradation. If the application is web-only with no offline requirement, state that explicitly.

### 4.4 Join links have no expiry defined

The Join a Team use case notes say "the mechanism for join link expiry (if any) is an implementation concern not defined here." Devon does not address this either. If join links never expire, they are a persistent access vector. If they expire, the expiry window needs to be specified.

**Needed:** A decision: do join links expire? If yes, what is the lifetime? If no, what is the revocation mechanism?

---

## 5. Summary of Required Actions Before Proposal

| # | Item | Type |
|---|---|---|
| 1 | Define the no-team landing page content and constraints as acceptance criteria | Requirements gap |
| 2 | Specify the "already a member" notification behavior on duplicate join link | New scope — needs decision |
| 3 | Enumerate distinct authentication error messages | Requirements gap |
| 4 | Decide whether sign-out confirmation extends to all session participants | New scope — needs decision |
| 5 | Validate 90-minute session lifetime against IdP token configuration | Pre-implementation checklist |
| 6 | State single-IdP or multi-IdP constraint explicitly | Implicit assumption |
| 7 | Decide account matching attribute (email vs. subject claim) | Implicit assumption |
| 8 | Decide join link expiry policy | Implicit assumption |
| 9 | Replace "human," "seamless," "forgettable" with testable acceptance criteria | Vague language |
