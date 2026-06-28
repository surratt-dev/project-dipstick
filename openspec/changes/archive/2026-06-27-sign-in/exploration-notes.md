# Sign In — Exploration Notes

**Change:** sign-in
**Perspective:** Devon Calloway, Internal Champion
**Date:** 2025-06-25
**Updated:** 2026-06-25 (incorporating facilitator and BA review feedback)
**Status:** Exploration

---

## What Sign-In Is Actually For

Sign-in is not a feature. It is the front door. The entire point is that it should be forgettable — a thing that happened before the thing that matters. The thing that matters is the ritual: engineers in a room (virtual or physical), voting honestly, with a facilitator they do not report to, about how the work actually feels.

### What "Forgettable" Means (Testable)

- The application MUST NOT display any interstitial page between the initial navigation and the IdP redirect.
- The application MUST NOT display any interstitial page between receiving the IdP assertion and landing the user on their destination page.
- The number of application-controlled screens in the sign-in flow is zero. The only screens a user sees are the IdP's own authentication screens (which are outside application control) and the destination page.

The design intent is: you click the link, you end up in the session. The identity provider handles who you are. The application handles what you can do. The user handles none of it.

---

## The Ritual Constraints That Touch Authentication

### 1. The No-Manager-Participation Rule

Authentication itself does not enforce the no-manager rule — and it must not try to. Sign-in is role-agnostic. An Engineering Manager signs in the same way an Engineer does. The same OIDC flow, the same session cookie, the same landing page structure.

The constraint kicks in later, at session join time, not at authentication time. But here is the risk: if the sign-in flow becomes role-aware too early — if there is any visible branching at login based on whether you are an EM or an Engineer — it signals to users that the application is sorting them. That is exactly the wrong signal. The Health Check works because everyone walks through the same door. The application decides what you can do after you are inside, not at the threshold.

**Design principle:** Sign-in must be role-blind. Role resolution happens silently, server-side, after the identity assertion is accepted. The user's first conscious experience of their role should be what they see on their landing page, not anything in the authentication flow itself.

### 2. The Facilitator-From-Another-Team Requirement

This does not touch sign-in directly, but it creates an interesting First Access implication. A facilitator is, by definition, someone from a different team. When a facilitator signs in for the first time, they land in the same "no team" state as anyone else. That is correct — the application should not assume what team someone belongs to based on identity provider claims.

But the facilitator's first-access experience has different stakes. An engineer with no team is waiting to be invited. A facilitator with no team also needs to be invited to their own team (so they can be a participant there), but their primary job is to facilitate for other teams. The application cannot know, at first access, whether this person will be an engineer, a facilitator, or both. And it should not ask. Role assignment is a separate act, done by someone else (a facilitator or admin), after the person exists in the system.

**Design principle:** First Access creates an identity. It does not create a role. It does not ask the user what they are. It tells them what they can do next (which, at this point, is: follow a team join link or wait for one).

### 3. The Simultaneous Reveal (Indirect)

The simultaneous reveal does not interact with sign-in directly. But session management does, and session management is downstream of sign-in. If the session cookie expires during a live session — during voting, specifically — the engineer loses their connection. If they have to re-authenticate to get back in, they might miss the reveal. That is a ritual failure, not a technical failure.

The 90-minute session lifetime requirement exists precisely because of this. The architecture already specifies sliding window token refresh to keep sessions alive for the full duration. But from Devon's perspective, the critical thing is: no engineer should ever be kicked out of a live session because of an authentication timeout. If that happens even once during a real session, it will damage trust in the tool. Engineers will start worrying about whether the app is going to interrupt them, and that worry is a distraction from the ritual.

**Design principle:** Authentication must be invisible during a live session. The session lifetime must exceed the longest plausible Health Check session (90 minutes) with margin. Token refresh must be silent. If re-authentication is ever required mid-session, it is a bug, not a feature.

---

## First Access: The Cold Start Problem

First Access is where adoption lives or dies. Devon has spent years explaining the Health Check to teams in person. The application is supposed to replace that. Which means the first thing a new user sees after authenticating for the first time must do the work Devon has been doing manually.

### What the Use Case Specifies

- Identity assertion arrives, no matching account found, account is created automatically.
- New account has no team memberships, no roles.
- User is presented with a state indicating no team associations and surfaced available next steps.

### What the No-Team Landing Page Must Do (Acceptance Criteria)

