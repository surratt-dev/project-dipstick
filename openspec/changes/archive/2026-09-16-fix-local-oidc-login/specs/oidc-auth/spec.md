## MODIFIED Requirements

### Requirement: OIDC callback and token validation
The application SHALL accept the authorization code at the registered callback endpoint (`GET /auth/callback`), exchange it for ID and access tokens, and validate the ID token. Validation SHALL include signature verification via the IdP's JWKS endpoint, expiry (`exp`), audience (`aud`), issuer (`iss`), and nonce claims. The application SHALL reject tokens that fail any validation check. The OIDC state parameter SHALL be single-use: retrieved from Redis and immediately deleted on callback. The callback URL reconstructed for the token exchange SHALL preserve a non-default port present on the incoming request, so that the token exchange's `redirect_uri` matches the `redirect_uri` registered at the authorization step.

#### Scenario: Valid authorization code exchange
- **WHEN** the IdP redirects to the callback endpoint with a valid authorization code
- **THEN** the application exchanges the code for tokens using the stored PKCE code verifier, validates the ID token, and creates an authenticated session

#### Scenario: Token signature validation failure
- **WHEN** the IdP returns a token with an invalid signature
- **THEN** the application rejects the token and does not create a session

#### Scenario: Token expiry validation
- **WHEN** the IdP returns an expired token
- **THEN** the application rejects the token and does not create a session

#### Scenario: Audience claim mismatch
- **WHEN** the ID token's `aud` claim does not match the application's registered client ID
- **THEN** the application rejects the token and does not create a session

#### Scenario: State parameter is single-use
- **WHEN** the callback endpoint processes a state parameter
- **THEN** the state is retrieved from Redis and immediately deleted; a replayed callback with the same state is rejected

#### Scenario: Callback URL reconstruction preserves a non-default port
- **WHEN** the callback endpoint reconstructs the callback URL for the token exchange and the incoming request's host carries a non-default port
- **THEN** the reconstructed URL's authority includes that port, so the token exchange's `redirect_uri` matches the `redirect_uri` registered at the authorization step and the IdP accepts the grant
