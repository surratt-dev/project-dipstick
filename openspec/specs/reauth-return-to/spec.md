# reauth-return-to

## Purpose

Carries the originating session/page URL through the OIDC `state` round-trip so that the `reauth-required` CTA's login flow returns the user to the page they were on, instead of a generic team page. Generalizes the destination-preservation pattern `join-link` already established for join tokens to the re-authentication case, provider-agnostically — the mechanism lives entirely in this application's own login/callback routes and is never derived from or written to an IdP-specific claim, token, or field, so it behaves identically across every supported OIDC identity provider.

This spec covers: `GET /auth/login`'s acceptance and storage of an optional `returnTo` query parameter; the allow-list that validates a supplied `returnTo` value against known internal path shapes before it is trusted; `GET /auth/callback`'s retrieval and use of a stored `returnTo` value, and its precedence relative to a pending join-link redirect; and the requirement that resolving a `returnTo` redirect never grants, infers, or bypasses any authorization the destination route would not independently enforce.

This spec does NOT cover: a general-purpose or arbitrary-redirect mechanism (the allow-list is closed to this application's own known route shapes); the `reauth-required` treatment's own rendering or its `returnTo` prop plumbing (see `websocket-staleness-signal`'s "Reauth-required call-to-action" requirement); or any change to which close code triggers `reauth-required` (see `websocket-session-authorization`).

**Implementation status:** Implemented. `packages/backend/src/routes/auth.ts`'s `GET /login` accepts and validates `returnTo` via `validateReturnTo`, storing it in the OIDC state payload in Redis alongside any `pendingJoinToken`. `GET /callback` retrieves it via the existing atomic `redis.getdel` read and redirects there when no `pendingJoinToken` redirect took precedence. The allow-list (`RETURN_TO_ALLOW_LIST`) matches `/session/:id` and `/team/:id`, with `:id` pinned to this application's UUID format and an optional `?`-prefixed query string tolerated. Character-rejection checks (CR/LF, backslash, `://`, leading `//`) run before the allow-list pattern match, on the raw decoded value.

---

## Requirements

### Requirement: Login initiation accepts and preserves a return-to path

`GET /auth/login` SHALL accept an optional `returnTo` query parameter. When present and valid (per the allow-list below), the application SHALL store it in the OIDC `state` payload persisted to Redis for this authentication attempt, alongside any existing `pendingJoinToken`, keyed the same way and subject to the same single-use, atomic-retrieval guarantees the existing OIDC `state` mechanism already provides.

This mechanism SHALL be identical regardless of which OIDC identity provider is configured: the return-to value is this application's own concern, resolved entirely within this app's login/callback routes, and is never read from or written to any IdP-supplied claim, token, or provider-specific field.

#### Scenario: A valid returnTo value is preserved through login initiation

- **WHEN** an unauthenticated user's client requests `GET /auth/login?returnTo=/session/abc123`
- **AND** `/session/abc123` matches the allow-listed path shape below
- **THEN** the application stores `returnTo: "/session/abc123"` in the OIDC state payload written to Redis for this authentication attempt
- **AND** initiates the OIDC redirect exactly as it would without a `returnTo` parameter

#### Scenario: Login initiation without a returnTo value behaves exactly as before

- **WHEN** an unauthenticated user's client requests `GET /auth/login` with no `returnTo` parameter
- **THEN** the OIDC state payload contains no `returnTo` field
- **AND** the login flow proceeds identically to its pre-existing behavior

#### Scenario: The mechanism does not branch on which OIDC provider is configured

- **WHEN** `GET /auth/login?returnTo=<value>` is requested against a deployment configured for any supported OIDC identity provider
- **THEN** the return-to storage and retrieval behavior is identical regardless of provider
- **AND** no provider-specific claim, field, or configuration value is read or written as part of this mechanism

---

### Requirement: Return-to value is allow-listed by known internal path shape

The application SHALL validate a supplied `returnTo` value against an explicit allow-list of known internal route shapes before storing it (`/session/:id`, `/team/:id`, and any other session-context route shape confirmed at implementation time — see design.md's Open Questions). A `returnTo` value that does not match an allow-listed shape SHALL be discarded silently: the login flow proceeds as though no `returnTo` value was supplied, without surfacing an error to the user. The application SHALL NOT accept an arbitrary path, a full URL, a protocol-relative URL, or any value containing a scheme or authority component as a `returnTo` value.

#### Scenario: A non-allow-listed path is discarded silently

- **WHEN** `GET /auth/login?returnTo=/some/unrecognized/path` is requested
- **THEN** the application does not store this value in the OIDC state payload
- **AND** the login flow proceeds exactly as though no `returnTo` parameter had been supplied
- **AND** no error is returned to the caller for this reason alone

#### Scenario: A full URL or protocol-relative value is rejected

- **WHEN** `GET /auth/login?returnTo=` is requested with a value containing `://`, a leading `//`, or an explicit scheme
- **THEN** the application discards the value and proceeds as though no `returnTo` parameter had been supplied

#### Scenario: An allow-listed session path is accepted

- **WHEN** `GET /auth/login?returnTo=/session/abc123` is requested
- **THEN** the value matches the `/session/:id` allow-listed shape and is stored

#### Scenario: An allow-listed team path is accepted

- **WHEN** `GET /auth/login?returnTo=/team/xyz789` is requested
- **THEN** the value matches the `/team/:id` allow-listed shape and is stored

---

### Requirement: Callback redirects to the stored return-to path when present

`GET /auth/callback` SHALL retrieve any stored `returnTo` value from the OIDC state payload using the same atomic `redis.getdel` read already used for the rest of that payload. When a `pendingJoinToken` is also present, the join flow's own redirect target SHALL take precedence and the `returnTo` value SHALL be ignored. When no `pendingJoinToken` is present and a valid `returnTo` value was stored, the callback SHALL redirect the authenticated user there instead of the default `/team/:teamId` (first team) or `/no-team` destination.

#### Scenario: Callback redirects to the stored returnTo path

- **WHEN** an authenticated callback completes, no `pendingJoinToken` was stored for this state, and a `returnTo` value of `/session/abc123` was stored
- **THEN** the application redirects the user to `/session/abc123`
- **AND** does not redirect to `/team/:teamId` or `/no-team`

#### Scenario: A pending join token takes precedence over a stored returnTo value

- **WHEN** an authenticated callback completes and both a `pendingJoinToken` and a `returnTo` value were stored for the same state
- **THEN** the callback redirects to the join flow's own computed redirect target
- **AND** the `returnTo` value is not used

#### Scenario: Callback behaves exactly as before when no returnTo value was stored

- **WHEN** an authenticated callback completes and no `returnTo` value was stored for this state
- **THEN** the callback redirects based on live team membership data (`/team/:teamId` or `/no-team`), exactly as it did before this capability existed

#### Scenario: The stored returnTo value is single-use

- **WHEN** the OIDC state payload containing a `returnTo` value is read during callback processing
- **THEN** the value is retrieved and the underlying state key is deleted in the same atomic operation
- **AND** a replayed callback for the same state cannot reuse the `returnTo` value

---

### Requirement: Return-to preservation does not grant, infer, or bypass any authorization

Resolving a `returnTo` redirect SHALL NOT itself perform, skip, or shortcut any authorization check that would otherwise apply to the destination route. The redirect is a navigation convenience only; the destination page SHALL enforce its own normal authorization on load, exactly as if the user had navigated there directly.

#### Scenario: Redirecting to a returnTo destination does not bypass the destination's own authorization

- **WHEN** a callback redirects a user to a stored `returnTo` value naming a session the user is no longer authorized to access (e.g., their participation ended, or the session was closed, while they were re-authenticating)
- **THEN** the destination route's own normal authorization check runs and denies or restricts access exactly as it would for a direct, unprompted navigation to that same URL
- **AND** the returnTo mechanism itself grants no access the destination would not independently grant
