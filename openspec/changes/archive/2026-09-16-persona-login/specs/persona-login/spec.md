## ADDED Requirements

### Requirement: Dev-login-options endpoint
The application SHALL expose `GET /auth/dev-login-options`, gated by two independently-evaluated checks: `isPrivateAddress(config.OIDC_ISSUER)` AND `config.NODE_ENV !== "production"`. When both checks pass, the endpoint SHALL return the available persona login options, each including a `seeded` boolean field indicating whether the account carries a seeded application role — this field is the single source of truth the frontend uses to decide whether to display the unseeded-role caveat for that option, rather than a frontend-maintained list of account ids. When either check fails, the endpoint SHALL return `404` with no response body, and SHALL NOT perform any Redis or database access on that code path.

The endpoint SHALL be reachable without an authenticated session — it is exempt from the application's session-authentication requirement — since its purpose is to inform an unauthenticated user's sign-in choice. Its own double gate, not session state, determines whether it does anything when reached.

#### Scenario: Both gates pass
- **WHEN** `GET /auth/dev-login-options` is called with `NODE_ENV` not set to `production` and `OIDC_ISSUER` pointing to a private/local address
- **THEN** the endpoint returns the available persona login options

#### Scenario: Production mode blocks the endpoint regardless of issuer
- **WHEN** `GET /auth/dev-login-options` is called with `NODE_ENV=production`
- **THEN** the endpoint returns `404` with no body and performs no Redis or database access, even if `OIDC_ISSUER` happens to resolve to a private address

#### Scenario: Non-private issuer blocks the endpoint regardless of NODE_ENV
- **WHEN** `GET /auth/dev-login-options` is called with `OIDC_ISSUER` resolving to a public address
- **THEN** the endpoint returns `404` with no body and performs no Redis or database access, even if `NODE_ENV` is not `production`

#### Scenario: Endpoint is reachable without a session
- **WHEN** `GET /auth/dev-login-options` is called with no session cookie present
- **THEN** the request is not rejected by session-authentication middleware; the double gate alone determines the response

### Requirement: Login hint passthrough
`GET /auth/login` SHALL accept an optional `loginHint` query parameter and, when present, SHALL forward it as the standard OIDC `login_hint` authorization request parameter. This SHALL be the only change to the login-initiation path; state generation, nonce, PKCE code verifier generation, and Redis storage of state data SHALL be unaffected by the presence or absence of `loginHint`.

When `loginHint` is present, the application SHALL validate it against the closed set of seeded account ids (`participant-001`, `facilitator-001`, `manager-001`, `admin-001`) before any state, nonce, or PKCE material is generated, and SHALL return `400` with a structured error body for any value outside that set.

The `auth.authorization_initiated` audit event emitted by `GET /auth/login` SHALL include a `hasLoginHint` boolean field reflecting whether `loginHint` was present on the request, mirroring the existing `hasJoinContext` boolean field on the same event. No event distinct from `auth.authorization_initiated` SHALL be emitted on account of `loginHint`'s presence.

#### Scenario: Login hint forwarded to authorization URL
- **WHEN** `GET /auth/login?loginHint=manager-001` is called
- **THEN** the resulting redirect to the IdP's authorization endpoint includes `login_hint=manager-001`

#### Scenario: Login without hint behaves exactly as before
- **WHEN** `GET /auth/login` is called with no `loginHint` parameter
- **THEN** the resulting redirect to the IdP's authorization endpoint omits the `login_hint` parameter and all other behavior (state, nonce, PKCE, Redis storage) is unchanged

#### Scenario: Unknown login hint is rejected
- **WHEN** `GET /auth/login?loginHint=<value not in the seeded account id set>` is called
- **THEN** the endpoint returns `400` with a structured error body, and no state, nonce, or PKCE material is generated