- [ ] The no-team landing page displays a clear explanation that the user has no team and that this is the expected state for new users.
- [ ] The page presents exactly one next action: follow a join link provided by a facilitator.
- [ ] The page MUST NOT display application navigation, empty session lists, empty trend dashboards, or any feature surface that requires team membership.
- [ ] The page communicates: (a) the user is authenticated, (b) they have no team membership, (c) how to join a team via a join link, (d) that no further setup is required.

The danger here is over-engineering the first-access experience. If the application presents a dashboard with empty states, navigation to features the user cannot use yet, and a general sense of "you are in a system and you do not know what any of it does" — that is a failure. Devon has watched engineers bounce off tools that make them feel stupid on first contact. The Health Check is a simple ritual. The first-access state should feel simple too.

**Design principle:** The no-team state should feel like a waiting room, not an empty dashboard. Minimal UI. Clear language. One obvious next action.

---

## The Join Link as Authentication Preamble

There is a flow that the use cases describe but that deserves explicit attention from Devon's perspective: the unauthenticated user who follows a join link.

The sequence is:
1. Facilitator shares a join link out-of-band (Slack, email, verbally).
2. Engineer clicks the link.
3. Engineer is not authenticated. Application redirects to the identity provider.
4. Engineer authenticates.
5. Application creates an account (First Access) or matches an existing one.
6. Application completes the join flow — adds the engineer to the team.
7. Engineer lands on the team view.

This is the golden path for adoption. This is the flow that replaces Devon walking up to someone's desk and saying "here, let me show you how this works."

### Testable Requirements for the Join Link Flow

- [ ] A user who follows a join link while unauthenticated completes authentication and lands on the team view in a single uninterrupted flow, with no manual steps between authentication and team membership.
- [ ] The join link destination survives the IdP redirect. (Mechanism is an implementation concern — the OIDC `state` parameter is the cleanest approach — but the behavior is testable.)
- [ ] When an authenticated user follows a join link for a team they are already a member of, the application displays a transient notification ("You are already a member of this team") and redirects to the team view. The notification does not require user action to dismiss.

**Design principle:** The join link is the most important URL in the application. It must survive authentication redirects, first-access account creation, and any intermediate state. The engineer who clicks a join link must end up on the team, not in limbo.

### Session-Aware Join Links

If a session is already active when someone completes the join-link-through-auth flow, the destination should be the active session, not the team dashboard. A join link shared in the context of an upcoming or active session should land the user in that session after team membership is established.

This matters because facilitators distribute join links right before sessions. If a participant completes the join flow and lands on a team page with no indication that a session is happening, they have to find the session themselves. That wastes the few minutes the facilitator has to get everyone assembled.

- [ ] If an active session exists for the team at the time a join link flow completes, the user is directed to the active session after team membership is established.
- [ ] If no active session exists, the user lands on the team view.

### In-Transit Experience

The redirect chain for a first-time user following a join link involves multiple page transitions: click link, redirect to IdP, authenticate (potentially including MFA), redirect back to application, account creation, join flow, destination page. On a corporate Entra instance with MFA, this could take 30-60 seconds for a first-timer versus 5 seconds for a returning user.

During the application-controlled portions of this redirect chain (before the IdP redirect and after the IdP callback), the user must not see a blank page.

- [ ] During any application-controlled redirect or processing step, the user sees the application's branding and a clear indication that sign-in is in progress.
- [ ] The in-transit state does not display a blank page, a raw loading spinner, or an unbranded page at any point under the application's control.
- [ ] The redirect chain for a first-time user completing join-link-through-auth is documented with the expected number of page transitions and approximate timing for both first-time and returning users.

### Batch Arrival

When a facilitator sends a join link to a team Slack channel, six people click it within 30 seconds. The application must handle concurrent OIDC redirect flows gracefully.

- [ ] The application's authentication callback handler supports concurrent requests without serialization that would cause visible delays.
- [ ] Concurrent First Access account creations from the same join link complete independently without blocking each other.
- [ ] The system handles at least 10 concurrent join-link-through-auth flows without degraded response times for individual users.

---

## Facilitator Pre-Session Readiness

The facilitator's own sign-in is a prerequisite for the session happening at all. Before participants arrive, the facilitator needs to be signed in, on the session setup screen, with join links generated and distributed.

If the facilitator's sign-in is slow or fails while participants are waiting in a video call, the session starts with friction the facilitator caused. The sign-in flow is not only a participant concern — it is a facilitator-readiness concern.

