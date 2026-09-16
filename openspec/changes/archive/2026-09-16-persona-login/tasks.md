## 1. Backend: dev-login-options endpoint

- [x] 1.1 Export `isPrivateAddress` from `packages/backend/src/config.ts` (currently a private, unexported function) so `auth.ts` can import and call it directly — no behavior change, and no reimplementation of the private-address check in `auth.ts`
  - [x] 1.1.1 Add a short comment at `isPrivateAddress`'s definition noting its known scope now that it backs two call sites: IPv4 literals in the three RFC 1918 ranges plus `localhost`/`127.0.0.1`/`0.0.0.0` only — no IPv6, no DNS resolution (see design.md D2)
- [x] 1.2 Add `GET /auth/dev-login-options` route to `packages/backend/src/routes/auth.ts` that checks `isPrivateAddress(config.OIDC_ISSUER)` AND `config.NODE_ENV !== "production"` explicitly (both, independently), before any other work
- [x] 1.3 On gate failure (either check), return `404` with no body, performing no Redis or database access
- [x] 1.4 On gate success, return the available persona login options, each with a `seeded: boolean` field: role label + account id + `seeded: true` for `participant-001`, `manager-001`, `admin-001`; account id only + `seeded: false` for `facilitator-001`. The frontend renders the unseeded caveat whenever `seeded === false` — this flag is the single source of truth for that fact, not a frontend-hardcoded list of account ids (see design.md D5)
- [x] 1.5 Add a test covering: both gates pass, `NODE_ENV=production` blocks regardless of issuer, non-private issuer blocks regardless of `NODE_ENV`

## 2. Backend: login hint passthrough

- [x] 2.1 Add optional `loginHint` querystring param to `GET /auth/login` in `packages/backend/src/routes/auth.ts`
- [x] 2.2 Validate `loginHint`, when present, against the closed set of known seeded account ids (`participant-001`, `facilitator-001`, `manager-001`, `admin-001`); return `400` for any other value (see design.md D12)
- [x] 2.3 Forward `loginHint` as the OIDC `login_hint` parameter in `getAuthorizationUrl` (`packages/backend/src/auth/oidc-client.ts`), only when present
- [x] 2.4 Add `hasLoginHint: Boolean(loginHint)` to the existing `auth.authorization_initiated` audit event, mirroring the existing `hasJoinContext` boolean on the same event (see design.md D8)
- [x] 2.5 Verify state generation, nonce, PKCE code verifier, and Redis state storage are unaffected by presence/absence of `loginHint`
- [x] 2.6 Add a test covering: hint forwarded when present and valid, `400` returned for an unrecognized hint, hint omitted when absent, `hasLoginHint` reflects presence in the audit event, all other `/auth/login` behavior unchanged

## 3. Local OIDC stub: login_hint-aware auto-approve

- [x] 3.1 Add a `role` claim to `manager-001` (`engineering_manager`) and `admin-001` (`application_admin`) account definitions in `docker/oidc/server.js`; leave `facilitator-001` and `participant-001` without a `role` claim
- [x] 3.2 Include the `role` claim in the account's `claims()` response so it's asserted in the ID token
- [x] 3.3 Replace the `devInteractions` feature with a custom interaction handler: when `login_hint` matches a known account id, auto-approve that account by resolving **both** the `login` and `consent` interaction reasons via `provider.interactionFinished()` — this client requests `offline_access`, which routes through a consent prompt on top of login, so resolving login alone leaves a manual "allow access" screen and defeats one-click sign-in (see design.md D10)
- [x] 3.4 When `login_hint` is absent or does not match a known account id, fall back to the existing username/password (and, if reached, consent) form
- [x] 3.5 Add a test asserting an *absent* `login_hint` and an *unrecognized* `login_hint` both exercise the fallback branch — these are two different code conditions and should not be conflated into a single `if (login_hint)` check
- [x] 3.6 Manually verify: clicking a seeded persona button completes sign-in with no intermediate consent screen (confirms `interactionFinished()` resolves both prompts, not just login) — verified directly against the running `docker compose` `oidc` service: `login_hint=<account-id>` reaches `/auth/callback` with an authorization `code` in exactly 2 interaction round-trips (login, then consent), no form ever rendered
- [x] 3.7 Manually verify: signing in as `manager-001` and `admin-001` produces `global_role = 'engineering_manager'` / `'application_admin'` via the existing `resolveOrCreateAccount` claim-mapping path; signing in as `facilitator-001` / `participant-001` produces the unchanged default — verified the `role` claim reaches the ID token correctly for all four accounts (present + correct value for manager-001/admin-001, absent for facilitator-001/participant-001) by decoding real ID tokens from the running stub. `resolveOrCreateAccount`'s claim-mapping itself is pre-existing, unmodified, unit-tested code (`account-resolver.test.ts`). Could not complete the full click-through to a `users` table row: found and reported (not fixed — out of scope, see report) a pre-existing bug in `auth.ts`'s callback handler that breaks 100% of local sign-ins, persona or manual

