# first-access

## Purpose

Defines requirements for automatic account creation on first authentication, OIDC subject/issuer-based identity matching, the no-team landing page experience, and missing claims rejection.

## Requirements

### Requirement: Automatic account creation on first authentication
The application SHALL automatically create a new user account when a valid identity assertion is received and no existing account matches the IdP's subject claim (`sub`) and issuer (`iss`). The new account SHALL have no team memberships and no assigned roles. Account creation SHALL NOT require manual provisioning or administrator action. The implementation uses an upsert (`INSERT ... ON CONFLICT DO UPDATE`) keyed on the compound unique constraint `(oidc_subject, oidc_issuer)`. Whether the account is newly created (`isNewUser`) is determined by a SELECT query executed before the upsert; see Known Limitations for the documented race constraint on this flag under concurrent load.

#### Scenario: First-time user authenticated
- **WHEN** a valid ID token is received with `sub` and `iss` claims that do not match any existing user's `oidc_subject` and `oidc_issuer`
- **THEN** a new user record is created with `oidc_subject` set to the `sub` claim, `oidc_issuer` set to the `iss` claim, `display_name` from the `name` claim (falling back to `email`, then `sub`), `email` from the `email` claim (falling back to `{sub}@unknown`), and no team memberships

#### Scenario: Returning user authenticated
- **WHEN** a valid ID token is received with `sub` and `iss` claims that match an existing user's `oidc_subject` and `oidc_issuer`
- **THEN** no new account is created; the existing account is used; `display_name` and `email` are updated from the token claims

#### Scenario: Account creation failure
- **WHEN** a system error prevents account creation during First Access
- **THEN** no session is established, the user receives a generic error message, and the error is logged with sufficient detail for operator diagnosis

---

### Requirement: Subject claim as identity matching attribute
The application SHALL match identity assertions to existing accounts using the compound key of the IdP's subject claim (`sub`) and issuer (`iss`), stored as `oidc_subject` and `oidc_issuer` in the `users` table. Email address is stored and updated on each authentication but SHALL NOT be used for identity matching — it must not appear in any WHERE clause, JOIN condition, or ON CONFLICT clause used for account resolution. The compound `(oidc_subject, oidc_issuer)` key is the only match path. If the compound key matches an existing account, that account SHALL be used regardless of changes to other attributes (email, display name).

#### Scenario: Email change does not create new account
- **WHEN** a returning user authenticates with the same `sub`/`iss` but a different email address
- **THEN** the existing account is used and the email is updated to reflect the new value

#### Scenario: Subject claim is the unique identifier
- **WHEN** two identity assertions arrive with the same email but different `sub` claims
- **THEN** two separate accounts are created, one for each `sub` claim

---

### Requirement: Concurrent First Access handling
The application SHALL handle concurrent First Access account creations without serialization. The upsert pattern (`ON CONFLICT DO UPDATE`) ensures that duplicate `sub`/`iss` arrivals result in one account record with an update, not an error. Concurrency is handled at the database level: when two callbacks arrive simultaneously for the same new user, exactly one INSERT succeeds and the other performs an update; both return the correct user record. The `isNewUser` flag is derived via a SELECT executed before the upsert; see Known Limitations for the documented race on this flag under concurrent load.

#### Scenario: Batch first-time authentication
- **WHEN** 10 users authenticate for the first time within 30 seconds
- **THEN** all 10 accounts are created independently without visible delays for individual users

#### Scenario: Duplicate subject claim race condition
- **WHEN** two concurrent callbacks arrive for the same user (same `sub`/`iss`)
- **THEN** one insert succeeds and the other performs an upsert update; both callbacks result in a valid session for the same user account

---

### Requirement: No-team landing page
A user with no active team memberships SHALL be presented with a dedicated landing page at `/no-team`. The routing decision — whether to direct a user to `/no-team` or to a team view — is made server-side in the authentication callback, against live team membership data. The client SHALL NOT determine this routing via a separate API call after receiving an initial redirect to `/`.

The no-team condition is evaluated at every sign-in, not only on first access. A previously active user from whom all team memberships have been removed will be routed to `/no-team` on their next sign-in, with the same content as a first-time user.

The no-team page SHALL present the following elements and nothing else:

1. The authenticated user's display name
2. A statement that the user is not yet a member of any team
3. An instruction to request a join link from a facilitator
4. A brief reassurance that no further setup is required from the user
5. A sign-out affordance

Element 4 exists to reduce first-time user anxiety — it is a passive statement, not an action or an affordance. It does not expose any feature surface and does not conflict with the "single action" constraint (sign-out remains the only interactive element).

The page SHALL NOT be rendered inside any layout wrapper that contributes navigation elements (no application navigation bar, no sidebar, no header navigation links, no feature menus — not even empty, collapsed, or disabled versions of them). The sign-out affordance is the only interactive element. This constraint is enforced at the routing layer, not only at the component level, and is locked by a regression test at `src/pages/__tests__/App.test.tsx`. A user navigating directly to `/no-team` after having joined a team SHALL be redirected to their team view (bookmark guard).