- [ ] The facilitator can complete sign-in and reach the session setup screen without any additional steps beyond standard IdP authentication.
- [ ] The application does not impose any facilitator-specific interstitial, confirmation, or setup step between sign-in and the session management view.

### Facilitator Visibility Into Arrival Status

During the pre-session window, the facilitator needs a signal — not personal error details, not authentication logs — just a sense of whether people are getting in. If five of six expected participants have joined and one has not, the facilitator needs to know whether to keep waiting or ask in the room "is anyone having trouble?"

- [ ] The facilitator's session view displays a count of participants who have joined the session.
- [ ] The count updates in near-real-time as participants complete the join flow.

This is noted as a session management concern more than a sign-in concern, but it is downstream of sign-in and affects how the facilitator experiences the sign-in flow's reliability.

---

## What Could Go Wrong

### 1. Sign-In Becomes a Barrier to Adoption

If the identity provider is misconfigured, slow, or requires steps the engineer does not expect (MFA enrollment they have not done, a consent screen they do not understand), the sign-in flow becomes a wall. Devon cannot control the identity provider, but the application should be clear about what is happening when authentication fails.

### Authentication Error States

The application must display distinct user-facing error messages for the following cases:

| Error State | User-Facing Message (Intent) | Next Action |
|---|---|---|
| Identity provider unreachable/timeout | "We could not reach the company login system. Try again in a few minutes." | Retry, contact IT if persistent |
| Identity provider returned an error | "The company login system could not complete your sign-in. Try again, or contact your IT team if this continues." | Retry, contact IT |
| User cancelled authentication | Return to sign-in page silently | User can retry when ready |

Content standard for all error messages:
- [ ] Error messages MUST use plain language and MUST NOT include protocol names, error codes, or technical identifiers.
- [ ] Error messages MUST suggest a next action (retry, contact IT, contact facilitator).
- [ ] Error messages MUST distinguish between errors the user can resolve (retry) and errors that require IT support.
- [ ] All authentication failures are logged with sufficient detail for operator diagnosis, including error type, timestamp, and any error codes returned by the identity provider.

### 2. Role Assignment Leaks Into Authentication

If anyone — a developer, a designer, a product person — ever proposes that the sign-in flow should ask users what role they are, or should present different experiences based on role before the user has a team, Devon will oppose it. The roles (Engineer, Facilitator, Engineering Manager) are not self-selected. They are assigned by facilitators or admins after the user joins a team. If the application asks "are you an engineer or a manager?" at sign-in, it has fundamentally misunderstood the access model.

### 3. Session Management Interferes With Live Sessions

If token expiry or session expiry causes a disruption during a live Health Check session, the trust damage is disproportionate to the technical severity. Engineers will remember "the app kicked me out during the session" long after the bug is fixed.

**Network drops vs. token expiry:** If a participant's laptop loses connectivity briefly and reconnects, the application should restore the session without re-authentication if the session cookie is still valid. The participant should land back in the session at the correct state (current voting round, current topic). This is a session management concern but is noted here because the authentication layer must not interfere with reconnection.

### 4. The "No Team" State Feels Like an Error

If the first thing a new user sees after signing in is an empty dashboard with zero sessions, zero trends, zero action items — a screen designed for a user who has a team and has run sessions — that communicates "something is wrong" even if the application is working correctly. The no-team state needs its own design, not an empty version of someone else's design.

### 5. Join Link Integrity Across the Auth Redirect

If the join link target is stored in a query parameter that the identity provider strips, or in session state that does not exist yet because the user has not authenticated, the link breaks. This is a known failure mode in OIDC redirect flows and it must be tested explicitly. Not "we think it works." Tested: click join link, go through auth, land on the team.

---

## Explicit Positions on Implicit Assumptions

### Single Identity Provider

The application supports exactly one configured identity provider (currently Entra). Multi-IdP support is not a requirement for the initial release. If multi-IdP becomes a future requirement, it should be handled as a separate change. The data model should use the IdP's subject claim as the primary identifier (not email), which would make future multi-IdP support possible without account migration, but that data model flexibility is not an invitation to build multi-IdP plumbing now.

### Account Matching Attribute

The identity attribute used to match returning users to existing accounts MUST be the IdP's subject claim (`sub`), not email. Email addresses change (name changes, domain migrations). The subject claim is stable by specification. If the subject claim is used, an employee whose email changes retains their account, their team memberships, and their session history. If email is used, they become a new user.

