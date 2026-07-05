# Design: First Access
**Change:** first-access
**Date:** 2026-07-05
**Status:** Reviewed — incorporates engineering and security review findings

---

## Overview

This document describes the architecture of the first-access flow as implemented, notes where the implementation aligns with the finalized requirements, and calls out the two confirmed gaps that tasks will close.

The implementation is split across four files: the account resolver on the backend, the authentication callback route, the no-team page component on the frontend, and the client-side router. Each is described below with a note on conformance.

---

## Account Resolution

**File:** `packages/backend/src/auth/account-resolver.ts`

**Pattern:** Upsert on `(oidc_subject, oidc_issuer)` unique constraint.

The `resolveOrCreateAccount` function accepts `IdTokenClaims` (`sub`, `iss`, `name?`, `email?`) and performs two database queries:

1. A `SELECT` to determine whether the user already exists (for the `isNewUser` flag).
2. An `INSERT ... ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE` that either creates the record or updates `display_name`, `email`, and `updated_at`.

The compound key `(oidc_subject, oidc_issuer)` is the only identity matching mechanism. Email is stored but never used as a match key. The upsert handles concurrent first-access correctly at the data layer: when two callbacks arrive for the same `sub`/`iss` simultaneously, one insert succeeds and the other performs an update; both return the correct user record.

**Display name fallback chain:** `name` claim → `email` claim → `sub` claim. This matches the spec exactly.

**Known limitation — `isNewUser` race:** The SELECT-before-upsert pattern means two concurrent callbacks for the same new user may both set `isNewUser = true`. The data is correct (one account, one updated record), but any downstream consumer of `isNewUser` may fire twice. This is a documented constraint on future work, not a current defect. No downstream consumer of `isNewUser` exists yet beyond the `first_access_created` audit log event. Before any such consumer is added, the SELECT-before-upsert must be replaced with a pattern that derives `isNewUser` from the upsert result (e.g., via `xmax` inspection or a flag column).

---

## Authentication Callback

**File:** `packages/backend/src/routes/auth.ts` (the `GET /auth/callback` route)

The callback handler is the entry point for the entire first-access flow. The sequence is:

1. Validate the state parameter and retrieve the one-time state payload from Redis.
2. Exchange the authorization code for tokens via `handleCallback`.
3. Extract claims from the ID token via `tokens.claims()`.
4. Call `resolveOrCreateAccount` with `sub`, `iss`, `name`, and `email` from the claims.
5. Emit `first_access_created` audit event if `user.isNewUser`.
6. Destroy the pre-auth session and regenerate a fresh one (session fixation prevention).
7. Populate the new session with user data and encrypted tokens.
8. Emit `auth.session_created` and `auth.success` audit events.
9. Execute the pending join flow if a `pendingJoinToken` was stored in state.
10. Redirect.

**Confirmed gap — missing claims validation:** Step 3 does not include an explicit application-level check that `claims.sub` and `claims.iss` are non-empty strings. The OIDC library (`openid-client`) will reject tokens that are structurally invalid, but an empty-string `sub` or `iss` may pass library validation while failing the application requirement. An IDP returning `sub: ""` would cause the upsert to create a record keyed on `("", "")` — a genuine identity confusion risk where any future empty-claim authentication resolves to that account. The finalized acceptance criterion is explicit: if either claim is missing or empty, the application must reject the authentication, create no account, establish no session, and log the failure without PII. This validation must be added to the callback handler before the call to `resolveOrCreateAccount`.

**Implementation detail — typed MissingClaimError:** The missing-claims validation should use a typed `MissingClaimError` class with a `claim` field (the name of the missing or empty claim, e.g. `"sub"` or `"iss"`). This enables the catch block to emit a structured log entry naming the missing claim without including any PII. The `mapAuthError` function must be updated to recognize and handle this error type.

**Confirmed gap — no-team redirect is client-side:** Step 10 redirects to `/` by default. Team membership routing is currently performed client-side in `AuthenticatedLanding` (see Router section below). The finalized requirement states that the team membership check and the redirect to `/no-team` or `/team/:teamId` must be server-side, in the callback handler. This means: after account resolution, the callback must query the user's current team memberships and redirect to `/no-team` if there are none, or to `/team/:teamId` if there are. The client-side `AuthenticatedLanding` component may be retained as a fallback for direct navigation to `/`, but it must not be the primary routing mechanism for this decision.

**Session creation ordering:** The session is populated and saved only after `resolveOrCreateAccount` completes successfully. If `resolveOrCreateAccount` throws, execution falls to the `catch` block, which redirects to the error page without establishing a session. This satisfies the "no account, no session" constraint.

**Security finding — session fixation pattern:** The current implementation uses `session.destroy()` (in a callback that always resolves, swallowing errors) followed by `session.regenerate()`. This is redundant and unsafe: if `destroy()` fails silently (e.g. a Redis error), the old session remains live in the store while the new session is also created. The correct pattern is `session.regenerate()` alone — it is the idiomatic express-session/connect approach, atomically invalidates the old session ID, and does not have the error-swallowing risk. The implementation must be updated to replace the `destroy()` + `regenerate()` pair with `regenerate()` alone.

---

## No-Team Page Component

**File:** `packages/frontend/src/pages/NoTeamPage.tsx`

The component renders the four permitted elements: the user's display name (from `session.user.displayName`), a statement of no team membership, an instruction to ask for a join link, and a `SignOutButton`. It does not render any navigation elements. The "No further setup is required on your end" line correctly addresses first-time user anxiety.

