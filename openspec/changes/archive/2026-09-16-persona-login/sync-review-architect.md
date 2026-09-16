# Solution Architect sync review — persona-login

Reviewer: Ingrid Sollenberger (Principal Solution Architect)
Scope: verify no drift between the newly-synced specs (`openspec/specs/persona-login/spec.md`, `openspec/specs/oidc-auth/spec.md`, `openspec/specs/local-dev-environment/spec.md`) and the actual implementation, and confirm `tasks.md` accuracy before archive.

## Method

Read each synced requirement/scenario, then read the corresponding code directly (not Marcus's summary): `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/middleware.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/config.ts`, `packages/backend/src/auth/oidc-client.ts`, `docker/oidc/server.js`, `docker/oidc/accounts.js`, `packages/frontend/src/auth/AuthContext.tsx`, `packages/frontend/src/pages/DevLoginPage.tsx`, `packages/frontend/src/App.tsx`, `docker-compose.yml`, `packages/shared/src/types/auth.ts`.

## Findings — persona-login spec.md

- **Dev-login-options endpoint**: `routes/auth.ts` gates on `config.NODE_ENV === "production" || !isPrivateAddress(config.OIDC_ISSUER)` as the literal first statement, returns bare `404` with no body, no Redis/DB access before it. `seeded` boolean present per option (`DEV_LOGIN_OPTIONS` array: participant/manager/admin `true`, facilitator `false`) — matches. Route registered under `/auth`, and `middleware.ts`'s `PUBLIC_ROUTES` includes `/auth/dev-login-options` verbatim — confirmed reachable without a session, matching the spec's explicit unauthenticated-reachability requirement. Match.
- **Login hint passthrough**: `loginHint` validated against the closed set (`SEEDED_ACCOUNT_IDS`) before any state/nonce/PKCE generation, returns `400` with a structured `error` body for unknown values. Valid/absent hint forwarded into `getAuthorizationUrl` → `oidc-client.ts` spreads `login_hint` into `buildAuthorizationUrl` only when present. `hasLoginHint: Boolean(loginHint)` added to `auth.authorization_initiated` alongside pre-existing `hasJoinContext`. No new audit event. Match.
- **Persona login landing page**: `AuthContext.tsx` calls `/auth/dev-login-options` with a 300ms `AbortController` timeout before the existing 401 redirect; failure or timeout falls through identically (`catch` returns `false`, treated same as non-ok). `DevLoginPage.tsx` renders the yellow banner, one button per option (unseeded option shows account-id-only label + inline caveat), the multi-persona note, and a plain "Sign in manually" link to `/auth/login` with no hint. No shared chrome. Match.
- **Consistent gating sign-in/sign-out**: Confirmed via code reading (not just trusting tasks.md 6.1's note) — logout is a hard navigation that remounts `AuthProvider`, re-running the same `fetchSession()`/`devLoginShortcutAvailable()` path used on initial load. One gate, as the spec requires. Match.
- **Standard flow preserved**: `auth.ts`'s `/callback` handler (state/nonce/PKCE, atomic `getdel`, claim validation, `session.regenerate()`, audit events) is untouched by this diff — confirmed by reading the full file, not just the task-list's diff-review claim. No persona-distinct event exists in `audit-logger.ts`'s `AuditEventName` union. Match.

## Findings — oidc-auth spec.md delta

The new interstitial exception is scoped to `GET /auth/dev-login-options` succeeding under the double gate; production's "no interstitial" scenario is preserved as its own scenario. Matches `AuthContext.tsx`'s actual gating logic (fail-open to the standard redirect in every other case). Match.

## Findings — local-dev-environment spec.md delta

- `docker/oidc/accounts.js`: `manager-001`/`admin-001` carry `role: "engineering_manager"` / `"application_admin"`; `facilitator-001`/`participant-001` carry no `role` field. Matches the spec's role-claim requirement exactly.
- `docker/oidc/server.js`: `conformIdTokenClaims: false` with an inline comment explaining the fix (claims were previously stranded on `/userinfo`, which the backend never calls) — matches spec's "delivered directly on the signed ID token" requirement, and matches the code fact that `oidc-client.ts`/`routes/auth.ts` read only `tokens.claims()`, never call `/userinfo`.
- `docker/oidc/server.js` JWKS: regenerated 2048-bit RSA key (previously 1760-bit, below `jose`'s enforced RS256 minimum) — matches spec's "signing key SHALL be adequate" requirement.
- `docker-compose.yml`: `oidc` port binding changed to `127.0.0.1:4011:4011` (loopback-only) — this is task 4.1/D11, not itself asserted as a new spec requirement in the diff I reviewed, but it's consistent with the rest of the change and not contradicted by any spec text.

No drift found in any of the three synced spec files against the code as it currently stands.

## request.hostname port-drop bug (issue #104)

Confirmed: `routes/auth.ts` line ~122 still builds the callback URL via `` `${request.protocol}://${request.hostname}${request.url}` `` — `request.hostname` drops the port, the pre-existing bug. Not described as fixed anywhere in the three synced specs or their scenarios. Correctly left for issue #104.

## tasks.md accuracy (39 vs 38)

`tasks.md` itself: 38 checkbox lines, all `- [x]`, zero `- [ ]` — internally consistent, no discrepancy in the file itself. The "39" figure was Marcus's prose summary count, not a `tasks.md` state — already flagged as immaterial in `implementation-review-architect.md` line 69. **No edit made to `tasks.md`** — its checkbox state is already accurate (38 total tasks, 38 complete). Recommend the final archive record use "38," not "39," if that count is restated anywhere.

## openspec validate --specs --strict

Re-ran independently: `spec/persona-login`, `spec/oidc-auth`, and `spec/local-dev-environment` all pass. Note for completeness: the full run shows 4 unrelated pre-existing failures elsewhere (`manager-team-association`, `project-structure`, `role-assignment`, `websocket-session-authorization`) — none of these files are touched by this branch's diff, so they're out of scope for this change and not a persona-login regression.

## Conclusion

No drift found between the synced specs and the implementation. `tasks.md` is accurate as-is (38/38); no fix was needed. Ready for Stage 7 (Archive) from an architecture standpoint.