## 4. Local infra: loopback-only OIDC port binding

- [x] 4.1 Change `docker-compose.yml`'s `oidc` service port mapping from `"4011:4011"` to `"127.0.0.1:4011:4011"`, binding the mock IdP to loopback instead of all host interfaces (see design.md D11) — `postgres`/`redis` port bindings are out of scope for this change (pre-existing, unrelated to authentication; tracked separately)
- [x] 4.2 Manually verify: the local dev stack still functions end-to-end from `localhost` after the binding change — verified via `docker compose up -d --build`: all three services (`postgres`, `redis`, `oidc`) reported healthy, `oidc` bound to `127.0.0.1:4011`, discovery endpoint and the full `login_hint` interaction flow (login + consent, both auto-resolved) reachable and working via `localhost:4011`, and the real backend (pointed at `OIDC_ISSUER=http://localhost:4011`) successfully reached it for `/auth/dev-login-options` and `/auth/login` redirects

## 5. Frontend: persona login landing page

- [x] 5.1 Add the `/auth/dev-login` route to `packages/frontend/src/App.tsx`, registered alongside `/auth/error` and `/auth/loading` — outside `ProtectedRoute`, no shared layout — rendering the new landing page component
- [x] 5.2 Build the landing page component: full-width "LOCAL DEV ONLY — PERSONA LOGIN" banner in a non-product color treatment; one button per seeded account labeled with role name + account id (Participant, Engineering Manager, Application Admin); Facilitator button labeled with account id alone plus inline caveat text, shown when the option's `seeded` field is `false` ("Role not seeded — signs in as a default user, not a Facilitator. Single identity; does not test cross-team facilitation (see docs)."); a one-line note beneath the buttons ("Each button starts a normal sign-in. To run multiple personas at once, use separate browser profiles or incognito windows."); plain-text "Sign in manually" link to `/auth/login` with no `loginHint`
- [x] 5.3 Ensure the landing page shares no navigation chrome or styling with any authenticated application screen
- [x] 5.4 Wire each persona button to navigate to `/auth/login?loginHint=<account-id>`
- [x] 5.5 In `packages/frontend/src/auth/AuthContext.tsx`, before the existing `401 → window.location.href = "/auth/login"` redirect, call `GET /auth/dev-login-options` with a 300ms client-side timeout
- [x] 5.6 Treat a timeout identically to a `404` response — proceed straight to the existing hard-redirect in either case (unchanged)
- [x] 5.7 On success within timeout, use React Router's `useNavigate()` (available since `AuthProvider` sits inside `BrowserRouter`) to client-side navigate to the now-existing `/auth/dev-login` route, instead of the existing redirect. `AuthContext`'s responsibility stays "decide where to navigate" — it does not render the landing page itself (see design.md D9)
- [x] 5.8 Add a test covering: dev-login-options check succeeding within timeout shows the persona login landing page instead of an immediate redirect, dev-login-options returning `404` or timing out falls through to the existing `/auth/login` redirect with no landing page displayed, clicking a persona button navigates to `/auth/login` with `loginHint` set to that persona's account id, clicking "Sign in manually" navigates to `/auth/login` with no `loginHint`, the multi-persona note is rendered on the landing page