The component is conformant with the content requirements of the spec. The open question identified in exploration — whether the component is ever wrapped in a layout that contributes navigation — is addressed at the routing layer (see below).

One quality note: the component uses inline styles. This is not a spec concern but should be normalized to the project's design system conventions in a future cleanup pass.

---

## Router

**File:** `packages/frontend/src/App.tsx`

The `/no-team` route is defined as:

```tsx
<Route
  path="/no-team"
  element={
    <ProtectedRoute>
      <NoTeamPage />
    </ProtectedRoute>
  }
/>
```

`ProtectedRoute` wraps `NoTeamPage` in authentication-gating only (redirects to sign-in if not authenticated). There is no `<Layout>` or similar component wrapping this route. The no-team page is not currently inside any navigation-contributing layout. This satisfies the layout constraint as the application stands.

**Risk:** As the application grows and layout components are added to other routes, the no-team page must remain explicitly outside any layout wrapper. The current routing structure provides this isolation, but it is not enforced by a test. A regression test at the routing level — verifying that the rendered output of `<App>` at `/no-team` does not include navigation elements — is needed to prevent future drift.

**Confirmed gap — no redirect away from `/no-team` for users with teams:** If a user who has joined a team bookmarks `/no-team` and navigates there directly, the page renders. There is no guard in `NoTeamPage` or in the `/no-team` route that redirects away when the user has active team memberships. This must be added. The guard should read the current session's `teamMemberships` and redirect to `/team/:teamId` if any memberships exist.

**Engineering finding — NoTeamPage loading state:** The bookmark guard reads `teamMemberships` from the session. The current `NoTeamPage` does not handle the loading state — if `session` is null while `AuthContext` is fetching, any membership check will throw. The component must add an explicit `if (loading) return <AuthLoadingPage />` guard before the membership check, matching the pattern already used by `AuthenticatedLanding`.

**`AuthenticatedLanding` at `/`:** The root route renders `AuthenticatedLanding`, which reads team memberships from the session and navigates client-side to `/no-team` or `/team/:teamId`. Once the server-side redirect gap is closed, users arriving at `/` after a fresh authentication will be rare (only direct navigation to root). `AuthenticatedLanding` can remain as a fallback but should not be the primary routing path.

---

## Session Creation and Error Handling

Session creation occurs only after `resolveOrCreateAccount` completes without throwing. If the database operation fails, the error propagates to the callback's `catch` block, which:

1. Maps the error to a user-facing category and message via `mapAuthError`.
2. Emits an `auth.failure` audit event.
3. Redirects the user to `/auth/error` with the error category, a generic message, and a correlation ID for operator lookup.

No session is established, no account is partially committed (the upsert is atomic at the database level), and the correlation ID in the redirect allows an operator to locate the log entry without any PII in the URL.

---

## Audit Logging

**File:** `packages/backend/src/auth/audit-logger.ts`

The `first_access_created` event is emitted in the callback handler when `user.isNewUser` is true:

```ts
emitAuditEvent(request.log, "auth.first_access_created", {
  userId: user.id,
  oidcSubject: user.oidcSubject,
  oidcIssuer: user.oidcIssuer,
});
```

The event includes the user's internal ID, OIDC subject, and OIDC issuer. It does not include display name, email, or any other PII. This is correct.

The `auth.failure` event used for error cases includes `sourceIp`, `failureCategory`, and `correlationId`. It does not include claim values. This satisfies the no-PII logging requirement for failure cases.

**Security finding — incomplete `first_access_created` event:** The `first_access_created` event is currently emitted without `sourceIp` or `correlationId`. Every other security-relevant audit event in the system includes both. The event must be updated to include `sourceIp` (from `request.ip`) and `correlationId` (the UUID already in scope at that point in the callback handler).

**Security finding — audit log level independence:** The current `emitAuditEvent` function writes at `info` level via a child logger. If the application log level is ever raised to `warn` or `error` in production, all audit events are silently suppressed. Audit logging must be independent of the application log level. This is an application-wide concern beyond the scope of this change, but it must be resolved before production deployment. A task is included to evaluate the current logger implementation and propose a fix.

Once the missing-claims validation gap is closed (Capability 5), the failure log entry for missing/empty claims must identify which claim was absent without logging the values of other claims that may be present in the token.

---

## Constraints That Must Not Change

The following design decisions are structural, not incidental. Any future refactor must preserve them:

1. **The identity match key is always `(oidc_subject, oidc_issuer)`.** Email must not appear in the identity resolution query path in any form.
2. **The upsert pattern must not be replaced with check-then-insert.** The only safe replacement for the upsert is a pattern that derives `isNewUser` from the upsert result itself.
3. **Session creation happens after, and only after, account resolution succeeds.** Any refactor that moves session creation earlier in the callback violates the "no account, no session" constraint.
4. **The `/no-team` route must not be rendered inside a layout that contributes navigation elements.** This is enforced by the routing structure, not by the component. Tests at the routing layer must catch regressions.
5. **Session fixation must be handled by `regenerate()` alone**, not `destroy()` + `regenerate()`. The destroy-then-regenerate pattern swallows Redis errors silently.
6. **Audit events for first-access must include `sourceIp` and `correlationId`.** Consistency with all other security-relevant events in the audit trail is a hard requirement.

---

## Schema Note

Confirm the column types for `display_name` and `email` in the `users` table before closing this change. If either is `VARCHAR(n)`-constrained, add truncation logic in `resolveOrCreateAccount` before the upsert — an oversized `sub` claim (used as the `display_name` fallback) would otherwise produce a database error with no specific log mapping to the `display_name` field.