This is not an implementation concern — it is a requirement. Facilitators manage team rosters. If a team member's email changes and they appear as a new person, the facilitator has to re-invite them and the team loses continuity. That is a workflow failure.

- [ ] The application matches identity assertions to existing accounts using the IdP's subject claim (`sub`), not email address.
- [ ] If the subject claim in an identity assertion matches an existing account, the account is used regardless of changes to other attributes (email, display name).

### No Offline or Degraded-Mode Access

The application is a web application with no offline requirement. If the identity provider is unreachable, users cannot sign in. There is no cached session fallback, no offline mode, no degraded access. This is the correct posture for a tool that runs during scheduled team rituals — if the IdP is down during a session, the session has bigger problems than this application.

### Join Link Expiry

Join links should have a defined expiry. A join link that never expires is a persistent access vector — anyone who finds it can use it to join the team, indefinitely. But the expiry window must be generous enough that a facilitator can generate links in advance of a session without them expiring before participants use them.

- [ ] Join links expire after a defined period. The recommended default is 7 days.
- [ ] Expired join links display a clear message: "This link has expired. Ask your facilitator for a new one."
- [ ] Facilitators can regenerate join links at any time.

---

## Sign-Out Confirmation Scope

The existing use case specifies that a facilitator signing out during an active session receives a confirmation prompt. Devon's position: this should extend to all participants, not just facilitators.

If an engineer signs out during an active session — especially during voting — they leave a gap in the results. The other participants and the facilitator will notice. This is not about blocking someone from leaving; it is about making sure they leave deliberately, not accidentally.

- [ ] Any authenticated user who is a participant in an active session (session state: in progress) and initiates sign-out receives a confirmation prompt: "You are in an active session. Signing out will remove you from the session. Continue?"
- [ ] The confirmation does not block sign-out; it requires a single explicit confirmation action.
- [ ] "Active session" means a session in the "in progress" state. Scheduled sessions that have not started do not trigger the confirmation.

---

## Open Questions

1. **Session lifetime vs. token lifetime: has the 90-minute requirement been reconciled with the identity provider's actual token lifetime?** The architecture specifies sliding window refresh using `offline_access` scope. Has anyone confirmed that the organization's Entra configuration grants `offline_access`? If the identity provider does not issue refresh tokens, the entire session continuity strategy falls apart. **This must be validated before implementation begins, not discovered during it.**

2. **What is the actual redirect chain for the join-link-through-auth flow?** The number of page transitions a first-time user sees should be documented. Every redirect is a moment where someone might think it is broken. Map it: click join link, application redirect to IdP, IdP login page, MFA prompt (if applicable), IdP redirect to callback, application processing, destination page. Count the transitions. Time them.

3. **Multiple tabs or devices.** An engineer might have the session open on their laptop and open the join link again on their phone. Can they be signed in on two devices? If so, do both show the session? If one votes, does the other reflect it? The application should prevent duplicate voting from the same account — sign-in is where that constraint starts. **Deferred to session management scope, but noted here as a dependency.**

4. **Who does the user contact when sign-in fails?** Error messages should direct users appropriately: IdP failures should say "contact your IT team," application failures should say "contact your facilitator" or provide an application-specific support path. The user should not have to figure out whose problem it is.

---

## Devon's Position

The sign-in flow is architecturally straightforward — delegate to OIDC, create an account if needed, redirect to the right place. The technical risk is low. The adoption risk is high.

The risk is not that sign-in will be technically broken. The risk is that it will be technically correct but experientially hostile: too many steps, unclear error messages, a first-access state that makes people feel lost, a join link that breaks across the auth redirect. These are the things that make an engineer close the tab and say "I will look at this later" — and "later" never comes.

Devon has watched the Health Check spread through this organization one conversation at a time. The application is supposed to replace those conversations. Sign-in is the first moment of that replacement. If it goes wrong, there is no second chance to make the first impression.

The implementation team should treat the join-link-through-authentication flow as the primary adoption path and test it obsessively. Everything else in sign-in is standard OIDC plumbing. The join link flow is where the ritual meets the tool for the first time.

---

## Reviewer Feedback Disposition

### Facilitator Review (Priya Nair)