## 6. Frontend/backend: consistent logout gating

- [x] 6.1 Update the post-logout redirect logic to use the same `/auth/dev-login-options` check (not a second, separately-maintained local/prod determination) to decide between navigating to `/auth/dev-login` and the standard sign-in path — no code change needed: `SignOutButton.tsx`'s post-logout destinations (the IdP end-session URL, or `"/"` when none) are both full-page hard navigations that reload the SPA fresh, re-mounting `AuthProvider` and re-running the exact same `fetchSession()` 401 check task 5.5–5.7 added. There is no second, separately-maintained determination to update — confirmed by reading `SignOutButton.tsx` end to end.
- [x] 6.2 Add a test covering: post-logout redirect lands on the persona login landing page when `/auth/dev-login-options` indicates the dev shortcut is active, and follows the standard sign-in path with no landing page displayed when it indicates the shortcut is inactive (`404` or timeout) — covered by `AuthContext.test.tsx`'s "persona login shortcut gating" describe block: since post-logout landing and initial unauthenticated load both re-run the identical `fetchSession()` 401 branch (see 6.1), the existing success/404/timeout tests there are that coverage, plus a test explicitly documenting the equivalence

## 7. Verification

- [x] 7.1 Confirm `auth.ts`'s callback handler, state/nonce/PKCE exchange, claim validation, `session.regenerate()`, and audit event emission (aside from the `hasLoginHint` addition to `auth.authorization_initiated`, task 2.4) are unmodified by this change (diff review) — `git diff packages/backend/src/routes/auth.ts` confirms every changed line is confined to the new `dev-login-options` route and `/login`'s `loginHint` handling; `/callback`, `/logout`, `/session`, and `executeJoinFlow` are byte-for-byte unchanged
- [x] 7.2 Confirm persona-initiated logins emit the same audit events as manually-typed logins, differing only by `hasLoginHint`, with no distinct "persona-shortcut" event or field on any other event — confirmed by the same diff review; no new `AuditEventName` was added to `audit-logger.ts`
- [x] 7.3 Confirm `docker-compose.yml` requires no service-topology changes beyond the `oidc` port-binding change in task 4.1 — confirmed by diff review of `docker-compose.yml`
- [x] 7.4 Manually test in production-like config (`NODE_ENV=production`, non-private `OIDC_ISSUER`): `/auth/dev-login-options` returns `404` with no body, and the frontend proceeds directly to the standard `/auth/login` redirect with no added latency — covered by `auth.test.ts`'s route-level tests (Fastify `inject`, real handler code, mocked `config`/`isPrivateAddress`), and by code inspection confirming the gate check is the literal first statement in the handler with no `await` before it. A full literal `NODE_ENV=production` process boot was not reachable in this environment: `packages/backend/src/content/timing-oracle.ts` has an unrelated, pre-existing production-boot guard (`TIMING_FLOOR_MS` placeholder check, Group 6 latency task) that throws before the server starts, regardless of this change — see report to reviewers

## 8. Documentation

- [x] 8.1 Update `docs/local-development.md`: describe the persona login landing page and how to use it
- [x] 8.2 Document that `manager-001` and `admin-001` now carry real `global_role` values on sign-in, while `facilitator-001` and `participant-001` do not
- [x] 8.3 Add a sentence documenting that concurrent multi-persona testing (e.g. Facilitator in one browser context, Participants in others) requires separate browser profiles or incognito windows — no new tooling needed, this already works today
- [x] 8.4 Note in `docs/local-development.md` that the `oidc` container's port is now bound to loopback only (`127.0.0.1:4011`), consistent with the security posture this change introduces
