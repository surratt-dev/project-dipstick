## MODIFIED Requirements

### Requirement: OIDC authentication redirect
The application SHALL redirect unauthenticated requests to any protected route to the configured OIDC identity provider's authorization endpoint. The redirect SHALL use the authorization code flow with PKCE. The application SHALL NOT display any interstitial page between the user's navigation and the IdP redirect.

The sole exception is the local-development persona login landing page defined by the `persona-login` capability. It SHALL only be displayed when `GET /auth/dev-login-options` succeeds under its double gate (`isPrivateAddress(config.OIDC_ISSUER)` AND `NODE_ENV !== "production"`) — a gate that cannot pass in a production deployment. This exception exists because the landing page replaces manual entry of a local-dev-only test account id on an unauthenticated IdP form; it does not change what proves identity, since the full Authorization Code + PKCE exchange with the IdP still runs afterward regardless of which account was selected. It is scoped narrowly to this one local-dev capability and SHALL NOT be read as precedent for adding further interstitials to this requirement; any future exception to "no interstitial before the IdP redirect" needs its own explicit justification here, not an appeal to this one.

#### Scenario: Unauthenticated user navigates to protected route
- **WHEN** a user without an active session navigates to any application route
- **THEN** the application redirects the user to the OIDC identity provider's authorization endpoint with `response_type=code`, a PKCE code challenge (`S256` method), and the `offline_access` scope

#### Scenario: No interstitial before IdP redirect in production
- **WHEN** a user without an active session navigates to the application and `NODE_ENV=production`
- **THEN** zero application-controlled screens are displayed before the IdP redirect occurs

#### Scenario: Persona login landing page is the sole permitted interstitial
- **WHEN** a user without an active session navigates to the application and `GET /auth/dev-login-options` succeeds
- **THEN** the persona login landing page may be displayed before the IdP redirect; no other application-controlled screen is displayed before the IdP redirect
