## MODIFIED Requirements

### Requirement: OIDC callback and token validation
The application SHALL accept the authorization code at the registered callback endpoint (`GET /auth/callback`), exchange it for ID and access tokens, and validate the ID token. Validation SHALL include signature verification via the IdP's JWKS endpoint, expiry (`exp`), audience (`aud`), issuer (`iss`), and nonce claims. Signature verification SHALL be enabled explicitly in the OIDC client configuration, because the OIDC library does not verify a token-endpoint ID token's signature by default. It SHALL apply in every environment, and no configuration setting SHALL turn it off. Keys SHALL be taken from the `jwks_uri` advertised in the IdP's discovery document. No claim from the ID token, the role claim included, SHALL be read before the signature has been verified. The application SHALL reject tokens that fail any validation check. The OIDC state parameter SHALL be single-use: retrieved from Redis and immediately deleted on callback. The callback URL reconstructed for the token exchange SHALL preserve a non-default port present on the incoming request, so that the token exchange's `redirect_uri` matches the `redirect_uri` registered at the authorization step.

#### Scenario: Valid authorization code exchange
- **WHEN** the IdP redirects to the callback endpoint with a valid authorization code
- **THEN** the application exchanges the code for tokens using the stored PKCE code verifier, validates the ID token, and creates an authenticated session

#### Scenario: Token signature validation failure
- **WHEN** the IdP returns an ID token whose JWS signature does not verify against any key in the IdP's JWKS (signed by a different key, or a disallowed algorithm such as `none`)
- **THEN** the application rejects the token and does not create a session
- **AND** no claim from that token is read: `resolveOrCreateAccount` is not called, and no `users` row and no `audit_log` row is written or updated
- **AND** the error is categorized as `authentication_failed` (`auth-error-handling`), and `auth.failure` is emitted with `failureCategory: authentication_failed`

#### Scenario: A role claim altered after signing is rejected
- **WHEN** the IdP's correctly signed ID token is altered after signing so that its role claim reads `application_admin`
- **THEN** the signature check fails, and the outcome is the same as "Token signature validation failure": no session is created and `users.global_role` is not changed

#### Scenario: JWKS endpoint unreachable
- **WHEN** the application cannot reach the IdP's JWKS endpoint (a network error) while validating an ID token at the callback
- **THEN** the application does not create a session, and the error is categorized as `provider_unavailable`

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
