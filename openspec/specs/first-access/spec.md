# first-access

## Purpose

Defines requirements for automatic account creation on first authentication, OIDC subject-claim-based identity matching, and the no-team landing page experience.

## Requirements

### Requirement: Automatic account creation on first authentication
The application SHALL automatically create a new user account when a valid identity assertion is received and no existing account matches the IdP's subject claim (`sub`) and issuer (`iss`). The new account SHALL have no team memberships and no assigned roles. Account creation SHALL NOT require manual provisioning or administrator action. The implementation uses an upsert (`INSERT ... ON CONFLICT DO UPDATE`) keyed on the compound unique constraint `(oidc_subject, oidc_issuer)`.

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
The application SHALL match identity assertions to existing accounts using the compound key of the IdP's subject claim (`sub`) and issuer (`iss`), stored as `oidc_subject` and `oidc_issuer` in the `users` table. Email address SHALL NOT be used for identity matching. If the compound key matches an existing account, that account SHALL be used regardless of changes to other attributes (email, display name).

#### Scenario: Email change does not create new account
- **WHEN** a returning user authenticates with the same `sub`/`iss` but a different email address
- **THEN** the existing account is used and the email is updated to reflect the new value

#### Scenario: Subject claim is the unique identifier
- **WHEN** two identity assertions arrive with the same email but different `sub` claims
- **THEN** two separate accounts are created, one for each `sub` claim

---

### Requirement: Concurrent First Access handling
The application SHALL handle concurrent First Access account creations without serialization. The upsert pattern (`ON CONFLICT DO UPDATE`) ensures that duplicate `sub`/`iss` arrivals result in one account with an update, not an error.

#### Scenario: Batch first-time authentication
- **WHEN** 10 users authenticate for the first time within 30 seconds
- **THEN** all 10 accounts are created independently without visible delays for individual users

#### Scenario: Duplicate subject claim race condition
- **WHEN** two concurrent callbacks arrive for the same user (same `sub`/`iss`)
- **THEN** one insert succeeds and the other performs an upsert update; both callbacks result in a valid session for the same user account

---

### Requirement: No-team landing page
The application SHALL present users with no team memberships a dedicated landing page that communicates: (a) the user is authenticated, (b) they have no team membership, (c) how to join a team via a join link from a facilitator, (d) no further setup is required. The page SHALL present exactly one next action: follow a join link. The page SHALL NOT display application navigation, empty session lists, empty trend dashboards, or any feature surface that requires team membership.

#### Scenario: New user sees no-team page
- **WHEN** a user with no team memberships completes authentication
- **THEN** the user is directed to the no-team landing page with a clear explanation and a single instruction to follow a join link

#### Scenario: No feature chrome on no-team page
- **WHEN** the no-team landing page is displayed
- **THEN** no application navigation menu, no empty session list, no empty trend dashboard, and no feature-specific UI elements are rendered

#### Scenario: User with team bypasses no-team page
- **WHEN** a user with one or more team memberships completes authentication
- **THEN** the user is directed to their default landing page (team view), not the no-team page
