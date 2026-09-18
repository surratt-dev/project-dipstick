## MODIFIED Requirements

### Requirement: Missing claims rejection
If the OIDC identity assertion is missing the `sub` claim, contains an empty `sub` value, is missing the `iss` claim, or contains an empty `iss` value, the application SHALL reject the authentication attempt. This validation occurs before `resolveOrCreateAccount` is called. On rejection: no account record is created, no session is established, the user receives a generic sign-in error, and a structured failure log entry is emitted naming the missing or empty claim (e.g., `missingClaim: "sub"`) without including the values of any claims or any other identity attributes from the token. The implementation uses a typed `MissingClaimError` class that carries the claim name (never the claim value), enabling structured audit logging that identifies the failure without risk of PII exposure.

#### Scenario: Null claims object
- **WHEN** the ID token claims object is null
- **THEN** a `MissingClaimError("id_token")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "id_token"` and no claim values

#### Scenario: Missing or empty sub claim
- **WHEN** the ID token claims object is non-null and `claims.sub` is absent or is an empty string
- **THEN** a `MissingClaimError("sub")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "sub"` and no claim values

#### Scenario: Missing iss claim
- **WHEN** `claims.iss` is absent or is an empty string
- **THEN** a `MissingClaimError("iss")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "iss"` and no claim values