#### Scenario: New user sees no-team page
- **WHEN** a user with no team memberships completes authentication
- **THEN** the server-side redirect in the authentication callback routes to `/no-team`, not to `/`; the page renders the user's display name, a statement of no team membership, an instruction to request a join link, a reassurance that no further setup is required, and a sign-out affordance

#### Scenario: No feature chrome on no-team page
- **WHEN** the no-team landing page is displayed
- **THEN** no application navigation menu, no empty session list, no empty trend dashboard, and no feature-specific UI elements are rendered; the page DOM contains no element contributed by a shared layout component; `document.querySelector("nav")` returns null and no element with role `navigation` is present

#### Scenario: User with team bypasses no-team page
- **WHEN** a user with one or more team memberships completes authentication
- **THEN** the server-side redirect in the authentication callback routes to `/team/:teamId`, not to `/no-team`

#### Scenario: Returning user with all memberships removed sees no-team page
- **WHEN** a user whose team memberships have been removed since their last session completes authentication
- **THEN** the server-side routing queries live membership data and directs the user to `/no-team`

#### Scenario: User with team navigates directly to no-team page
- **WHEN** a user with active team memberships navigates directly to `/no-team` (e.g., via bookmark)
- **THEN** the bookmark guard in `NoTeamPage` reads the current session's `teamMemberships` and redirects to `/team/:teamId`

---

### Requirement: Missing claims rejection
If the OIDC identity assertion is missing the `sub` claim, contains an empty `sub` value, is missing the `iss` claim, or contains an empty `iss` value, the application SHALL reject the authentication attempt. This validation occurs before `resolveOrCreateAccount` is called. On rejection: no account record is created, no session is established, the user receives a generic sign-in error, and a structured failure log entry is emitted naming the missing or empty claim (e.g., `missingClaim: "sub"`) without including the values of any claims or any other identity attributes from the token. The implementation uses a typed `MissingClaimError` class that carries the claim name (never the claim value), enabling structured audit logging that identifies the failure without risk of PII exposure.

#### Scenario: Missing sub claim
- **WHEN** the ID token claims object is null, or `claims.sub` is absent or is an empty string
- **THEN** a `MissingClaimError("sub")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "sub"` and no claim values

#### Scenario: Missing iss claim
- **WHEN** `claims.iss` is absent or is an empty string
- **THEN** a `MissingClaimError("iss")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "iss"` and no claim values

---

## Security Properties

**Session fixation prevention:** On successful authentication, session fixation is prevented by calling `session.regenerate()` alone. The previous destroy-then-regenerate pattern is not used: `session.destroy()` called with an always-resolve callback swallows Redis errors silently, leaving the old session live in the store while a new one is also created. `regenerate()` alone atomically invalidates the old session ID and creates a fresh one with no error-swallowing risk.

**Audit event shape — first_access_created:** The `auth.first_access_created` event includes `userId`, `oidcSubject`, `oidcIssuer`, `sourceIp` (from `request.ip`), and `correlationId`. It does not include `displayName`, `email`, `name`, or any other PII. This event is emitted only when `user.isNewUser` is true. The event shape is consistent with all other security-relevant audit events in the system.

**Audit log level independence:** The `auditLogger` child logger has its level pinned to `"info"` independently of the application-wide log level. This ensures audit events are not silently suppressed if the application log level is raised to `warn` or `error` in production.

---

## Known Limitations

**isNewUser SELECT-before-upsert race (hard constraint on future work):** The `isNewUser` flag in `resolveOrCreateAccount` is determined by a SELECT query executed before the upsert. Two concurrent authentication callbacks for the same new user may both read zero existing rows and both set `isNewUser = true`. The upsert handles data correctly at the database level (exactly one account is created), but any downstream consumer of `isNewUser` may fire twice. This is a hard constraint on future work: before any feature that consumes `isNewUser` is merged, the SELECT-before-upsert pattern must be replaced with a pattern that derives `isNewUser` from the upsert result (e.g., via `xmax` inspection or an INSERT-returning flag column), or the consuming feature must be designed to treat duplicate firings as idempotent. The current only consumer (`auth.first_access_created` audit event) is safe: a duplicate event is detectable by its correlation ID and produces no incorrect side effect.

---

## Open Issues

The following GitHub issues were opened as known follow-on items at the close of this change and remain active:

- **#2** — [Security] Audit OIDC library error messages for potential token content leakage in logs
- **#3** — [Security] Audit logger level fix does not cover transport-level log filtering
- **#4** — [Audit] auth.success and auth.session_created events missing sourceIp and correlationId
- **#5** — [Audit] executeJoinFlow hardcodes "callback" as sourceIp in join rejection audit events
- **#6** — [Test] No assertion that session.destroy is not called after session fixation fix
- **#7** — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null
- **#8** — [Architecture] isNewUser SELECT-before-upsert race: hard constraint on future features
