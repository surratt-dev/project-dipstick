# auth-error-handling

## Purpose

Defines requirements for authentication error states, plain-language error messages, in-transit loading states during redirects, and authentication event logging.

## ADDED Requirements

### Requirement: Distinct error messages for authentication failure modes
The application SHALL display distinct user-facing error messages for each authentication failure mode. Error messages SHALL use plain language and SHALL NOT include protocol names, error codes, or technical identifiers. Error messages SHALL suggest a next action.

#### Scenario: Identity provider unreachable
- **WHEN** the redirect to the identity provider fails or times out
- **THEN** the application displays: "We could not reach the company login system. Try again in a few minutes." with a retry action

#### Scenario: Identity provider returned an error
- **WHEN** the identity provider returns an error response to the callback endpoint
- **THEN** the application displays: "The company login system could not complete your sign-in. Try again, or contact your IT team if this continues." with retry and IT contact guidance

#### Scenario: User cancelled authentication
- **WHEN** the user abandons the identity provider flow and the IdP redirects back with a cancellation indicator
- **THEN** the application returns the user to the sign-in page silently without an error message

### Requirement: Error messages distinguish user-resolvable from IT-required issues
Error messages SHALL distinguish between errors the user can resolve (retry) and errors that require IT support. IdP failures SHALL direct users to IT. Application failures SHALL direct users to their facilitator or an application-specific support path.

#### Scenario: Retriable error suggests retry
- **WHEN** a transient error occurs during authentication (timeout, temporary unavailability)
- **THEN** the error message suggests retrying as the primary action

#### Scenario: Persistent error suggests IT contact
- **WHEN** the identity provider returns a persistent error (configuration issue, account problem)
- **THEN** the error message suggests contacting the IT team

### Requirement: Authentication failure logging
All authentication failures SHALL be logged with sufficient detail for operator diagnosis, including error type, timestamp, and any error codes returned by the identity provider. Logs SHALL NOT include user credentials or sensitive token values.

#### Scenario: Failed authentication logged
- **WHEN** an authentication attempt fails for any reason
- **THEN** a structured log entry is created with timestamp, error type, any IdP error codes, and (if available) a user identifier, but no credentials or token values

#### Scenario: Successful authentication logged
- **WHEN** a user successfully authenticates
- **THEN** a structured log entry is created with timestamp, user identifier, and authentication event type

### Requirement: In-transit loading state
During application-controlled portions of the redirect chain (before the IdP redirect and after the IdP callback), the user SHALL NOT see a blank page. The application SHALL display its branding and a clear indication that sign-in is in progress.

#### Scenario: Pre-redirect loading state
- **WHEN** the application is processing the initial request before redirecting to the IdP
- **THEN** if the processing takes longer than an imperceptible instant, the user sees the application's branding and a sign-in-in-progress indicator

#### Scenario: Post-callback processing state
- **WHEN** the application is processing the IdP callback (token exchange, account lookup, join flow)
- **THEN** the user sees the application's branding and a sign-in-in-progress indicator, not a blank page

#### Scenario: No unbranded pages in redirect chain
- **WHEN** a first-time user completes the full join-link-through-auth flow
- **THEN** at no point during application-controlled transitions does the user see a blank, unbranded, or raw loading spinner page
