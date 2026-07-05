## Why

The Engineering Health Check application has a runnable scaffold but no way for anyone to get into it. Every feature in the system -- live voting, trend dashboards, action item tracking -- sits behind an authentication wall that does not yet exist. Until sign-in works, the application is a closed door.

But this is not just about wiring up OIDC plumbing. Sign-in is the first moment the application replaces Devon walking up to someone's desk. The join-link-through-authentication flow is the primary adoption path: a facilitator shares a link, an engineer clicks it, and they land in the team -- authenticated, enrolled, and ready -- without anyone explaining anything. If that flow is broken, slow, or confusing, engineers close the tab. There is no second chance at a first impression.

## What Changes

- Implement the full OIDC authentication flow: redirect to identity provider, callback handling, token validation (signature, expiry, audience, issuer), and application session creation via signed HttpOnly cookies
- Implement First Access: automatic account creation from identity assertions using the IdP's subject claim (`sub`) as the stable identifier -- not email
- Implement the no-team landing page: a minimal waiting-room state that tells the user they are authenticated, have no team, and need a join link from a facilitator -- no empty dashboards, no feature chrome
- Implement join link generation (with 7-day default expiry), validation, and the join-link-through-authentication flow that preserves the join destination across the OIDC redirect via the `state` parameter
- Implement session-aware join links: if an active session (a session in the "in progress" state -- scheduled sessions that have not started do not qualify) exists for the team when the join flow completes, land the user in the session, not on the team page
- Implement sign-out with session invalidation, cookie clearing, and confirmation prompts for any participant in an active session (not just facilitators). The facilitator-signs-out-mid-session scenario -- specifically, what happens to a live session that loses its facilitator -- is deferred to session management scope. This change handles the confirmation prompt; session continuity without a facilitator is a session management concern. Dependency noted.
- Implement session expiry with sliding-window token refresh using `offline_access` scope to maintain sessions for up to 90 minutes without re-authentication. The sliding-window refresh strategy is intended to make mid-use expiry impossible, satisfying the "no loss of unsaved data" criterion by prevention rather than warning. If a participant's session is continuously active, the token refreshes silently and expiry never occurs during use. Advance expiry notification is not in scope for this change.
- Implement authentication error handling with plain-language error messages that distinguish between IdP-unreachable, IdP-error, and user-cancelled states
- Implement the in-transit loading state: branded, non-blank pages during application-controlled portions of the redirect chain. Note: if the in-transit loading state threatens the implementation timeline, it is the first deferral candidate. A brief blank screen during a redirect is not what kills adoption -- a broken join flow is.
- Wire the simulated OIDC provider (`node-oidc-provider`) for local development, enforcing the same token validation as production

## Capabilities

### New Capabilities

#### `oidc-auth`
OIDC authentication flow (redirect, callback, token validation, session cookie management), sign-out, session expiry, and token refresh strategy.

**Acceptance Criteria:**
- [ ] The application MUST NOT display any interstitial page between the initial navigation and the IdP redirect.
- [ ] The application MUST NOT display any interstitial page between receiving the IdP assertion and landing the user on their destination page.
- [ ] The number of application-controlled screens in the sign-in flow is zero. The only screens a user sees are the IdP's own authentication screens (which are outside application control) and the destination page.
- [ ] Any authenticated user who is a participant in an active session (session state: in progress) and initiates sign-out receives a confirmation prompt: "You are in an active session. Signing out will remove you from the session. Continue?"
- [ ] The confirmation does not block sign-out; it requires a single explicit confirmation action.
- [ ] "Active session" means a session in the "in progress" state. Scheduled sessions that have not started do not trigger the confirmation.
- [ ] The facilitator can complete sign-in and reach the session setup screen without any additional steps beyond standard IdP authentication.
- [ ] The application does not impose any facilitator-specific interstitial, confirmation, or setup step between sign-in and the session management view.

#### `first-access`
Automatic account creation on first authentication, subject-claim-based identity matching, and the no-team landing page.

