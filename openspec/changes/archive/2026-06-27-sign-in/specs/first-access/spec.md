# first-access

## Purpose

Defines requirements for automatic account creation on first authentication, subject-claim-based identity matching, and the no-team landing page experience.

## ADDED Requirements

### Requirement: Automatic account creation on first authentication
The application SHALL automatically create a new user account when a valid identity assertion is received and no existing account matches the IdP's subject claim (`sub`). The new account SHALL have no team memberships and no assigned roles. Account creation SHALL NOT require manual provisioning or administrator action.

#### Scenario: First-time user authenticated
- **WHEN** a valid ID token is received with a `sub` claim that does not match any existing user's `idp_subject_id`
- **THEN** a new user record is created with the `sub` claim as `idp_subject_id`, display name and email from token claims, and no team memberships

#### Scenario: Returning user authenticated
- **WHEN** a valid ID token is received with a `sub` claim that matches an existing user's `idp_subject_id`
- **THEN** no new account is created; the existing account is used; display name and email are updated from the token claims

#### Scenario: Account creation failure
- **WHEN** a system error prevents account creation during First Access
- **THEN** no session is established, the user receives a generic error message, and the error is logged with sufficient detail for operator diagnosis

### Requirement: Subject claim as identity matching attribute
The application SHALL match identity assertions to existing accounts using the IdP's subject claim (`sub`), not email address. If the subject claim matches an existing account, that account SHALL be used regardless of changes to other attributes (email, display name).

#### Scenario: Email change does not create new account
- **WHEN** a returning user authenticates with the same `sub` claim but a different email address
- **THEN** the existing account is used and the email is updated to reflect the new value

#### Scenario: Subject claim is the unique identifier
- **WHEN** two identity assertions arrive with the same email but different `sub` claims
- **THEN** two separate accounts are created, one for each `sub` claim

### Requirement: Concurrent First Access handling
The application SHALL handle concurrent First Access account creations without serialization. When multiple users authenticate simultaneously (e.g., batch arrival from a join link), each account creation SHALL complete independently without blocking others.

#### Scenario: Batch first-time authentication
- **WHEN** 10 users authenticate for the first time within 30 seconds
- **THEN** all 10 accounts are created independently without visible delays for individual users

#### Scenario: Duplicate subject claim race condition
- **WHEN** two concurrent callbacks arrive for the same user (same `sub` claim)
- **THEN** one insert succeeds and the other performs an upsert; both callbacks result in a valid session for the same user account

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
