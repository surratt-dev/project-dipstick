## Why

Every local reload of an unauthenticated route throws a developer at a generic OIDC username/password form and asks them to already remember which of four opaque account IDs (`participant-001`, `facilitator-001`, `manager-001`, `admin-001`) they need, then retype it by hand. This is dev-loop friction, not a product feature — it's a tax paid by engineers building and testing the application, not by the engineers using it, and it quietly discourages contributors from running the app locally at all versus reading a diff and trusting CI. It has no bearing on any of the ritual's protective constraints (no-manager-participation, simultaneous reveal, facilitator-from-another-team, no individual-level data surfacing) — those are enforced in session/vote logic and role data, nowhere near sign-in — so removing this friction is safe to do now without touching anything load-bearing.

## What Changes

- Add `GET /auth/dev-login-options` — a backend endpoint, double-gated on `isPrivateAddress(config.OIDC_ISSUER)` AND `NODE_ENV !== "production"` (checked explicitly and redundantly, not inferred from one guard implying the other). Returns available persona options when both gates pass; returns `404` with no body, and touches no Redis/DB, when either gate fails.
- Add a persona-login landing page in the frontend, shown instead of the immediate redirect-to-IdP when `/auth/dev-login-options` succeeds within a 300ms client-side timeout (a miss behaves identically to a 404 — proceed straight to the existing redirect). Concretely: a full-width, non-product-styled "LOCAL DEV ONLY" banner; one button per seeded account labeled with role and account id (Facilitator labeled by account id alone, with an inline caveat that its role isn't seeded); a plain-text "Sign in manually" link to the unmodified `/auth/login` flow; nothing else.
- Add optional `loginHint` passthrough on `GET /auth/login`, forwarded as the standard OIDC `login_hint` authorization parameter. This is the only change to the login-initiation path, and it's inert for any real IdP.
- Replace the local OIDC stub's generic `devInteractions` screen (`docker/oidc/server.js`) with a `login_hint`-aware auto-approve interaction handler that falls back to the existing form when `login_hint` is absent or unrecognized.
- Add an OIDC `role` claim to the stub's `manager-001` (`engineering_manager`) and `admin-001` (`application_admin`) account definitions, so these two accounts get real `global_role` values through the existing IdP-role-claim mechanism (`resolveOrCreateAccount` / `PERMITTED_GLOBAL_ROLES`) on every login — no new seed infrastructure. `facilitator-001` and `participant-001` are unchanged (facilitator isn't in the claim allowlist; participant's default already matches its label).
- Route post-logout redirect to the persona-login landing page instead of the generic form, gated by the same `/auth/dev-login-options` check (one source of truth, not a second local/prod branch).
- Update `docs/local-development.md` to document the landing page, the manager/admin role-claim seeding, and that concurrent multi-persona testing requires separate browser profiles/incognito windows (already true today, previously undocumented).

No changes to `auth.ts`'s callback handler, state/nonce/PKCE handling, claim validation, session regeneration, or audit event emission — the full Authorization Code + PKCE exchange still runs for every sign-in, persona-shortcut or manual.

## Capabilities

### New Capabilities
- `persona-login`: the dev-only login shortcut — the `/auth/dev-login-options` endpoint contract (double gate, failure behavior, timeout), the `login_hint` passthrough, the landing page content and gating, and the logout-redirect behavior.

### Modified Capabilities
- `oidc-auth`: the "OIDC authentication redirect" requirement currently states the application SHALL NOT display any interstitial page before the IdP redirect. That holds in production; this change adds a narrowly-scoped, double-gated exception for the local-dev persona-login landing page, which is itself an interstitial by design. The delta spec makes that exception explicit rather than leaving the existing requirement silently contradicted.
- `local-dev-environment`: the "Simulated OIDC provider" requirement's pre-seeded-accounts scenario is updated to reflect that `manager-001` and `admin-001` now carry a `role` claim that maps to real `global_role` values, while `facilitator-001` and `participant-001` do not.

## Impact

- Backend: `packages/backend/src/routes/auth.ts` (new endpoint, `loginHint` param on `/auth/login`, logout redirect target), `packages/backend/src/config.ts` (export `isPrivateAddress` — currently a private, unexported function — for reuse in `auth.ts`; no behavior change, not reimplemented).
- Frontend: `packages/frontend/src/auth/AuthContext.tsx` (pre-redirect check with 300ms timeout), new persona-login landing page component/route.
- Local dev infra: `docker/oidc/server.js` (login_hint-aware auto-approve interaction handler resolving both login and consent prompts, role claims on two accounts); `docker-compose.yml` (`oidc` service port binding changes from `"4011:4011"` to `"127.0.0.1:4011:4011"` — loopback-only, no service-topology change).
- Docs: `docs/local-development.md`.
- No database schema changes, no changes to production configuration or deploy topology, no new use case (this is internal dev tooling with no corresponding UC).