**Acceptance Criteria:**
- [ ] The application matches identity assertions to existing accounts using the IdP's subject claim (`sub`), not email address.
- [ ] If the subject claim in an identity assertion matches an existing account, the account is used regardless of changes to other attributes (email, display name).
- [ ] The no-team landing page displays a clear explanation that the user has no team and that this is the expected state for new users.
- [ ] The page presents exactly one next action: follow a join link provided by a facilitator.
- [ ] The page MUST NOT display application navigation, empty session lists, empty trend dashboards, or any feature surface that requires team membership.
- [ ] The page communicates: (a) the user is authenticated, (b) they have no team membership, (c) how to join a team via a join link, (d) that no further setup is required.

#### `join-link`
Join link generation with expiry, validation, join-link-through-auth flow with destination preservation, session-aware landing, default role assignment, already-a-member handling, and batch arrival handling.

**Acceptance Criteria:**
- [ ] A user who follows a join link while unauthenticated completes authentication and lands on the team view in a single uninterrupted flow, with no manual steps between authentication and team membership.
- [ ] The join link destination survives the IdP redirect.
- [ ] When an authenticated user follows a join link for a team they are already a member of, the application displays a transient notification ("You are already a member of this team") and redirects to the team view. The notification does not require user action to dismiss.
- [ ] The user is added to the team with the default role of Engineer.
- [ ] If an active session (session state: in progress) exists for the team at the time a join link flow completes, the user is directed to the active session after team membership is established. Scheduled sessions that have not started do not trigger session-aware redirection.
- [ ] If no active session exists, the user lands on the team view.
- [ ] Join links expire after a defined period. The recommended default is 7 days.
- [ ] Expired join links display a clear message: "This link has expired. Ask your facilitator for a new one."
- [ ] Facilitators can regenerate join links at any time.
- [ ] The application's authentication callback handler supports concurrent requests without degraded response times for individual users.
- [ ] Concurrent First Access account creations from the same join link complete independently without blocking each other.
- [ ] The system handles at least 10 concurrent join-link-through-auth flows without degraded response times for individual users.

#### `auth-error-handling`
Authentication error states, plain-language error messages, in-transit loading states, and sign-out confirmation for active session participants.

**Acceptance Criteria:**
- [ ] Error messages MUST use plain language and MUST NOT include protocol names, error codes, or technical identifiers.
- [ ] Error messages MUST suggest a next action (retry, contact IT, contact facilitator).
- [ ] Error messages MUST distinguish between errors the user can resolve (retry) and errors that require IT support.
- [ ] All authentication failures are logged with sufficient detail for operator diagnosis, including error type, timestamp, and any error codes returned by the identity provider.
- [ ] During any application-controlled redirect or processing step, the user sees the application's branding and a clear indication that sign-in is in progress.
- [ ] The in-transit state does not display a blank page, a raw loading spinner, or an unbranded page at any point under the application's control.
- [ ] The redirect chain for a first-time user completing join-link-through-auth is documented with the expected number of page transitions and approximate timing for both first-time and returning users.

### Modified Capabilities

- `project-structure`: Backend gains auth middleware, session management plugins, and new route modules; frontend gains auth context provider and protected route wrapper; shared package gains auth-related types (AuthSession, JoinLink, AuthError)

## Impact