| # | Feedback | Disposition | Notes |
|---|---|---|---|
| 1 | Facilitator pre-session readiness not addressed | **Incorporated** | Added "Facilitator Pre-Session Readiness" section with acceptance criteria. |
| 2 | Batch arrival not discussed | **Incorporated** | Added "Batch Arrival" subsection under join link flow with concurrency requirements. |
| 3 | Facilitator needs visibility into join failures/arrivals | **Incorporated** | Added "Facilitator Visibility Into Arrival Status" with acceptance criteria. Scoped to participant count, not error details — the facilitator needs a headcount, not a debug log. |
| 4 | First-time user cold start timing gap (30-60s vs 5s) | **Incorporated** | Addressed in "In-Transit Experience" section. The timing gap is real but not within application control — what IS within control is what the user sees during application-controlled portions of the redirect. |
| 5 | In-transit experience (what users see during redirects) | **Incorporated** | Added "In-Transit Experience" subsection with acceptance criteria for branding and loading state. |
| 6 | Session-aware join links (land in session, not team page) | **Incorporated** | Added "Session-Aware Join Links" subsection. This is a high-value addition — landing on the team page when a session is active wastes facilitator time. |
| 7 | Re-joining after network drop during live session | **Incorporated** | Added to "Session Management Interferes With Live Sessions" risk. Noted as session management concern with authentication dependency. |
| 8 | Multiple tabs/devices and duplicate voting | **Deferred** | Added as open question. This is primarily a session management concern, not a sign-in concern. Sign-in should not prevent concurrent authenticated sessions — the session management layer should prevent duplicate voting. |
| 9 | Facilitator visibility into who failed vs. who has not attempted | **Deferred** | The facilitator gets a count of who has joined. Distinguishing "has not attempted" from "attempted and failed" would require the application to track incomplete OIDC flows, which is not feasible without intrusive monitoring. The facilitator can ask in the room. |
| 10 | Error messages should direct users to facilitator vs. IT depending on failure type | **Incorporated** | Added as open question 4 and referenced in error messaging table. |

### BA Review (Marcus Delgado)

| # | Feedback | Disposition | Notes |
|---|---|---|---|
| 1 | No-team landing page needs acceptance criteria, not just preferences | **Incorporated** | Replaced narrative description with testable acceptance criteria in "What the No-Team Landing Page Must Do." |
| 2 | "Already a member" notification needs specified interaction pattern | **Incorporated** | Added acceptance criterion: transient notification, no user action required to dismiss. |
| 3 | Error messaging needs enumerated error states | **Incorporated** | Added error state table with distinct messages and next actions. Added content standard as acceptance criteria. |
| 4 | Sign-out confirmation: decision needed on scope expansion to all participants | **Incorporated** | Added "Sign-Out Confirmation Scope" section. Devon supports extending to all participants. It protects the ritual without blocking anyone. |
| 5 | Validate 90-minute session lifetime against IdP token config | **Incorporated** | Retained as open question 1 with explicit note that this must be validated before implementation, not during it. |
| 6 | State single-IdP or multi-IdP constraint explicitly | **Incorporated** | Added to "Explicit Positions on Implicit Assumptions" — single IdP for initial release, subject claim as identifier to preserve future flexibility. |
| 7 | Decide account matching attribute (email vs. subject claim) | **Incorporated** | Added to explicit positions. Position: subject claim, not email. Rationale: email changes break accounts; subject claim is stable by spec. This is a requirement, not an implementation concern. |
| 8 | Decide join link expiry policy | **Incorporated** | Added to explicit positions. Position: 7-day default expiry with clear messaging and facilitator regeneration. |
| 9 | Replace "human," "seamless," "forgettable" with testable criteria | **Incorporated** | "Forgettable" replaced with zero-interstitial constraint. "Seamless" replaced with single-uninterrupted-flow criterion. "Human" replaced with content standard (plain language, no protocol names, suggest next action). Original terms retained as design intent language but no longer carry requirements weight on their own. |
| 10 | "Waiting room" page — specify what interactive elements exist | **Incorporated** | Acceptance criteria specify one next action (follow join link) and explicitly exclude navigation and feature surfaces. Specific interactive elements (text field vs. static page) deferred to design — the requirement is the constraint on what must and must not appear, not the specific implementation. |
| 11 | Open question triage (Q3 already answered in use cases) | **Incorporated** | Removed Q3 from open questions. The "already a member" behavior is now an acceptance criterion, not an open question. |
| 12 | No offline or degraded-mode access — state explicitly | **Incorporated** | Added to explicit positions. No offline mode, no cached sessions, no degraded access. |
