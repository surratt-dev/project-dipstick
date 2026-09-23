## MODIFIED Requirements

### Requirement: Shared auth-related types
The `@dipstick/shared` package SHALL export types related to authentication from `packages/shared/src/types/auth.ts`: `AuthSession` (user identity, team memberships, session metadata, and the `canFacilitateSessions` capability flag), `JoinLink` (join link metadata), `AuthErrorCategory` (union of error categories), and `AuthError` (structured error response for authentication failures).

`AuthSession` SHALL include a top-level `canFacilitateSessions: boolean` field, computed server-side by the `/auth/session` endpoint from `users.global_role === 'facilitator'`, evaluated live on every call to that endpoint — never cached in the session store and never derived on the client. This field follows the same defensive shape established by `role-assignment`'s `canAssignRoles` field: the frontend reacts to a server-computed capability result, it does not compute an authorization decision from a role value. Consistent with the `role-assignment` capability's existing constraint, the raw `users.global_role` value SHALL NOT be added to `AuthSession.user` or anywhere else on `AuthSession` for the purpose of driving frontend authorization or routing logic.

#### Scenario: Backend imports auth types from shared
- **WHEN** the backend TypeScript code imports `AuthSession` or `AuthErrorCategory` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

#### Scenario: Frontend imports auth types from shared
- **WHEN** the frontend TypeScript code imports `AuthError` or `JoinLink` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

#### Scenario: `canFacilitateSessions` is present and accurate for a facilitator
- **WHEN** a user with `users.global_role = 'facilitator'` calls `GET /auth/session`
- **THEN** the response's `canFacilitateSessions` field is `true`

#### Scenario: `canFacilitateSessions` is false for a non-facilitator
- **WHEN** a user whose `users.global_role` is not `facilitator` calls `GET /auth/session`
- **THEN** the response's `canFacilitateSessions` field is `false`

#### Scenario: `canFacilitateSessions` is recomputed on every call, not cached
- **WHEN** a user's `users.global_role` changes between two calls to `GET /auth/session` within the same session lifetime
- **THEN** the second call's `canFacilitateSessions` value reflects the new `global_role`, not the value returned by the first call

#### Scenario: Raw global role is not exposed on `AuthSession`
- **WHEN** the `AuthSession` type or the `/auth/session` response is inspected
- **THEN** no field carries the raw `users.global_role` value; only the computed `canFacilitateSessions` boolean is present

---

### Requirement: Frontend auth context provider
The frontend SHALL include an auth context provider that wraps the application, tracks the current authentication state via the `/auth/session` endpoint, and redirects unauthenticated users to `/auth/login`. The provider SHALL expose the current user's identity, team memberships, and `canFacilitateSessions` flag to child components.

#### Scenario: Unauthenticated user redirected
- **WHEN** the frontend auth context detects no valid session (401 from `/auth/session`)
- **THEN** the user is redirected to `/auth/login`

#### Scenario: Authenticated user identity available
- **WHEN** a user is authenticated and the auth context is loaded
- **THEN** child components can access the user's display name, email, team memberships, and `canFacilitateSessions` flag via the auth context