- New database tables: none required beyond the existing `users` and `teams` schema -- First Access writes to `users`, join links require a new `join_links` table (team reference, token, expiry, created_by)
- New backend routes: `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /auth/session`, `POST /api/teams/:teamId/join-links`, `POST /api/join/:token`
- New backend middleware: session validation on all protected routes, OIDC client configuration
- Redis usage: session storage for authenticated sessions (cookie-to-session mapping)
- Frontend: auth context provider wrapping the app, redirect-to-login on 401, no-team landing page component, join link handling on route entry
- Dependencies: OIDC client library (e.g., `openid-client`), `@fastify/cookie`, `@fastify/session` or equivalent session plugin
- Docker: simulated OIDC provider configuration updated with test accounts matching the authentication flows
- Concurrency: callback handler and First Access account creation must handle batch arrival (10+ concurrent join-link-through-auth flows) without degraded response times for individual users. The 10-concurrent threshold can be validated initially with a smaller number and hardened to the full target in a subsequent pass.
- **OIDC provider deployment dependency:** The first real deployment -- putting this in front of the initial rollout teams -- requires a real OIDC provider (Entra) configured and registered. The simulated provider covers local development and CI, but the identity team or infrastructure team must have a provider configured before the application can be deployed to a real environment. If that is not ready when the application is ready, deployment is blocked. This dependency should be tracked and communicated early.
- **Pre-implementation gate:** The `offline_access` scope must be validated against the organization's Entra configuration before implementation begins. If the identity provider does not issue refresh tokens, the entire sliding-window session continuity strategy is invalid. This is not a discovery to make during implementation.

---

## Reviewer Feedback Disposition

### BA Review (Marcus Delgado) — Approve with required revisions

| # | Finding | Disposition | How Addressed |
|---|---|---|---|
| 1 | Proposal does not carry forward acceptance criteria from exploration | **Incorporated** | Each capability now includes its acceptance criteria inline, drawn from the exploration notes. The implementation team builds from this document, not from cross-referencing exploration notes. |
| 2 | "Already a member" behavior specified in exploration but not in proposal | **Incorporated** | Added to `join-link` capability acceptance criteria: transient notification, redirect to team view, no user action required to dismiss. |
| 3 | Facilitator-signs-out-mid-session scenario not addressed | **Deferred with dependency noted** | The sign-out confirmation prompt is in scope for all participants. The question of what happens to a live session that loses its facilitator is deferred to session management scope. Dependency noted in the sign-out bullet under "What Changes." |
| 4 | Session expiry "no loss of unsaved data" criterion not addressed | **Satisfied by prevention** | Added note that the sliding-window refresh strategy makes mid-use expiry impossible, satisfying the criterion by prevention rather than warning. Advance expiry notification is not in scope. |
| 5 | "Without serialization" is an implementation constraint, not a testable behavior | **Incorporated** | Replaced "without serialization" with "without degraded response times for individual users" in both the Impact section and `join-link` acceptance criteria. |
| 6 | "Active session" lacks condition specificity | **Incorporated** | Clarified throughout that "active session" means a session in the "in progress" state. Scheduled sessions that have not started do not qualify. Applied to both session-aware join links and sign-out confirmation. |
| 7 | Default role assignment on join not mentioned | **Incorporated** | Added to `join-link` acceptance criteria: "The user is added to the team with the default role of Engineer." |
| 8 | `offline_access` scope validation needs a gate | **Incorporated** | Added as a named pre-implementation gate in the Impact section. Must be validated before implementation begins. |

### Executive Review (Rachel Okonkwo) — Approved with observations

| # | Observation | Disposition | How Addressed |
|---|---|---|---|
| 1 | OIDC provider deployment dependency not addressed | **Incorporated** | Added to Impact section: real Entra configuration is a deployment prerequisite. The simulated provider covers dev and CI but not real deployment. Dependency on identity/infrastructure team noted with recommendation to track and communicate early. |
| 2 | Batch arrival concurrency threshold — validate smaller first, harden later | **Acknowledged** | Added note in Impact section that the 10-concurrent threshold can be validated initially with a smaller number and hardened to the full target in a subsequent pass. |
| 3 | In-transit loading state is the first deferral candidate if timeline is tight | **Acknowledged** | Added note in "What Changes" under the in-transit bullet identifying it as the first deferral candidate. A blank screen during a redirect is not what kills adoption -- a broken join flow is. |
| 4 | Confirm what must be built next after this change ships | **Noted** | This is a sequencing question for the team, not a proposal revision. The answer is live voting -- that is the next capability required before a real team can use the application. |