#### Scenario: Authorization-initiated audit event reflects hint presence
- **WHEN** `GET /auth/login` is called, with or without `loginHint`
- **THEN** the resulting `auth.authorization_initiated` audit event includes `hasLoginHint` set to `true` or `false` accordingly

### Requirement: Persona login landing page
The frontend SHALL check `GET /auth/dev-login-options` before its existing unauthenticated-redirect logic, bounded by a 300ms client-side timeout. A timeout SHALL be treated identically to a `404` response. When the check succeeds, the frontend SHALL display a persona login landing page instead of immediately redirecting to `/auth/login`. The landing page SHALL consist of: a full-width banner, visually distinct from the application's product styling, indicating the page is a local-development-only tool; one button per available persona option labeled with the role name and account id, except the option whose `seeded` field is `false`, which SHALL be labeled with the account id alone and display an inline caveat stating that the role is not seeded; a one-line note stating that each button starts a normal sign-in and that concurrent multi-persona testing requires separate browser profiles or incognito windows; and a plain-text link to `/auth/login` with no `loginHint`, for manual sign-in. The landing page SHALL NOT include application navigation or styling shared with any authenticated screen.

#### Scenario: Dev-login-options check succeeds within timeout
- **WHEN** an unauthenticated user loads the application and `GET /auth/dev-login-options` returns options within 300ms
- **THEN** the persona login landing page is displayed instead of an immediate redirect to `/auth/login`

#### Scenario: Dev-login-options check fails or times out
- **WHEN** an unauthenticated user loads the application and `GET /auth/dev-login-options` returns `404`, or does not resolve within 300ms
- **THEN** the frontend proceeds directly to the existing redirect to `/auth/login`, with no persona login landing page displayed

#### Scenario: Persona button initiates sign-in with hint
- **WHEN** a user clicks a persona button on the landing page
- **THEN** the frontend navigates to `/auth/login` with `loginHint` set to that persona's account id

#### Scenario: Manual sign-in link bypasses persona selection
- **WHEN** a user clicks the "Sign in manually" link on the landing page
- **THEN** the frontend navigates to `/auth/login` with no `loginHint` parameter

#### Scenario: Multi-persona note is visible on the landing page
- **WHEN** the persona login landing page is displayed
- **THEN** a one-line note is visible stating that each button starts a normal sign-in and that concurrent multi-persona testing requires separate browser profiles or incognito windows

### Requirement: Consistent gating between sign-in and sign-out
The frontend SHALL determine the post-logout redirect destination (persona login landing page vs. the standard sign-in path) using the same `/auth/dev-login-options` check used for the initial unauthenticated-redirect decision, rather than a separately-maintained determination of whether the dev shortcut is active.

#### Scenario: Logout redirects to persona landing page when dev shortcut is active
- **WHEN** an authenticated user signs out and `/auth/dev-login-options` indicates the dev shortcut is active
- **THEN** the post-logout redirect lands on the persona login landing page

#### Scenario: Logout redirects to standard sign-in when dev shortcut is inactive
- **WHEN** an authenticated user signs out and `/auth/dev-login-options` indicates the dev shortcut is inactive (404 or timeout)
- **THEN** the post-logout redirect follows the existing sign-in path with no persona login landing page displayed

### Requirement: Persona login preserves the standard authentication flow
Selecting a persona on the landing page SHALL result in the full Authorization Code flow with PKCE being executed, including state/nonce generation, the atomic single-use state check, ID token claim validation, and session regeneration, identically to a manually-typed sign-in. No audit event distinct from a standard sign-in SHALL be emitted for a persona-initiated login.

#### Scenario: Persona login produces standard audit events
- **WHEN** a user completes sign-in via a persona button
- **THEN** the same audit events (`auth.callback_received`, `auth.session_created`, `auth.success`, and `auth.first_access_created` or `auth.role_claim_mapped` where applicable) are emitted as for a manually-typed login, with no additional or distinct event indicating a persona-shortcut origin
